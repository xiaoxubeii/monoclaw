import type {
  MonoConnectResult,
  MonoConnectStatus,
  MonoHandshakeHelloFrame,
  MonoInvitation,
  MonoListenerStatus,
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
import { MonoTrustStore } from './trust-store';
import { TailnetAdapter } from './tailnet-adapter';
import { TailnetJsonConnection, TailnetTransport } from './tailnet-transport';

const DEFAULT_LISTENER_PORT = 4120;

export class MonoConnectService {
  private readonly keyStore = new MonoKeyStore();
  private readonly trustStore = new MonoTrustStore();
  private readonly tailnetAdapter = new TailnetAdapter();
  private readonly transport = new TailnetTransport();
  private listenerPort: number | null = null;

  async getStatus(): Promise<MonoConnectStatus> {
    const [identity, trustRecords, tailnet] = await Promise.all([
      this.keyStore.getPublicIdentity(),
      this.trustStore.list(),
      this.tailnetAdapter.getStatus(),
    ]);

    return {
      identity,
      trustRecords,
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
    const invitation = typeof rawInvitation === 'string'
      ? JSON.parse(rawInvitation) as MonoInvitation
      : rawInvitation;

    if (invitation.identity.did !== invitation.identity.document.id) {
      throw new Error('Invitation identity is invalid. DID document id mismatch.');
    }
    if (invitation.transport.kind !== 'tailnet') {
      throw new Error(`Unsupported transport kind: ${invitation.transport.kind}`);
    }

    const localIdentity = await this.keyStore.loadOrCreateIdentity();
    const connection = await this.transport.connect(invitation.transport.host, invitation.transport.port);

    try {
      const hello: MonoHandshakeHelloFrame = {
        type: 'hello',
        version: 1,
        sessionId: createHandshakeSessionId(),
        did: localIdentity.did,
        didDocument: localIdentity.document,
        nonce: createNonce(),
        sentAt: new Date().toISOString(),
      };
      await connection.sendFrame(hello);

      const challengeFrame = await connection.nextFrame();
      assertHandshakeFrameType(challengeFrame, 'challenge');

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

      return {
        peer,
        listener: this.getListenerStatus(),
        connectionKind,
        transport: 'tailnet',
      };
    } finally {
      connection.close();
    }
  }

  async revokeTrust(did: string): Promise<void> {
    await this.trustStore.revoke(did);
  }

  private getListenerStatus(): MonoListenerStatus {
    return {
      running: this.listenerPort !== null,
      port: this.listenerPort,
    };
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
    const connectionKind = remoteHost
      ? await this.tailnetAdapter.determineConnectionKind(remoteHost)
      : 'unknown';

    await this.trustStore.upsertVerifiedRecord({
      did: helloFrame.did,
      document: helloFrame.didDocument,
      lastKnownHost: remoteHost,
      connectionKind,
      transport: 'tailnet',
    });

    await connection.sendFrame({
      type: 'result',
      version: 1,
      sessionId: helloFrame.sessionId,
      accepted: true,
      verifiedAt: new Date().toISOString(),
    });
    connection.close();
  }
}
