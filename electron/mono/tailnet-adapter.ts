import { spawn } from 'node:child_process';
import type { ConnectivityKind, TailnetPeerStatus, TailnetStatus } from '@mono/types';

interface TailscaleStatusNode {
  HostName?: string;
  DNSName?: string;
  TailscaleIPs?: string[];
  Online?: boolean;
  Relay?: string;
  CurAddr?: string;
}

interface TailscaleStatusJson {
  Self?: TailscaleStatusNode;
  Peer?: Record<string, TailscaleStatusNode>;
}

function runTailscaleCommand(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('tailscale', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `tailscale ${args.join(' ')} exited with code ${code}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function normalizePeer(nodeId: string, peer: TailscaleStatusNode): TailnetPeerStatus {
  const relay = typeof peer.Relay === 'string' && peer.Relay.trim() ? peer.Relay.trim() : undefined;
  const endpoint = typeof peer.CurAddr === 'string' && peer.CurAddr.trim() ? peer.CurAddr.trim() : undefined;
  const connectionKind: ConnectivityKind = relay
    ? 'relayed'
    : endpoint
      ? 'direct'
      : 'unknown';

  return {
    id: nodeId,
    hostName: peer.HostName,
    dnsName: peer.DNSName,
    tailnetIps: Array.isArray(peer.TailscaleIPs) ? peer.TailscaleIPs : [],
    online: peer.Online !== false,
    relay,
    endpoint,
    connectionKind,
  };
}

function normalizeRemoteAddress(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.startsWith('::ffff:') ? value.slice(7) : value;
}

function findTailnetPeerByHost(status: TailnetStatus, targetHost: string): TailnetPeerStatus | undefined {
  const normalizedTarget = normalizeRemoteAddress(targetHost) || targetHost;
  return status.peers.find((peer) => peer.tailnetIps.includes(normalizedTarget));
}

export class TailnetAdapter {
  async getStatus(): Promise<TailnetStatus> {
    try {
      const [statusJson, version] = await Promise.all([
        runTailscaleCommand(['status', '--json']),
        runTailscaleCommand(['version']),
      ]);
      const parsed = JSON.parse(statusJson) as TailscaleStatusJson;
      const peers = Object.entries(parsed.Peer ?? {}).map(([nodeId, node]) => normalizePeer(nodeId, node));

      return {
        available: true,
        binaryPath: 'tailscale',
        backend: 'tailscale',
        version,
        self: parsed.Self ? {
          hostName: parsed.Self.HostName,
          dnsName: parsed.Self.DNSName,
          tailnetIps: Array.isArray(parsed.Self.TailscaleIPs) ? parsed.Self.TailscaleIPs : [],
          online: parsed.Self.Online !== false,
        } : undefined,
        peers,
      };
    } catch (error) {
      return {
        available: false,
        binaryPath: null,
        backend: 'tailscale',
        peers: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async determineConnectionKind(targetHost: string): Promise<ConnectivityKind> {
    const status = await this.getStatus();
    if (!status.available) return 'unknown';

    const match = findTailnetPeerByHost(status, targetHost);
    if (match) {
      return match.connectionKind;
    }

    try {
      const pingJson = await runTailscaleCommand(['ping', '--json', '--timeout=3s', targetHost]);
      const serialized = pingJson.toLowerCase();
      if (serialized.includes('derp') || serialized.includes('relay')) {
        return 'relayed';
      }
      if (serialized.includes('pong') || serialized.includes('peerapiurl') || serialized.includes('endpoint')) {
        return 'direct';
      }
    } catch {
      // ignore and fall back to unknown
    }

    return 'unknown';
  }

  normalizeRemoteAddress(value: string | undefined): string | undefined {
    return normalizeRemoteAddress(value);
  }
}
