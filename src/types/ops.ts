export type OpsOverallStatus = 'healthy' | 'degraded' | 'critical';

export type OpsSeverity = 'info' | 'warn' | 'error';

export type OpsSubsystem =
  | 'gateway'
  | 'openclaw'
  | 'localModel'
  | 'teams'
  | 'scheduler'
  | 'copilot';

export type OpsActionType =
  | 'gateway.start'
  | 'gateway.restart'
  | 'openclaw.doctor.fix'
  | 'localModel.service.start'
  | 'teams.restartErrored';

export interface OpsPolicy {
  autoRemediationEnabled: boolean;
  allowedAutoActions: OpsActionType[];
  maxRetryPerAction: number;
  cooldownMs: number;
  escalationThreshold: number;
}

export interface OpsSubsystemHealth {
  status: OpsOverallStatus;
  message: string;
  updatedAt: string;
}

export interface OpsHealthSnapshot {
  overall: OpsOverallStatus;
  score: number;
  subsystems: Record<OpsSubsystem, OpsSubsystemHealth>;
  updatedAt: string;
  lastCheckAt: string;
  activeIncidents: number;
  autoRemediationEnabled: boolean;
  paused: boolean;
  copilotAvailable: boolean;
}

export interface OpsEvent {
  id: string;
  ts: string;
  severity: OpsSeverity;
  subsystem: OpsSubsystem;
  symptomCode: string;
  summary: string;
  rootCause?: string;
  recommendedActionIds: OpsActionType[];
  checkId: string;
  details?: Record<string, unknown>;
  copilotSummary?: string;
}

export interface OpsActionRecord {
  id: string;
  eventId?: string;
  checkId: string;
  actionType: OpsActionType;
  level: 'L0' | 'L1' | 'L2';
  status: 'pending' | 'running' | 'success' | 'failed' | 'rolledback' | 'blocked';
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  verifyResult?: string;
  rollbackResult?: string;
  error?: string;
  meta?: Record<string, unknown>;
}

export interface OpsStatusPayload {
  snapshot: OpsHealthSnapshot;
  policy: OpsPolicy;
  paused: boolean;
  lastDoctorAt?: string;
  lastDoctorOk?: boolean;
}

export interface OpsOverviewPayload {
  status: OpsStatusPayload;
  events: OpsEvent[];
  actions: OpsActionRecord[];
}

export interface OpsIpcResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
