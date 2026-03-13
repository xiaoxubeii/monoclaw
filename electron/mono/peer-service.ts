import { randomUUID } from 'node:crypto';
import { isAbsolute, resolve, sep } from 'node:path';
import type {
  ConnectivityKind,
  MonoAgentCallFrame,
  MonoAgentResultFrame,
  MonoAgentTaskRequest,
  MonoConnectResult,
  MonoConnectStatus,
  MonoHandshakeHelloFrame,
  MonoInvokePeerAgentInput,
  MonoInvokePeerAgentResult,
  MonoInvitation,
  MonoListenerStatus,
  MonoPeerPolicy,
  MonoPeerPolicyPatch,
  MonoSessionSummary,
  MonoTrustRecord,
} from '@mono/types';
import { createNonce } from '@mono/identity';
import {
  assertHandshakeFrameType,
  createClientResponseFrame,
  createHandshakeSessionId,
  createServerChallengeFrame,
  verifyClientResponseFrame,
  verifyServerChallengeFrame,
} from '@mono/handshake';
import { logger } from '../utils/logger';
import { MonoKeyStore } from './key-store';
import { MonoPolicyStore } from './policy-store';
import { MonoTrustStore } from './trust-store';
import { TailnetAdapter } from './tailnet-adapter';
import { TailnetJsonConnection, TailnetTransport } from './tailnet-transport';

const DEFAULT_LISTENER_PORT = 4120;
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
const AGENT_HISTORY_LIMIT = 80;
const AGENT_HISTORY_POLL_INTERVAL_MS = 800;
const SESSION_PING_INTERVAL_MS = 20000;

interface MonoGatewayChatHistoryMessage {
  id?: string;
  role?: string;
  content?: unknown;
  timestamp?: string | number;
}

interface MonoGatewayAssistantMarker {
  id?: string;
  index: number;
  text: string;
  timestampMs?: number;
}

type MonoGatewayRpc = <T = unknown>(
  method: string,
  params?: unknown,
  timeoutMs?: number,
) => Promise<T>;

interface SessionPendingRequest {
  resolve: (frame: MonoAgentResultFrame) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface MonoPeerSessionOptions {
  did: string;
  host: string;
  port: number;
  connectionKind: ConnectivityKind;
  inbound: boolean;
  connection: TailnetJsonConnection;
  onAgentCall: (did: string, frame: MonoAgentCallFrame) => Promise<MonoAgentResultFrame>;
  onClosed: (did: string) => void;
}

class MonoPeerSession {
  readonly did: string;
  readonly host: string;
  readonly port: number;
  readonly connectionKind: ConnectivityKind;
  readonly inbound: boolean;
  readonly connectedAt: string;

  private readonly connection: TailnetJsonConnection;
  private readonly onAgentCall: (did: string, frame: MonoAgentCallFrame) => Promise<MonoAgentResultFrame>;
  private readonly onClosed: (did: string) => void;
  private readonly pending = new Map<string, SessionPendingRequest>();
  private pingTimer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(options: MonoPeerSessionOptions) {
    this.did = options.did;
    this.host = options.host;
    this.port = options.port;
    this.connectionKind = options.connectionKind;
    this.inbound = options.inbound;
    this.connection = options.connection;
    this.onAgentCall = options.onAgentCall;
    this.onClosed = options.onClosed;
    this.connectedAt = new Date().toISOString();
  }

  start(): void {
    if (this.closed) return;
    if (!this.pingTimer) {
      this.pingTimer = setInterval(() => {
        void this.safeSend({
          type: 'ping',
          version: 1,
          sessionId: createHandshakeSessionId(),
          sentAt: new Date().toISOString(),
        });
      }, SESSION_PING_INTERVAL_MS);
      this.pingTimer.unref();
    }

    void this.readLoop();
  }

  isOpen(): boolean {
    return !this.closed;
  }

  getSummary(): MonoSessionSummary {
    return {
      did: this.did,
      host: this.host,
      port: this.port,
      connectionKind: this.connectionKind,
      transport: 'tailnet',
      connectedAt: this.connectedAt,
      inbound: this.inbound,
      pendingRequests: this.pending.size,
    };
  }

  async callAgent(
    fromDid: string,
    task: MonoAgentTaskRequest,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<MonoAgentResultFrame> {
    if (this.closed) {
      throw new Error(`Session to ${this.did} is closed`);
    }

    const requestId = randomUUID();
    const frame: MonoAgentCallFrame = {
      type: 'agent.call',
      version: 1,
      sessionId: createHandshakeSessionId(),
      requestId,
      fromDid,
      task,
      sentAt: new Date().toISOString(),
    };

    const resultPromise = new Promise<MonoAgentResultFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Timed out waiting for agent.result from ${this.did}`));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
    });

    try {
      await this.connection.sendFrame(frame);
    } catch (error) {
      const pending = this.pending.get(requestId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(requestId);
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      }
      throw error;
    }
    return resultPromise;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;

    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }

    this.connection.close();

    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`Session closed for peer ${this.did}`));
    }
    this.pending.clear();

    this.onClosed(this.did);
  }

  private async readLoop(): Promise<void> {
    try {
      while (!this.closed) {
        const frame = await this.connection.nextFrame(120000);
        if (this.closed) return;

        if (frame.type === 'agent.result') {
          const pending = this.pending.get(frame.requestId);
          if (!pending) {
            logger.warn(`[MonoConnect] Dropped unmatched agent.result frame (peer=${this.did}, request=${frame.requestId})`);
            continue;
          }
          this.pending.delete(frame.requestId);
          clearTimeout(pending.timer);
          pending.resolve(frame);
          continue;
        }

        if (frame.type === 'ping') {
          await this.safeSend({
            type: 'pong',
            version: 1,
            sessionId: frame.sessionId,
            sentAt: new Date().toISOString(),
          });
          continue;
        }

        if (frame.type === 'pong') {
          continue;
        }

        if (frame.type === 'agent.call') {
          void this.onAgentCall(this.did, frame)
            .then((result) => this.safeSend(result))
            .catch(async (error) => {
              await this.safeSend({
                type: 'agent.result',
                version: 1,
                sessionId: frame.sessionId,
                requestId: frame.requestId,
                ok: false,
                error: error instanceof Error ? error.message : String(error),
                finishedAt: new Date().toISOString(),
              });
            });
          continue;
        }

        logger.warn(`[MonoConnect] Unexpected frame in established session: ${frame.type}`);
      }
    } catch (error) {
      if (!this.closed) {
        logger.warn(`[MonoConnect] Session read loop failed for ${this.did}:`, error);
      }
    } finally {
      this.close();
    }
  }

  private async safeSend(frame: MonoAgentResultFrame | { type: 'pong'; version: 1; sessionId: string; sentAt: string } | { type: 'ping'; version: 1; sessionId: string; sentAt: string }): Promise<void> {
    if (this.closed) return;
    try {
      await this.connection.sendFrame(frame);
    } catch (error) {
      if (!this.closed) {
        logger.warn(`[MonoConnect] Failed to send frame to ${this.did}:`, error);
      }
      this.close();
    }
  }
}

export class MonoConnectService {
  private readonly keyStore = new MonoKeyStore();
  private readonly trustStore = new MonoTrustStore();
  private readonly policyStore = new MonoPolicyStore();
  private readonly tailnetAdapter = new TailnetAdapter();
  private readonly transport = new TailnetTransport();
  private readonly gatewayRpc: MonoGatewayRpc;

  private listenerPort: number | null = null;
  private readonly sessions = new Map<string, MonoPeerSession>();
  private readonly inboundRequestTimestamps = new Map<string, number[]>();

  constructor(gatewayRpc: MonoGatewayRpc) {
    this.gatewayRpc = gatewayRpc;
  }

  async getStatus(): Promise<MonoConnectStatus> {
    const [identity, trustRecords, peerPolicies, tailnet] = await Promise.all([
      this.keyStore.getPublicIdentity(),
      this.trustStore.list(),
      this.policyStore.list(),
      this.tailnetAdapter.getStatus(),
    ]);

    const activeSessions = [...this.sessions.values()]
      .filter((session) => session.isOpen())
      .map((session) => session.getSummary())
      .sort((left, right) => right.connectedAt.localeCompare(left.connectedAt));

    return {
      identity,
      trustRecords,
      peerPolicies,
      activeSessions,
      tailnet,
      listener: this.getListenerStatus(),
    };
  }

  async startListener(port = DEFAULT_LISTENER_PORT): Promise<MonoListenerStatus> {
    this.listenerPort = await this.transport.startListener(port, (connection) => {
      void this.handleInboundConnection(connection).catch((error) => {
        logger.warn('[MonoConnect] inbound handshake failed:', error);
        connection.close();
      });
    });
    return this.getListenerStatus();
  }

  async stopListener(): Promise<MonoListenerStatus> {
    await this.transport.stopListener();
    this.listenerPort = null;
    return this.getListenerStatus();
  }

  async createInvitation(): Promise<MonoInvitation> {
    const listener = await this.startListener(DEFAULT_LISTENER_PORT);
    const [identity, tailnet] = await Promise.all([
      this.keyStore.getPublicIdentity(),
      this.tailnetAdapter.getStatus(),
    ]);
    const host = tailnet.self?.tailnetIps[0];

    if (!host || !listener.port) {
      throw new Error('Tailnet is unavailable. Start tailscale on a Headscale-managed tailnet first.');
    }

    return {
      version: 1,
      createdAt: new Date().toISOString(),
      identity,
      transport: {
        kind: 'tailnet',
        host,
        port: listener.port,
        nodeName: tailnet.self?.hostName,
        connectionKind: 'unknown',
      },
    };
  }

  async connectWithInvitation(rawInvitation: string | MonoInvitation): Promise<MonoConnectResult> {
    const invitation = this.parseInvitation(rawInvitation);
    const { peer, connectionKind, reusedSession } = await this.ensureConnectedSession(invitation);

    return {
      peer,
      listener: this.getListenerStatus(),
      connectionKind,
      transport: 'tailnet',
      reusedSession,
    };
  }

  async invokePeerAgent(input: MonoInvokePeerAgentInput): Promise<MonoInvokePeerAgentResult> {
    const peerDid = input.peerDid.trim();
    if (!peerDid) {
      throw new Error('peerDid is required');
    }

    const trust = await this.trustStore.getByDid(peerDid);
    if (!trust || trust.state !== 'verified') {
      throw new Error(`Peer is not verified: ${peerDid}`);
    }

    if (!trust.lastKnownHost || !trust.lastKnownPort) {
      throw new Error(`Peer ${peerDid} is missing a routable host/port. Reconnect with invitation first.`);
    }

    const invitation: MonoInvitation = {
      version: 1,
      createdAt: new Date().toISOString(),
      identity: {
        did: trust.did,
        document: trust.document,
        authKeyId: trust.document.authentication[0] || `${trust.did}#key-1`,
        publicKeyMultibase: trust.document.verificationMethod[0]?.publicKeyMultibase || '',
        createdAt: trust.createdAt,
        updatedAt: trust.updatedAt,
      },
      transport: {
        kind: 'tailnet',
        host: trust.lastKnownHost,
        port: trust.lastKnownPort,
        nodeName: trust.alias,
        connectionKind: trust.lastConnectionKind,
      },
    };

    const { session, connectionKind, reusedSession } = await this.ensureConnectedSession(invitation);
    const localIdentity = await this.keyStore.getPublicIdentity();
    const timeoutMs = Math.max(
      1000,
      Math.floor(Number(input.task.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS)),
    );

    const startedAt = Date.now();
    const frame = await session.callAgent(localIdentity.did, input.task, timeoutMs);
    if (!frame.ok) {
      throw new Error(frame.error || `Peer ${peerDid} rejected agent request.`);
    }

    return {
      peerDid,
      requestId: frame.requestId,
      output: frame.output || '',
      model: frame.model,
      usage: frame.usage,
      durationMs: Date.now() - startedAt,
      connectionKind,
      reusedSession,
    };
  }

  async setPeerPolicy(did: string, patch: MonoPeerPolicyPatch): Promise<MonoPeerPolicy> {
    const normalizedDid = did.trim();
    if (!normalizedDid) {
      throw new Error('did is required');
    }
    return this.policyStore.upsert(normalizedDid, patch);
  }

  async getPeerPolicy(did: string): Promise<MonoPeerPolicy> {
    const normalizedDid = did.trim();
    if (!normalizedDid) {
      throw new Error('did is required');
    }
    return this.policyStore.getOrCreateDefault(normalizedDid);
  }

  async revokeTrust(did: string): Promise<void> {
    const normalizedDid = did.trim();
    if (!normalizedDid) return;
    await this.trustStore.revoke(normalizedDid);
    await this.policyStore.upsert(normalizedDid, { mode: 'deny' });
    this.disconnectPeer(normalizedDid);
  }

  disconnectPeer(did: string): void {
    const normalizedDid = did.trim();
    if (!normalizedDid) return;
    const session = this.sessions.get(normalizedDid);
    if (!session) return;
    session.close();
  }

  private parseInvitation(rawInvitation: string | MonoInvitation): MonoInvitation {
    const invitation = typeof rawInvitation === 'string'
      ? JSON.parse(rawInvitation) as MonoInvitation
      : rawInvitation;

    if (invitation.identity.did !== invitation.identity.document.id) {
      throw new Error('Invitation identity is invalid. DID document id mismatch.');
    }
    if (invitation.transport.kind !== 'tailnet') {
      throw new Error(`Unsupported transport kind: ${invitation.transport.kind}`);
    }
    if (!invitation.transport.host || !invitation.transport.host.trim()) {
      throw new Error('Invitation transport host is required.');
    }
    if (!Number.isInteger(invitation.transport.port) || invitation.transport.port <= 0 || invitation.transport.port > 65535) {
      throw new Error(`Invitation transport port is invalid: ${invitation.transport.port}`);
    }

    return invitation;
  }

  private async ensureConnectedSession(invitation: MonoInvitation): Promise<{
    session: MonoPeerSession;
    peer: MonoTrustRecord;
    connectionKind: ConnectivityKind;
    reusedSession: boolean;
  }> {
    const existing = this.sessions.get(invitation.identity.did);
    if (existing && existing.isOpen()) {
      const peer = await this.trustStore.upsertVerifiedRecord({
        did: invitation.identity.did,
        document: invitation.identity.document,
        alias: invitation.transport.nodeName,
        lastKnownHost: invitation.transport.host,
        lastKnownPort: invitation.transport.port,
        connectionKind: existing.connectionKind,
        transport: 'tailnet',
      });

      return {
        session: existing,
        peer,
        connectionKind: existing.connectionKind,
        reusedSession: true,
      };
    }

    const localIdentity = await this.keyStore.loadOrCreateIdentity();
    const connection = await this.transport.connect(invitation.transport.host, invitation.transport.port);

    const hello: MonoHandshakeHelloFrame = {
      type: 'hello',
      version: 1,
      sessionId: createHandshakeSessionId(),
      did: localIdentity.did,
      didDocument: localIdentity.document,
      nonce: createNonce(),
      sentAt: new Date().toISOString(),
    };

    try {
      await connection.sendFrame(hello);

      const challengeFrame = await connection.nextFrame();
      assertHandshakeFrameType(challengeFrame, 'challenge');

      if (challengeFrame.did !== invitation.identity.did) {
        throw new Error(`Handshake DID mismatch: expected ${invitation.identity.did}, received ${challengeFrame.did}`);
      }
      if (challengeFrame.sessionId !== hello.sessionId) {
        throw new Error('Handshake challenge session mismatch.');
      }
      if (challengeFrame.respondingToNonce !== hello.nonce) {
        throw new Error('Handshake challenge nonce mismatch.');
      }

      if (!verifyServerChallengeFrame({ hello, challenge: challengeFrame })) {
        throw new Error('Remote mono did not prove control of its DID authentication key.');
      }

      const responseFrame = createClientResponseFrame({
        hello,
        challenge: challengeFrame,
        initiatorIdentity: localIdentity,
      });
      await connection.sendFrame(responseFrame);

      const resultFrame = await connection.nextFrame();
      assertHandshakeFrameType(resultFrame, 'result');
      if (resultFrame.sessionId !== hello.sessionId) {
        throw new Error('Handshake result session mismatch.');
      }
      if (!resultFrame.accepted) {
        throw new Error(resultFrame.error || 'Remote mono rejected the handshake.');
      }

      const connectionKind = await this.tailnetAdapter.determineConnectionKind(invitation.transport.host);
      const peer = await this.trustStore.upsertVerifiedRecord({
        did: challengeFrame.did,
        document: challengeFrame.didDocument,
        alias: invitation.transport.nodeName,
        lastKnownHost: invitation.transport.host,
        lastKnownPort: invitation.transport.port,
        connectionKind,
        transport: 'tailnet',
      });

      const session = this.attachSession({
        did: peer.did,
        host: invitation.transport.host,
        port: invitation.transport.port,
        connectionKind,
        inbound: false,
        connection,
      });

      return {
        session,
        peer,
        connectionKind,
        reusedSession: false,
      };
    } catch (error) {
      connection.close();
      throw error;
    }
  }

  private attachSession(input: {
    did: string;
    host: string;
    port: number;
    connectionKind: ConnectivityKind;
    inbound: boolean;
    connection: TailnetJsonConnection;
  }): MonoPeerSession {
    const previous = this.sessions.get(input.did);
    if (previous) {
      previous.close();
    }

    const session = new MonoPeerSession({
      did: input.did,
      host: input.host,
      port: input.port,
      connectionKind: input.connectionKind,
      inbound: input.inbound,
      connection: input.connection,
      onClosed: (did) => {
        const current = this.sessions.get(did);
        if (current === session) {
          this.sessions.delete(did);
        }
      },
      onAgentCall: (did, frame) => this.handleAgentCall(did, frame),
    });

    this.sessions.set(input.did, session);
    session.start();
    return session;
  }

  private async handleInboundConnection(connection: TailnetJsonConnection): Promise<void> {
    const localIdentity = await this.keyStore.loadOrCreateIdentity();
    const helloFrame = await connection.nextFrame();
    assertHandshakeFrameType(helloFrame, 'hello');

    if (helloFrame.did !== helloFrame.didDocument.id) {
      throw new Error('Incoming hello frame DID mismatch.');
    }

    const challengeFrame = createServerChallengeFrame({
      hello: helloFrame,
      responderIdentity: localIdentity,
      responderNonce: createNonce(),
    });
    await connection.sendFrame(challengeFrame);

    const responseFrame = await connection.nextFrame();
    assertHandshakeFrameType(responseFrame, 'response');
    if (responseFrame.sessionId !== helloFrame.sessionId) {
      await connection.sendFrame({
        type: 'result',
        version: 1,
        sessionId: helloFrame.sessionId,
        accepted: false,
        error: 'Incoming mono response session mismatch.',
      });
      return;
    }
    if (responseFrame.did !== helloFrame.did) {
      await connection.sendFrame({
        type: 'result',
        version: 1,
        sessionId: helloFrame.sessionId,
        accepted: false,
        error: 'Incoming mono response DID mismatch.',
      });
      return;
    }
    if (responseFrame.respondingToNonce !== challengeFrame.nonce) {
      await connection.sendFrame({
        type: 'result',
        version: 1,
        sessionId: helloFrame.sessionId,
        accepted: false,
        error: 'Incoming mono response nonce mismatch.',
      });
      return;
    }

    if (!verifyClientResponseFrame({
      hello: helloFrame,
      challenge: challengeFrame,
      response: responseFrame,
    })) {
      await connection.sendFrame({
        type: 'result',
        version: 1,
        sessionId: helloFrame.sessionId,
        accepted: false,
        error: 'Incoming mono failed DID signature verification.',
      });
      return;
    }

    const remoteHost = this.tailnetAdapter.normalizeRemoteAddress(connection.remoteAddress);
    const remotePort = connection.remotePort;
    const connectionKind = remoteHost
      ? await this.tailnetAdapter.determineConnectionKind(remoteHost)
      : 'unknown';

    await this.trustStore.upsertVerifiedRecord({
      did: helloFrame.did,
      document: helloFrame.didDocument,
      lastKnownHost: remoteHost,
      lastKnownPort: remotePort,
      connectionKind,
      transport: 'tailnet',
    });

    await this.connectionSendAccepted(helloFrame.sessionId, connection);

    if (!remoteHost || !remotePort) {
      logger.warn(`[MonoConnect] inbound session missing remote endpoint (did=${helloFrame.did})`);
      connection.close();
      return;
    }

    this.attachSession({
      did: helloFrame.did,
      host: remoteHost,
      port: remotePort,
      connectionKind,
      inbound: true,
      connection,
    });
  }

  private async connectionSendAccepted(sessionId: string, connection: TailnetJsonConnection): Promise<void> {
    await connection.sendFrame({
      type: 'result',
      version: 1,
      sessionId,
      accepted: true,
      verifiedAt: new Date().toISOString(),
    });
  }

  private async handleAgentCall(peerDid: string, frame: MonoAgentCallFrame): Promise<MonoAgentResultFrame> {
    try {
      this.validateAgentTaskFrame(peerDid, frame);

      const policy = await this.policyStore.getOrCreateDefault(peerDid);
      this.assertPolicyAllowsTask(peerDid, policy, frame.task);

      const output = await this.runLocalAgentTask(peerDid, frame.task, policy);
      return {
        type: 'agent.result',
        version: 1,
        sessionId: frame.sessionId,
        requestId: frame.requestId,
        ok: true,
        output,
        finishedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        type: 'agent.result',
        version: 1,
        sessionId: frame.sessionId,
        requestId: frame.requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        finishedAt: new Date().toISOString(),
      };
    }
  }

  private validateAgentTaskFrame(peerDid: string, frame: MonoAgentCallFrame): void {
    if (!frame.requestId?.trim()) {
      throw new Error('agent.call requestId is required');
    }

    if (frame.fromDid !== peerDid) {
      throw new Error(`agent.call DID mismatch. expected=${peerDid}, actual=${frame.fromDid}`);
    }

    if (!frame.task || typeof frame.task.prompt !== 'string' || !frame.task.prompt.trim()) {
      throw new Error('agent.call prompt is required');
    }
  }

  private assertPolicyAllowsTask(peerDid: string, policy: MonoPeerPolicy, task: MonoAgentTaskRequest): void {
    if (!policy.scopes.includes('agent.invoke')) {
      throw new Error(`Peer policy does not allow agent.invoke (${peerDid})`);
    }

    if (policy.mode === 'deny') {
      throw new Error(`Peer policy denied (${peerDid})`);
    }

    if (policy.mode === 'ask') {
      throw new Error(`Peer policy requires manual approval (${peerDid})`);
    }

    this.enforceRateLimit(peerDid, policy.limits.requestsPerMinute);

    if (task.prompt.length > policy.limits.maxInputChars) {
      throw new Error(`Prompt length exceeds maxInputChars (${policy.limits.maxInputChars})`);
    }

    if (task.maxTokens !== undefined && Number.isFinite(task.maxTokens) && task.maxTokens > policy.limits.maxTokens) {
      throw new Error(`Requested maxTokens exceeds policy limit (${policy.limits.maxTokens})`);
    }

    const requestedTools = (task.requestedTools ?? []).map((item) => item.trim()).filter(Boolean);
    if (requestedTools.length > 0) {
      const allowedTools = new Set(policy.allowedTools.map((item) => item.trim()).filter(Boolean));
      const wildcard = allowedTools.has('*');

      if (!wildcard) {
        const denied = requestedTools.filter((tool) => !allowedTools.has(tool));
        if (denied.length > 0) {
          throw new Error(`Tool access denied by policy: ${denied.join(', ')}`);
        }
      }
    }

    const requestedFiles = (task.requestedFiles ?? []).map((item) => item.trim()).filter(Boolean);
    if (requestedFiles.length > 0) {
      const normalizedRoots = policy.allowedFileRoots
        .map((root) => root.trim())
        .filter(Boolean)
        .map((root) => resolve(root));

      if (normalizedRoots.length === 0) {
        throw new Error('File access denied by policy (no allowedFileRoots configured)');
      }

      for (const filePath of requestedFiles) {
        if (!isAbsolute(filePath)) {
          throw new Error(`Requested file path must be absolute: ${filePath}`);
        }

        const resolvedFile = resolve(filePath);
        const allowed = normalizedRoots.some((root) => this.isPathWithinRoot(resolvedFile, root));
        if (!allowed) {
          throw new Error(`File access denied by policy: ${filePath}`);
        }
      }
    }
  }

  private enforceRateLimit(peerDid: string, requestsPerMinute: number): void {
    const now = Date.now();
    const cutoff = now - 60000;
    const current = this.inboundRequestTimestamps.get(peerDid) ?? [];
    const active = current.filter((ts) => ts >= cutoff);

    if (active.length >= requestsPerMinute) {
      throw new Error(`Rate limit exceeded (${requestsPerMinute} req/min)`);
    }

    active.push(now);
    this.inboundRequestTimestamps.set(peerDid, active);
  }

  private isPathWithinRoot(filePath: string, rootPath: string): boolean {
    if (filePath === rootPath) return true;
    const normalizedRoot = rootPath.endsWith(sep) ? rootPath : `${rootPath}${sep}`;
    return filePath.startsWith(normalizedRoot);
  }

  private async runLocalAgentTask(peerDid: string, task: MonoAgentTaskRequest, policy: MonoPeerPolicy): Promise<string> {
    const timeoutMs = Math.min(
      policy.limits.timeoutMs,
      Math.max(1000, Math.floor(Number(task.timeoutMs ?? policy.limits.timeoutMs))),
    );

    const sessionKey = this.buildRemoteAgentSessionKey(peerDid);
    const baseline = await this.getGatewayHistory(sessionKey)
      .then((history) => this.extractLatestAssistantMarker(history))
      .catch(() => null);

    const message = this.buildGatewayAgentPrompt(peerDid, task);
    const sendResult = await this.gatewayRpc<unknown>(
      'chat.send',
      {
        sessionKey,
        message,
        deliver: false,
        idempotencyKey: `mono-peer:${peerDid}:${randomUUID()}`,
      },
      Math.min(timeoutMs, DEFAULT_REQUEST_TIMEOUT_MS),
    );

    const fallbackText = this.extractTextContent(sendResult).trim();
    return this.waitForGatewayAssistantText(sessionKey, baseline, fallbackText, timeoutMs);
  }

  private buildRemoteAgentSessionKey(peerDid: string): string {
    const suffix = peerDid.replace(/[^a-zA-Z0-9]/g, '').slice(-32) || 'peer';
    return `mono-peer-${suffix}`;
  }

  private buildGatewayAgentPrompt(peerDid: string, task: MonoAgentTaskRequest): string {
    const tools = (task.requestedTools ?? []).map((item) => item.trim()).filter(Boolean);
    const files = (task.requestedFiles ?? []).map((item) => item.trim()).filter(Boolean);

    return [
      `Remote mono task from peer DID: ${peerDid}`,
      `Requested tools: ${tools.length > 0 ? tools.join(', ') : '(none)'}`,
      `Requested files: ${files.length > 0 ? files.join(', ') : '(none)'}`,
      task.maxTokens ? `Requested max tokens: ${task.maxTokens}` : 'Requested max tokens: (default)',
      '',
      'User task:',
      task.prompt,
      '',
      'Response contract:',
      '- Keep the response concise and actionable.',
      '- Prefer bullet points and avoid markdown tables.',
      '- If requested tools/files are unavailable, state constraints explicitly.',
    ].join('\n');
  }

  private async getGatewayHistory(sessionKey: string): Promise<MonoGatewayChatHistoryMessage[]> {
    const raw = await this.gatewayRpc<unknown>(
      'chat.history',
      { sessionKey, limit: AGENT_HISTORY_LIMIT },
      DEFAULT_REQUEST_TIMEOUT_MS,
    );

    if (Array.isArray(raw)) {
      return raw as MonoGatewayChatHistoryMessage[];
    }

    if (raw && typeof raw === 'object') {
      const messages = (raw as { messages?: unknown }).messages;
      if (Array.isArray(messages)) {
        return messages as MonoGatewayChatHistoryMessage[];
      }
    }

    return [];
  }

  private extractLatestAssistantMarker(history: MonoGatewayChatHistoryMessage[]): MonoGatewayAssistantMarker | null {
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const message = history[index];
      if (message.role !== 'assistant') continue;

      const text = this.extractTextContent(message.content).trim();
      if (!text) continue;

      return {
        id: typeof message.id === 'string' && message.id.trim() ? message.id : undefined,
        index,
        text,
        timestampMs: this.toTimestampMs(message.timestamp),
      };
    }

    return null;
  }

  private toTimestampMs(raw: unknown): number | undefined {
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return raw < 1e12 ? Math.round(raw * 1000) : Math.round(raw);
    }

    if (typeof raw === 'string') {
      const numeric = Number(raw);
      if (Number.isFinite(numeric)) {
        return numeric < 1e12 ? Math.round(numeric * 1000) : Math.round(numeric);
      }
      const parsed = Date.parse(raw);
      return Number.isFinite(parsed) ? parsed : undefined;
    }

    return undefined;
  }

  private extractTextContent(content: unknown, depth = 0): string {
    if (depth > 5 || content == null) return '';
    if (typeof content === 'string') return content.trim();

    if (Array.isArray(content)) {
      return content
        .map((item) => this.extractTextContent(item, depth + 1))
        .filter(Boolean)
        .join('\n')
        .trim();
    }

    if (typeof content !== 'object') {
      return '';
    }

    const record = content as Record<string, unknown>;
    const directCandidates = [
      record.output_text,
      record.text,
      record.thinking,
      record.content,
      record.message,
      record.delta,
      record.arguments,
      record.result,
      record.error,
      record.summary,
    ];

    const direct = directCandidates
      .map((item) => this.extractTextContent(item, depth + 1))
      .filter(Boolean)
      .join('\n')
      .trim();
    if (direct) return direct;

    if (Array.isArray(record.choices)) {
      const fromChoices = record.choices
        .map((item) => this.extractTextContent(item, depth + 1))
        .filter(Boolean)
        .join('\n')
        .trim();
      if (fromChoices) return fromChoices;
    }

    return '';
  }

  private isAssistantMarkerNewer(
    latest: MonoGatewayAssistantMarker,
    baseline: MonoGatewayAssistantMarker | null,
  ): boolean {
    if (!baseline) return true;
    if (latest.index > baseline.index) return true;
    if (latest.id && baseline.id && latest.id !== baseline.id) return true;

    if (
      latest.timestampMs !== undefined
      && baseline.timestampMs !== undefined
      && latest.timestampMs > baseline.timestampMs
    ) {
      return true;
    }

    return latest.text !== baseline.text;
  }

  private async waitForGatewayAssistantText(
    sessionKey: string,
    baseline: MonoGatewayAssistantMarker | null,
    fallbackText: string,
    timeoutMs: number,
  ): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    let latestError: unknown = null;

    while (Date.now() <= deadline) {
      try {
        const history = await this.getGatewayHistory(sessionKey);
        const latest = this.extractLatestAssistantMarker(history);
        if (latest && this.isAssistantMarkerNewer(latest, baseline)) {
          return latest.text;
        }
      } catch (error) {
        latestError = error;
      }

      await this.sleep(AGENT_HISTORY_POLL_INTERVAL_MS);
    }

    if (fallbackText) {
      return fallbackText;
    }

    if (latestError) {
      throw new Error(`Gateway history polling failed: ${String(latestError)}`);
    }

    throw new Error('Timed out waiting for assistant output in gateway history');
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise<void>((resolveTimer) => {
      const timer = setTimeout(resolveTimer, ms);
      timer.unref();
    });
  }

  private getListenerStatus(): MonoListenerStatus {
    return {
      running: this.listenerPort !== null,
      port: this.listenerPort,
    };
  }
}
