import { useEffect, useMemo, useState } from 'react';
import type { MonoConnectStatus, MonoInvitation } from '@mono/types';
import * as QRCode from 'qrcode';

interface MonoIpcResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

const DEFAULT_LISTENER_PORT = 4120;

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
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const listenerState = useMemo(() => {
    if (!status?.listener.running || !status.listener.port) return 'stopped';
    return `listening on ${status.listener.port}`;
  }, [status]);

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
    let cancelled = false;
    const payload = invitation.trim();

    if (!payload) {
      setInvitationQrDataUrl(null);
      setInvitationQrError(null);
      return () => {
        cancelled = true;
      };
    }

    void QRCode.toDataURL(payload, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 280,
    }).then((dataUrl) => {
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
      setInvitation(encoded);
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
      const result = await invokeMono<{ peer: { did: string }; connectionKind: string; transport: string }>('mono:connectWithInvitation', payload);
      setMessage(`Mutual trust established with ${result.peer.did} via ${result.transport} (${result.connectionKind})`);
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
              Create invitation
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
