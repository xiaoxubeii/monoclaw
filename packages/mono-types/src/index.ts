export type TrustState = 'pending' | 'verified' | 'revoked';
export type ConnectivityKind = 'direct' | 'relayed' | 'unknown';
export type MonoTransportKind = 'tailnet';

export interface MonoVerificationMethod {
  id: string;
  type: 'Multikey';
  controller: string;
  publicKeyMultibase: string;
}

export interface MonoServiceEndpoint {
  uri?: string;
  routing?: string[];
  accepts?: string[];
}

export interface MonoService {
  id: string;
  type: string;
  serviceEndpoint: string | MonoServiceEndpoint;
}

export interface MonoDidDocument {
  id: string;
  verificationMethod: MonoVerificationMethod[];
  authentication: string[];
  service?: MonoService[];
}

export interface MonoLocalIdentityRecord {
  did: string;
  document: MonoDidDocument;
  authKeyId: string;
  publicKeyMultibase: string;
  privateKeyPem: string;
  publicKeyPem: string;
  createdAt: string;
  updatedAt: string;
}

export interface MonoPublicIdentity {
  did: string;
  document: MonoDidDocument;
  authKeyId: string;
  publicKeyMultibase: string;
  createdAt: string;
  updatedAt: string;
}

export interface MonoTransportHint {
  kind: MonoTransportKind;
  host: string;
  port: number;
  nodeName?: string;
  connectionKind?: ConnectivityKind;
}

export type TailnetTransportHint = MonoTransportHint;

export interface MonoInvitation {
  version: 1;
  createdAt: string;
  identity: MonoPublicIdentity;
  transport: MonoTransportHint;
}

export interface MonoTrustRecord {
  did: string;
  document: MonoDidDocument;
  state: TrustState;
  verifiedAt: string;
  createdAt: string;
  updatedAt: string;
  alias?: string;
  lastSeenAt?: string;
  lastSeenTransport?: MonoTransportKind;
  lastConnectionKind?: ConnectivityKind;
  lastKnownHost?: string;
  lastKnownPort?: number;
}

export interface TailnetPeerStatus {
  id: string;
  hostName?: string;
  dnsName?: string;
  tailnetIps: string[];
  online: boolean;
  relay?: string;
  endpoint?: string;
  connectionKind: ConnectivityKind;
}

export interface TailnetStatus {
  available: boolean;
  binaryPath: string | null;
  backend: 'tailscale';
  version?: string;
  self?: {
    hostName?: string;
    dnsName?: string;
    tailnetIps: string[];
    online: boolean;
  };
  peers: TailnetPeerStatus[];
  error?: string;
}

export interface MonoListenerStatus {
  running: boolean;
  port: number | null;
}

export interface MonoHandshakeHelloFrame {
  type: 'hello';
  version: 1;
  sessionId: string;
  did: string;
  didDocument: MonoDidDocument;
  nonce: string;
  sentAt: string;
}

export interface MonoHandshakeChallengeFrame {
  type: 'challenge';
  version: 1;
  sessionId: string;
  did: string;
  didDocument: MonoDidDocument;
  nonce: string;
  respondingToNonce: string;
  signature: string;
  sentAt: string;
}

export interface MonoHandshakeResponseFrame {
  type: 'response';
  version: 1;
  sessionId: string;
  did: string;
  respondingToNonce: string;
  signature: string;
  sentAt: string;
}

export interface MonoHandshakeResultFrame {
  type: 'result';
  version: 1;
  sessionId: string;
  accepted: boolean;
  verifiedAt?: string;
  error?: string;
}

export type MonoHandshakeFrame =
  | MonoHandshakeHelloFrame
  | MonoHandshakeChallengeFrame
  | MonoHandshakeResponseFrame
  | MonoHandshakeResultFrame;

export interface MonoConnectStatus {
  identity: MonoPublicIdentity;
  trustRecords: MonoTrustRecord[];
  tailnet: TailnetStatus;
  listener: MonoListenerStatus;
}

export interface MonoConnectResult {
  peer: MonoTrustRecord;
  listener: MonoListenerStatus;
  connectionKind: ConnectivityKind;
  transport: MonoTransportKind;
}
