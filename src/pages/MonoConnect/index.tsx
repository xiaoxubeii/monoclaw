import { useEffect, useMemo, useState } from 'react';
import type {
  MonoConnectStatus,
  MonoInvitation,
  MonoInvokePeerAgentInput,
  MonoInvokePeerAgentResult,
  MonoPeerPolicy,
  MonoPeerPolicyMode,
  MonoPeerPolicyPatch,
} from '@mono/types';
import * as QRCode from 'qrcode';

interface MonoIpcResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

const DEFAULT_LISTENER_PORT = 4120;
const INVITATION_QR_OPTIONS = {
  errorCorrectionLevel: 'M' as const,
  margin: 1,
  width: 280,
};

function parseCommaSeparated(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseLineSeparated(value: string): string[] {
  return value
    .split(/\r?\n/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function invokeMono<T>(channel: string, ...args: unknown[]): Promise<T> {
  const response = await window.electron.ipcRenderer.invoke(channel, ...args) as MonoIpcResponse<T>;
  if (!response.success) {
    throw new Error(response.error || `Mono IPC call failed for ${channel}`);
  }
  if (response.data === undefined) {
    throw new Error(`Mono IPC call returned no data for ${channel}`);
  }
  return response.data;
}

export function MonoConnect() {
  const [status, setStatus] = useState<MonoConnectStatus | null>(null);
  const [invitation, setInvitation] = useState('');
  const [invitationQrDataUrl, setInvitationQrDataUrl] = useState<string | null>(null);
  const [invitationQrError, setInvitationQrError] = useState<string | null>(null);
  const [remoteInvitation, setRemoteInvitation] = useState('');

  const [selectedPeerDid, setSelectedPeerDid] = useState('');
  const [policyMode, setPolicyMode] = useState<MonoPeerPolicyMode>('ask');
  const [policyTools, setPolicyTools] = useState('');
  const [policyRoots, setPolicyRoots] = useState('');
  const [policyRpm, setPolicyRpm] = useState('6');
  const [policyMaxInputChars, setPolicyMaxInputChars] = useState('8000');
  const [policyMaxTokens, setPolicyMaxTokens] = useState('2048');
  const [policyTimeoutMs, setPolicyTimeoutMs] = useState('90000');

  const [invokePrompt, setInvokePrompt] = useState('');
  const [invokeTools, setInvokeTools] = useState('');
  const [invokeFiles, setInvokeFiles] = useState('');
  const [invokeMaxTokens, setInvokeMaxTokens] = useState('512');
  const [invokeTimeoutMs, setInvokeTimeoutMs] = useState('60000');
  const [invokeResult, setInvokeResult] = useState<MonoInvokePeerAgentResult | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const listenerState = useMemo(() => {
    if (!status?.listener.running || !status.listener.port) return 'stopped';
    return `listening on ${status.listener.port}`;
  }, [status]);

  const verifiedPeers = useMemo(
    () => (status?.trustRecords ?? []).filter((peer) => peer.state === 'verified'),
    [status?.trustRecords],
  );

  const selectedPolicy = useMemo(
    () => status?.peerPolicies.find((policy) => policy.did === selectedPeerDid) ?? null,
    [selectedPeerDid, status?.peerPolicies],
  );

  const selectedSession = useMemo(
    () => status?.activeSessions.find((session) => session.did === selectedPeerDid) ?? null,
    [selectedPeerDid, status?.activeSessions],
  );

  const refreshStatus = async () => {
    try {
      setError(null);
      const nextStatus = await invokeMono<MonoConnectStatus>('mono:getStatus');
      setStatus(nextStatus);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  };

  useEffect(() => {
    void refreshStatus();
  }, []);

  useEffect(() => {
    const exists = verifiedPeers.some((peer) => peer.did === selectedPeerDid);
    if (exists) return;
    setSelectedPeerDid(verifiedPeers[0]?.did ?? '');
  }, [selectedPeerDid, verifiedPeers]);

  useEffect(() => {
    if (!selectedPeerDid) return;

    const policy = selectedPolicy;
    setPolicyMode(policy?.mode ?? 'ask');
    setPolicyTools((policy?.allowedTools ?? []).join(', '));
    setPolicyRoots((policy?.allowedFileRoots ?? []).join('\n'));
    setPolicyRpm(String(policy?.limits.requestsPerMinute ?? 6));
    setPolicyMaxInputChars(String(policy?.limits.maxInputChars ?? 8000));
    setPolicyMaxTokens(String(policy?.limits.maxTokens ?? 2048));
    setPolicyTimeoutMs(String(policy?.limits.timeoutMs ?? 90000));
  }, [selectedPeerDid, selectedPolicy]);

  useEffect(() => {
    let cancelled = false;
    const payload = invitation.trim();

    if (!payload) {
      setInvitationQrDataUrl(null);
      setInvitationQrError(null);
      return () => {
        cancelled = true;
      };
    }

    void QRCode.toDataURL(payload, INVITATION_QR_OPTIONS).then((dataUrl) => {
      if (cancelled) return;
      setInvitationQrDataUrl(dataUrl);
      setInvitationQrError(null);
    }).catch((nextError) => {
      if (cancelled) return;
      setInvitationQrDataUrl(null);
      setInvitationQrError(nextError instanceof Error ? nextError.message : String(nextError));
    });

    return () => {
      cancelled = true;
    };
  }, [invitation]);

  const runAction = async (label: string, action: () => Promise<void>) => {
    try {
      setBusy(label);
      setError(null);
      setMessage(null);
      await action();
      await refreshStatus();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(null);
    }
  };

  const handleStartListener = async () => {
    await runAction('listener', async () => {
      await invokeMono('mono:startListener', DEFAULT_LISTENER_PORT);
      setMessage(`Mono listener started on ${DEFAULT_LISTENER_PORT}`);
    });
  };

  const handleStopListener = async () => {
    await runAction('listener', async () => {
      await invokeMono('mono:stopListener');
      setMessage('Mono listener stopped');
    });
  };

  const handleCreateInvitation = async () => {
    await runAction('invitation', async () => {
      const nextInvitation = await invokeMono<MonoInvitation>('mono:createInvitation');
      const encoded = JSON.stringify(nextInvitation, null, 2);
      const qrDataUrl = await QRCode.toDataURL(encoded, INVITATION_QR_OPTIONS);
      setInvitation(encoded);
      setInvitationQrDataUrl(qrDataUrl);
      setInvitationQrError(null);
      setMessage(`Invitation created via tailnet (${nextInvitation.transport.host}:${nextInvitation.transport.port}). Share it out-of-band.`);
    });
  };

  const handleCopyInvitation = async () => {
    if (!invitation) return;
    await navigator.clipboard.writeText(invitation);
    setMessage('Invitation copied to clipboard');
  };

  const handleConnect = async () => {
    await runAction('connect', async () => {
      const payload = remoteInvitation.trim();
      if (!payload) {
        throw new Error('Paste a remote invitation before connecting.');
      }
      const result = await invokeMono<{ peer: { did: string }; connectionKind: string; transport: string; reusedSession: boolean }>('mono:connectWithInvitation', payload);
      setMessage(
        `Mutual trust established with ${result.peer.did} via ${result.transport} (${result.connectionKind})${result.reusedSession ? ' [session reused]' : ''}`,
      );
      setRemoteInvitation('');
    });
  };

  const handleRevoke = async (did: string) => {
    await runAction('revoke', async () => {
      const response = await window.electron.ipcRenderer.invoke('mono:revokeTrust', did) as MonoIpcResponse<null>;
      if (!response.success) {
        throw new Error(response.error || `Failed to revoke trust for ${did}`);
      }
      setMessage(`Revoked trust for ${did}`);
      if (selectedPeerDid === did) {
        setSelectedPeerDid('');
      }
    });
  };

  const handleDisconnectPeer = async (did: string) => {
    await runAction('disconnect', async () => {
      const response = await window.electron.ipcRenderer.invoke('mono:disconnectPeer', did) as MonoIpcResponse<null>;
      if (!response.success) {
        throw new Error(response.error || `Failed to disconnect peer session for ${did}`);
      }
      setMessage(`Disconnected active session for ${did}`);
    });
  };

  const handleSavePolicy = async () => {
    await runAction('policy', async () => {
      if (!selectedPeerDid) {
        throw new Error('Select a verified peer first.');
      }

      const patch: MonoPeerPolicyPatch = {
        mode: policyMode,
        scopes: ['agent.invoke'],
        allowedTools: parseCommaSeparated(policyTools),
        allowedFileRoots: parseLineSeparated(policyRoots),
        limits: {
          requestsPerMinute: Number(policyRpm),
          maxInputChars: Number(policyMaxInputChars),
          maxTokens: Number(policyMaxTokens),
          timeoutMs: Number(policyTimeoutMs),
        },
      };

      const saved = await invokeMono<MonoPeerPolicy>('mono:setPeerPolicy', selectedPeerDid, patch);
      setMessage(`Policy updated for ${saved.did} (mode=${saved.mode})`);
    });
  };

  const handleInvokePeer = async () => {
    await runAction('invoke', async () => {
      if (!selectedPeerDid) {
        throw new Error('Select a verified peer first.');
      }

      const prompt = invokePrompt.trim();
      if (!prompt) {
        throw new Error('Enter a prompt before invoking remote peer agent.');
      }

      const payload: MonoInvokePeerAgentInput = {
        peerDid: selectedPeerDid,
        task: {
          prompt,
          requestedTools: parseCommaSeparated(invokeTools),
          requestedFiles: parseLineSeparated(invokeFiles),
          maxTokens: Number.isFinite(Number(invokeMaxTokens)) ? Number(invokeMaxTokens) : undefined,
          timeoutMs: Number.isFinite(Number(invokeTimeoutMs)) ? Number(invokeTimeoutMs) : undefined,
        },
      };

      const result = await invokeMono<MonoInvokePeerAgentResult>('mono:invokePeerAgent', payload);
      setInvokeResult(result);
      setMessage(`Remote agent call completed from ${result.peerDid} in ${result.durationMs}ms (${result.reusedSession ? 'session reused' : 'new session'})`);
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <section className="rounded-3xl border border-border/70 bg-card/80 p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">Mono Connect MVP</p>
            <h1 className="text-3xl font-semibold tracking-tight">DID identity + tailnet transport</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              This control surface keeps identity, trust, and challenge-response above the transport layer.
              Tailnet only moves bytes. DID decides who is trusted.
            </p>
          </div>
          <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-3 text-sm">
            <div className="text-muted-foreground">Listener</div>
            <div className="mt-1 font-medium">{listenerState}</div>
          </div>
        </div>
      </section>

      {message ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
          {message}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-3xl border border-border/70 bg-card/80 p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">Local identity</h2>
              <p className="text-sm text-muted-foreground">A stable `did:peer:2` stays local to Monoclaw and is never delegated to Headscale.</p>
            </div>
            <button
              type="button"
              onClick={() => { void refreshStatus(); }}
              className="rounded-xl border border-border px-3 py-2 text-sm font-medium hover:bg-accent"
            >
              Refresh
            </button>
          </div>

          <div className="mt-5 space-y-4 text-sm">
            <div className="rounded-2xl bg-background/80 p-4">
              <div className="text-muted-foreground">DID</div>
              <div className="mt-2 break-all font-mono text-xs">{status?.identity.did ?? 'Loading...'}</div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl bg-background/80 p-4">
                <div className="text-muted-foreground">Auth key id</div>
                <div className="mt-2 break-all font-mono text-xs">{status?.identity.authKeyId ?? 'Loading...'}</div>
              </div>
              <div className="rounded-2xl bg-background/80 p-4">
                <div className="text-muted-foreground">Created</div>
                <div className="mt-2 text-xs font-medium">{status?.identity.createdAt ?? 'Loading...'}</div>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-border/70 bg-card/80 p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">Transport status</h2>
              <p className="text-sm text-muted-foreground">Headscale/tailscale is transport only. Mutual trust still rides on DID signatures.</p>
            </div>
          </div>

          <div className="mt-5 space-y-4 text-sm">
            <div className="rounded-2xl bg-background/80 p-4">
              <div className="text-muted-foreground">Status</div>
              <div className="mt-2 font-medium">
                {status?.tailnet.available ? 'tailnet available' : 'tailnet unavailable'}
                {status?.tailnet.version ? ` · ${status.tailnet.version}` : ''}
              </div>
              {status?.tailnet.error ? (
                <div className="mt-2 text-xs text-muted-foreground">{status.tailnet.error}</div>
              ) : null}
            </div>
            <div className="rounded-2xl bg-background/80 p-4">
              <div className="text-muted-foreground">Local tailnet IPs</div>
              <div className="mt-2 break-all font-mono text-xs">
                {status?.tailnet.self?.tailnetIps.join(', ') || 'No tailnet address detected'}
              </div>
            </div>
            <div className="rounded-2xl bg-background/80 p-4">
              <div className="text-muted-foreground">Active sessions</div>
              <div className="mt-2 text-xs">
                {(status?.activeSessions.length ?? 0) === 0
                  ? 'No active peer sessions'
                  : `${status?.activeSessions.length ?? 0} sessions live`}
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => { void handleStartListener(); }}
                disabled={busy !== null}
                className="rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
              >
                Start listener
              </button>
              <button
                type="button"
                onClick={() => { void handleStopListener(); }}
                disabled={busy !== null || !status?.listener.running}
                className="rounded-xl border border-border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
              >
                Stop listener
              </button>
            </div>
          </div>
        </section>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-3xl border border-border/70 bg-card/80 p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">Out-of-band invitation</h2>
              <p className="text-sm text-muted-foreground">Generate a signed invitation, then share JSON or QR code with the remote node.</p>
            </div>
            <button
              type="button"
              onClick={() => { void handleCreateInvitation(); }}
              disabled={busy !== null}
              className="rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
            >
              {busy === 'invitation' ? 'Creating invitation...' : 'Create invitation'}
            </button>
          </div>
          <textarea
            value={invitation}
            onChange={(event) => setInvitation(event.target.value)}
            placeholder="Generate an invitation, then share it out-of-band."
            className="mt-5 min-h-[240px] w-full rounded-2xl border border-border bg-background/80 p-4 font-mono text-xs outline-none"
          />
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => { void handleCopyInvitation(); }}
              disabled={!invitation}
              className="rounded-xl border border-border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              Copy invitation
            </button>
          </div>
          <div className="mt-4 rounded-2xl border border-border bg-background/60 p-4">
            <div className="text-sm font-medium">Invitation QR</div>
            <div className="mt-3 flex items-center gap-4">
              {invitationQrDataUrl ? (
                <img
                  src={invitationQrDataUrl}
                  alt="Mono invitation QR code"
                  className="h-44 w-44 rounded-xl border border-border bg-white p-2"
                />
              ) : (
                <div className="flex h-44 w-44 items-center justify-center rounded-xl border border-dashed border-border text-center text-xs text-muted-foreground">
                  Generate invitation to preview QR
                </div>
              )}
              <div className="space-y-1 text-xs text-muted-foreground">
                <p>Scan this QR code to transfer the full invitation JSON quickly.</p>
                <p>If scanning fails, use Copy invitation and paste manually.</p>
                {invitationQrError ? (
                  <p className="text-red-500">{invitationQrError}</p>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-border/70 bg-card/80 p-6 shadow-sm">
          <div>
            <h2 className="text-xl font-semibold">Connect to remote mono</h2>
            <p className="text-sm text-muted-foreground">Paste a peer invitation. The app opens a tailnet TCP session and runs DID challenge-response on top.</p>
          </div>
          <textarea
            value={remoteInvitation}
            onChange={(event) => setRemoteInvitation(event.target.value)}
            placeholder="Paste the remote invitation JSON here."
            className="mt-5 min-h-[240px] w-full rounded-2xl border border-border bg-background/80 p-4 font-mono text-xs outline-none"
          />
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => { void handleConnect(); }}
              disabled={busy !== null || !remoteInvitation.trim()}
              className="rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
            >
              Run mutual handshake
            </button>
          </div>
        </section>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-3xl border border-border/70 bg-card/80 p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">Peer policy</h2>
              <p className="text-sm text-muted-foreground">Task-level permission guard for tools, file roots and token/time limits.</p>
            </div>
          </div>

          <div className="mt-4 space-y-3 text-sm">
            <label className="block">
              <span className="text-muted-foreground">Peer DID</span>
              <select
                value={selectedPeerDid}
                onChange={(event) => setSelectedPeerDid(event.target.value)}
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs font-mono"
              >
                <option value="">Select a verified peer</option>
                {verifiedPeers.map((peer) => (
                  <option key={peer.did} value={peer.did}>{peer.did}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-muted-foreground">Mode</span>
              <select
                value={policyMode}
                onChange={(event) => setPolicyMode(event.target.value as MonoPeerPolicyMode)}
                disabled={!selectedPeerDid}
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2"
              >
                <option value="allow">allow</option>
                <option value="ask">ask</option>
                <option value="deny">deny</option>
              </select>
            </label>

            <label className="block">
              <span className="text-muted-foreground">Allowed tools (comma separated, `*` for any)</span>
              <input
                value={policyTools}
                onChange={(event) => setPolicyTools(event.target.value)}
                disabled={!selectedPeerDid}
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2"
                placeholder="shell.exec, git.run"
              />
            </label>

            <label className="block">
              <span className="text-muted-foreground">Allowed file roots (one absolute path per line)</span>
              <textarea
                value={policyRoots}
                onChange={(event) => setPolicyRoots(event.target.value)}
                disabled={!selectedPeerDid}
                className="mt-1 min-h-[92px] w-full rounded-xl border border-border bg-background px-3 py-2 font-mono text-xs"
                placeholder="/Users/xiaoxubeii/workspace/monoclaw"
              />
            </label>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className="text-muted-foreground">RPM</span>
                <input
                  type="number"
                  value={policyRpm}
                  onChange={(event) => setPolicyRpm(event.target.value)}
                  disabled={!selectedPeerDid}
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2"
                />
              </label>
              <label className="block">
                <span className="text-muted-foreground">Max input chars</span>
                <input
                  type="number"
                  value={policyMaxInputChars}
                  onChange={(event) => setPolicyMaxInputChars(event.target.value)}
                  disabled={!selectedPeerDid}
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2"
                />
              </label>
              <label className="block">
                <span className="text-muted-foreground">Max tokens</span>
                <input
                  type="number"
                  value={policyMaxTokens}
                  onChange={(event) => setPolicyMaxTokens(event.target.value)}
                  disabled={!selectedPeerDid}
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2"
                />
              </label>
              <label className="block">
                <span className="text-muted-foreground">Timeout ms</span>
                <input
                  type="number"
                  value={policyTimeoutMs}
                  onChange={(event) => setPolicyTimeoutMs(event.target.value)}
                  disabled={!selectedPeerDid}
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2"
                />
              </label>
            </div>

            {selectedSession ? (
              <div className="rounded-xl border border-border/70 bg-background/60 p-3 text-xs text-muted-foreground">
                Active session: {selectedSession.host}:{selectedSession.port} · {selectedSession.connectionKind} · pending {selectedSession.pendingRequests}
              </div>
            ) : null}

            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => { if (selectedPeerDid) void handleDisconnectPeer(selectedPeerDid); }}
                disabled={!selectedPeerDid || busy !== null}
                className="rounded-xl border border-border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
              >
                Disconnect session
              </button>
              <button
                type="button"
                onClick={() => { void handleSavePolicy(); }}
                disabled={!selectedPeerDid || busy !== null}
                className="rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
              >
                Save policy
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-border/70 bg-card/80 p-6 shadow-sm">
          <div>
            <h2 className="text-xl font-semibold">Invoke remote peer agent</h2>
            <p className="text-sm text-muted-foreground">Long-lived sessions are reused and requests are multiplexed by request ID.</p>
          </div>

          <div className="mt-4 space-y-3 text-sm">
            <label className="block">
              <span className="text-muted-foreground">Task prompt</span>
              <textarea
                value={invokePrompt}
                onChange={(event) => setInvokePrompt(event.target.value)}
                disabled={!selectedPeerDid}
                className="mt-1 min-h-[140px] w-full rounded-xl border border-border bg-background px-3 py-2"
                placeholder="Ask the remote mono to summarize the latest project status."
              />
            </label>

            <label className="block">
              <span className="text-muted-foreground">Requested tools (comma separated)</span>
              <input
                value={invokeTools}
                onChange={(event) => setInvokeTools(event.target.value)}
                disabled={!selectedPeerDid}
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2"
                placeholder="shell.exec"
              />
            </label>

            <label className="block">
              <span className="text-muted-foreground">Requested files (one absolute path per line)</span>
              <textarea
                value={invokeFiles}
                onChange={(event) => setInvokeFiles(event.target.value)}
                disabled={!selectedPeerDid}
                className="mt-1 min-h-[92px] w-full rounded-xl border border-border bg-background px-3 py-2 font-mono text-xs"
                placeholder="/Users/xiaoxubeii/workspace/monoclaw/README.md"
              />
            </label>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className="text-muted-foreground">Max tokens</span>
                <input
                  type="number"
                  value={invokeMaxTokens}
                  onChange={(event) => setInvokeMaxTokens(event.target.value)}
                  disabled={!selectedPeerDid}
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2"
                />
              </label>
              <label className="block">
                <span className="text-muted-foreground">Timeout ms</span>
                <input
                  type="number"
                  value={invokeTimeoutMs}
                  onChange={(event) => setInvokeTimeoutMs(event.target.value)}
                  disabled={!selectedPeerDid}
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2"
                />
              </label>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => { void handleInvokePeer(); }}
                disabled={!selectedPeerDid || busy !== null}
                className="rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
              >
                Invoke remote agent
              </button>
            </div>

            {invokeResult ? (
              <div className="rounded-2xl border border-border bg-background/70 p-4">
                <div className="text-xs text-muted-foreground">
                  request={invokeResult.requestId} · duration={invokeResult.durationMs}ms · {invokeResult.reusedSession ? 'session reused' : 'new session'}
                </div>
                <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-xl bg-background p-3 text-xs">
                  {invokeResult.output || '(empty output)'}
                </pre>
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <section className="rounded-3xl border border-border/70 bg-card/80 p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">Trusted peers</h2>
            <p className="text-sm text-muted-foreground">Verified peers are persisted in a local trust store under `monoclaw_config/mono_connect`.</p>
          </div>
          <div className="text-sm text-muted-foreground">{status?.trustRecords.length ?? 0} peers</div>
        </div>

        <div className="mt-5 space-y-3">
          {(status?.trustRecords ?? []).length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-background/50 p-6 text-sm text-muted-foreground">
              No trusted peers yet. Complete one successful DID handshake between two mono nodes first.
            </div>
          ) : (
            status?.trustRecords.map((peer) => (
              <div key={peer.did} className="flex flex-col gap-3 rounded-2xl bg-background/80 p-4 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{peer.state}</div>
                  <div className="mt-2 break-all font-mono text-xs">{peer.did}</div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    verified {peer.verifiedAt}
                    {peer.lastConnectionKind ? ` · ${peer.lastConnectionKind}` : ''}
                    {peer.lastKnownHost ? ` · ${peer.lastKnownHost}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => { void handleRevoke(peer.did); }}
                  disabled={busy !== null || peer.state === 'revoked'}
                  className="rounded-xl border border-border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
                >
                  Revoke trust
                </button>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
