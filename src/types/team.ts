export type TeamLifecycleStatus = 'stopped' | 'starting' | 'running' | 'hibernating' | 'error';

export type RoleRuntimeStatus = 'stopped' | 'starting' | 'idle' | 'busy' | 'error';

export type TaskRouteMode = 'explicit' | 'implicit' | 'collaborative';

export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed';

export type CollaborationProtocol = 'native' | 'langgraph' | 'crewai' | 'n8n';

export type CollaborationIntent = 'clarify' | 'handoff' | 'review' | 'escalate' | 'complete';

export interface OpenClawAgentConfig {
  provider?: string;
  model: string;
  systemPrompt: string;
  temperature?: number;
  maxTokens?: number;
}

export interface TeamRoleDefinition {
  id: string;
  name: string;
  personality: string;
  responsibilities: string[];
  boundaries: string[];
  keywords: string[];
  skills?: string[];
  enabled: boolean;
  agent?: OpenClawAgentConfig;
}

export interface FeishuGatewayConfig {
  enabled: boolean;
  appId: string;
  appSecret: string;
  verificationToken: string;
  encryptKey: string;
  botName: string;
}

export interface VirtualTeam {
  id: string;
  name: string;
  domain: string;
  description: string;
  defaultCollaborationProtocol: CollaborationProtocol;
  templateId?: string;
  createdAt: string;
  updatedAt: string;
  status: TeamLifecycleStatus;
  lastError?: string;
  roles: TeamRoleDefinition[];
  feishu: FeishuGatewayConfig;
}

export interface TeamTemplate {
  id: string;
  name: string;
  domain: string;
  description: string;
  roles: TeamRoleDefinition[];
}

export interface TeamTask {
  id: string;
  teamId: string;
  input: string;
  requestedAt: string;
  routeMode: TaskRouteMode;
  requestedRoleId?: string;
  assignedRoleId: string;
  status: TaskStatus;
  startedAt?: string;
  completedAt?: string;
  result?: string;
  error?: string;
  collaboration?: TeamTaskCollaboration;
}

export interface TeamTaskCollaboration {
  enabled: boolean;
  goalId: string;
  protocol?: CollaborationProtocol;
  isRoot: boolean;
  parentTaskId?: string;
  step?: number;
  totalSteps?: number;
  intent?: CollaborationIntent;
  interactionId?: string;
  fromRoleId?: string;
  toRoleId?: string;
  expectedOutput?: string;
  workspacePath?: string;
  roleSequence?: string[];
  interventionRequired?: boolean;
  awaitingIntervention?: boolean;
  interventionMessage?: string;
  blockedNodeId?: string;
  lastInterventionAt?: string;
  interventionCount?: number;
}

export interface TeamAuditLogEntry {
  id: string;
  teamId: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  source: 'orchestrator' | 'runtime' | 'gateway' | 'task';
  message: string;
  meta?: Record<string, unknown>;
}

export interface RoleRuntimeSnapshot {
  teamId: string;
  roleId: string;
  roleName: string;
  status: RoleRuntimeStatus;
  pid?: number;
  startedAt?: string;
  lastHeartbeatAt?: string;
  currentTaskId?: string;
  lastError?: string;
}

export interface TeamRuntimeSnapshot {
  teamId: string;
  status: TeamLifecycleStatus;
  roles: RoleRuntimeSnapshot[];
  queuedTasks: number;
  runningTasks: number;
  gatewayConnected: boolean;
  lastUpdatedAt: string;
  lastError?: string;
}

export interface CreateTeamPayload {
  name: string;
  domain: string;
  description: string;
  defaultCollaborationProtocol?: CollaborationProtocol;
  templateId?: string;
  roles: TeamRoleDefinition[];
  feishu?: Partial<FeishuGatewayConfig>;
}

export interface UpdateTeamPayload {
  name?: string;
  domain?: string;
  description?: string;
  defaultCollaborationProtocol?: CollaborationProtocol;
  roles?: TeamRoleDefinition[];
}

export interface UpdateFeishuPayload {
  enabled?: boolean;
  appId?: string;
  appSecret?: string;
  verificationToken?: string;
  encryptKey?: string;
  botName?: string;
}

export interface DispatchTaskPayload {
  input: string;
  requestedRoleId?: string;
  collaborative?: boolean;
  collaborationProtocol?: CollaborationProtocol;
}

export interface CollaborativeInterventionPayload {
  rootTaskId: string;
  note: string;
}
