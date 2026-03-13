export type TrustState = 'pending' | 'verified' | 'revoked';
export type ConnectivityKind = 'direct' | 'relayed' | 'unknown';
export type MonoTransportKind = 'tailnet';
export type MonoPeerPolicyMode = 'deny' | 'ask' | 'allow';
export type MonoCapabilityScope = 'agent.invoke';

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

export interface MonoPeerPolicyLimits {
  requestsPerMinute: number;
  maxInputChars: number;
  maxTokens: number;
  timeoutMs: number;
}

export interface MonoPeerPolicy {
  did: string;
  mode: MonoPeerPolicyMode;
  scopes: MonoCapabilityScope[];
  allowedTools: string[];
  allowedFileRoots: string[];
  limits: MonoPeerPolicyLimits;
  createdAt: string;
  updatedAt: string;
}

export interface MonoPeerPolicyPatch {
  mode?: MonoPeerPolicyMode;
  scopes?: MonoCapabilityScope[];
  allowedTools?: string[];
  allowedFileRoots?: string[];
  limits?: Partial<MonoPeerPolicyLimits>;
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

export interface MonoAgentTaskRequest {
  prompt: string;
  requestedTools?: string[];
  requestedFiles?: string[];
  maxTokens?: number;
  timeoutMs?: number;
}

export interface MonoAgentCallFrame {
  type: 'agent.call';
  version: 1;
  sessionId: string;
  requestId: string;
  fromDid: string;
  task: MonoAgentTaskRequest;
  sentAt: string;
}

export interface MonoAgentUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface MonoAgentResultFrame {
  type: 'agent.result';
  version: 1;
  sessionId: string;
  requestId: string;
  ok: boolean;
  output?: string;
  error?: string;
  model?: string;
  usage?: MonoAgentUsage;
  finishedAt: string;
}

export interface MonoPingFrame {
  type: 'ping';
  version: 1;
  sessionId: string;
  sentAt: string;
}

export interface MonoPongFrame {
  type: 'pong';
  version: 1;
  sessionId: string;
  sentAt: string;
}

export type MonoFrame =
  | MonoHandshakeFrame
  | MonoAgentCallFrame
  | MonoAgentResultFrame
  | MonoPingFrame
  | MonoPongFrame;

export interface MonoSessionSummary {
  did: string;
  host: string;
  port: number;
  connectionKind: ConnectivityKind;
  transport: MonoTransportKind;
  connectedAt: string;
  inbound: boolean;
  pendingRequests: number;
}

export interface MonoInvokePeerAgentInput {
  peerDid: string;
  task: MonoAgentTaskRequest;
}

export interface MonoInvokePeerAgentResult {
  peerDid: string;
  requestId: string;
  output: string;
  model?: string;
  usage?: MonoAgentUsage;
  durationMs: number;
  connectionKind: ConnectivityKind;
  reusedSession: boolean;
}

export interface MonoConnectStatus {
  identity: MonoPublicIdentity;
  trustRecords: MonoTrustRecord[];
  peerPolicies: MonoPeerPolicy[];
  activeSessions: MonoSessionSummary[];
  tailnet: TailnetStatus;
  listener: MonoListenerStatus;
}

export interface MonoConnectResult {
  peer: MonoTrustRecord;
  listener: MonoListenerStatus;
  connectionKind: ConnectivityKind;
  transport: MonoTransportKind;
  reusedSession: boolean;
}
