import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { findTeamTemplate, listTeamTemplates } from './templates';
import { TeamPersistenceStore } from './store';
import { TeamProcessSupervisor, type RoleRuntimeAgentBinding } from './process-supervisor';
import { routeRole } from './routing';
import { buildRoleCollaborationPlan } from './collaboration-protocol';
import { logger } from '../utils/logger';
import {
  getApiKey,
  getDefaultProvider,
  getProvider as getStoredProvider,
} from '../utils/secure-storage';
import { getProviderConfig as getBackendProviderConfig } from '../utils/provider-registry';
import type {
  CollaborationProtocol,
  CreateTeamPayload,
  DispatchTaskPayload,
  FeishuGatewayConfig,
  OpenClawAgentConfig,
  RoleRuntimeSnapshot,
  TeamAuditLogEntry,
  TeamRoleDefinition,
  TeamRuntimeSnapshot,
  TeamTask,
  TeamTemplate,
  UpdateFeishuPayload,
  UpdateTeamPayload,
  VirtualTeam,
} from './types';
import type { RoleCollaborationInteraction, RoleCollaborationPlan } from './collaboration-protocol';

const FEISHU_SECRET_MASK = '********';
const DEFAULT_AGENT_PROVIDER = 'openclaw';
const DEFAULT_AGENT_MODEL = 'auto';
const DEFAULT_AGENT_TEMPERATURE = 0.2;
const DEFAULT_AGENT_MAX_TOKENS = 512;
const AGENT_MIN_TEMPERATURE = 0;
const AGENT_MAX_TEMPERATURE = 2;
const AGENT_MIN_MAX_TOKENS = 128;
const AGENT_MAX_MAX_TOKENS = 32768;
const COLLABORATIVE_TASK_TIMEOUT_MS = 2 * 60 * 1000;
const DEFAULT_COLLABORATION_PROTOCOL: CollaborationProtocol = 'native';
const COLLABORATIVE_CONTEXT_SNIPPET_LIMIT = 400;
const COLLABORATIVE_OUTPUT_WORD_LIMIT = 140;
const TEAM_GATEWAY_SESSION_KEY_PREFIX = 'agent:main:team';
const TEAM_GATEWAY_RPC_TIMEOUT_MS = 3 * 60 * 1000;
const TEAM_GATEWAY_HISTORY_TIMEOUT_MS = 45 * 1000;
const TEAM_GATEWAY_HISTORY_POLL_INTERVAL_MS = 800;
const TEAM_GATEWAY_HISTORY_LIMIT = 80;

function sanitizeId(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function assertTeamId(teamId: string): void {
  if (!/^[a-z0-9][a-z0-9-_]{1,63}$/i.test(teamId)) {
    throw new Error(`Invalid team id: ${teamId}`);
  }
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeStringList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);
}

function detectTaskLanguage(input: string): 'en' | 'zh' | 'ja' {
  const text = String(input || '');
  if (/[\u3040-\u30ff]/.test(text)) return 'ja';
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh';
  return 'en';
}

function describeTaskLanguage(language: 'en' | 'zh' | 'ja'): string {
  if (language === 'zh') return 'Chinese (Simplified)';
  if (language === 'ja') return 'Japanese';
  return 'English';
}

function sanitizeCollaborativeOutput(output: string): string {
  return output
    .split('\n')
    .filter((line) => !/^\s*(status|状态)\s*:/i.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getFallbackCollaborativeOutput(language: 'en' | 'zh' | 'ja'): string {
  if (language === 'zh') return '已完成协作，但未生成可展示的结果。请补充更多约束后重试。';
  if (language === 'ja') return '協調処理は完了しましたが、表示可能な結果がありません。条件を追加して再実行してください。';
  return 'Collaboration completed, but no user-facing result was generated. Add more constraints and try again.';
}

function buildDefaultSystemPrompt(roleName: string, personality: string, skills: string[]): string {
  const skillHint = skills.length > 0
    ? `Use role-bound skills when needed: ${skills.join(', ')}.`
    : 'Use role-bound skills when needed.';
  return [
    `You are ${roleName}.`,
    `Persona: ${personality}.`,
    'Follow responsibilities and boundaries defined in SOUL.md.',
    skillHint,
    'Return structured, concise, and actionable output.',
    'Prefer short bullets, avoid markdown tables, and keep responses compact unless the task explicitly requires depth.',
    'Do not restate the full context when a short delta or recommendation is sufficient.',
  ].join('\n');
}

function toSafeFileSegment(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'role';
}

function normalizeAgentConfig(
  agent: OpenClawAgentConfig | undefined,
  roleName: string,
  personality: string,
  skills: string[],
): OpenClawAgentConfig {
  const provider = agent?.provider?.trim() || DEFAULT_AGENT_PROVIDER;
  const model = agent?.model?.trim() || DEFAULT_AGENT_MODEL;
  const systemPrompt =
    agent?.systemPrompt?.trim() || buildDefaultSystemPrompt(roleName, personality, skills);

  const rawTemperature = typeof agent?.temperature === 'number'
    ? agent.temperature
    : DEFAULT_AGENT_TEMPERATURE;
  const rawMaxTokens = typeof agent?.maxTokens === 'number'
    ? agent.maxTokens
    : DEFAULT_AGENT_MAX_TOKENS;

  return {
    provider,
    model,
    systemPrompt,
    temperature: clampNumber(rawTemperature, AGENT_MIN_TEMPERATURE, AGENT_MAX_TEMPERATURE),
    maxTokens: Math.round(
      clampNumber(rawMaxTokens, AGENT_MIN_MAX_TOKENS, AGENT_MAX_MAX_TOKENS),
    ),
  };
}

function normalizeRole(role: TeamRoleDefinition): TeamRoleDefinition {
  const roleId = sanitizeId(role.id || role.name);
  if (!roleId) {
    throw new Error(`Invalid role id for role ${role.name}`);
  }

  const roleName = role.name?.trim() || roleId;
  const personality = role.personality?.trim() || 'Professional and focused.';
  const normalizedSkills = normalizeStringList(role.skills).map((item) => item.toLowerCase());

  return {
    id: roleId,
    name: roleName,
    personality,
    responsibilities: normalizeStringList(role.responsibilities),
    boundaries: normalizeStringList(role.boundaries),
    keywords: normalizeStringList(role.keywords).map((item) => item.toLowerCase()),
    skills: normalizedSkills,
    enabled: role.enabled !== false,
    agent: normalizeAgentConfig(role.agent, roleName, personality, normalizedSkills),
  };
}

function normalizeCollaborationProtocol(protocol?: string): CollaborationProtocol {
  if (protocol === 'langgraph' || protocol === 'crewai' || protocol === 'n8n') {
    return protocol;
  }
  return DEFAULT_COLLABORATION_PROTOCOL;
}

function sanitizeRuntimeBindingText(raw: string | undefined): string {
  return String(raw || '')
    .replace(/[\u0000-\u001F\u007F\u2028\u2029]/g, '')
    .replace(/%00/gi, '')
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();
}

function uniqueByRoleId(roles: TeamRoleDefinition[]): TeamRoleDefinition[] {
  const seen = new Set<string>();
  const result: TeamRoleDefinition[] = [];

  for (const role of roles) {
    if (seen.has(role.id)) continue;
    seen.add(role.id);
    result.push(role);
  }

  return result;
}

function maskSecret(secret: string): string {
  if (!secret) return '';
  if (secret.length <= 4) return FEISHU_SECRET_MASK;
  return `${secret.slice(0, 2)}${'*'.repeat(Math.max(4, secret.length - 4))}${secret.slice(-2)}`;
}

function cloneTeam(team: VirtualTeam): VirtualTeam {
  return JSON.parse(JSON.stringify(team)) as VirtualTeam;
}

function buildDefaultFeishuConfig(input?: Partial<FeishuGatewayConfig>): FeishuGatewayConfig {
  return {
    enabled: input?.enabled ?? false,
    appId: input?.appId?.trim() ?? '',
    appSecret: input?.appSecret?.trim() ?? '',
    verificationToken: input?.verificationToken?.trim() ?? '',
    encryptKey: input?.encryptKey?.trim() ?? '',
    botName: input?.botName?.trim() || 'AI Virtual Team',
  };
}

function normalizePersistedTeam(team: VirtualTeam): VirtualTeam {
  return {
    ...team,
    domain: team.domain?.trim() || 'general',
    description: team.description?.trim() || '',
    defaultCollaborationProtocol: normalizeCollaborationProtocol(team.defaultCollaborationProtocol),
    roles: uniqueByRoleId((team.roles ?? []).map((role) => normalizeRole(role))),
    feishu: buildDefaultFeishuConfig(team.feishu),
  };
}

interface GatewayChatHistoryMessage {
  id?: string;
  role?: string;
  content?: unknown;
  timestamp?: string | number;
}

interface GatewayAssistantMarker {
  id?: string;
  index: number;
  text: string;
  timestampMs?: number;
}

export type TeamGatewayRpc = <T = unknown>(
  method: string,
  params?: unknown,
  timeoutMs?: number,
) => Promise<T>;

interface TeamOrchestratorOptions {
  gatewayRpc?: TeamGatewayRpc;
}

export class TeamOrchestrator extends EventEmitter {
  private readonly persistence = new TeamPersistenceStore();
  private readonly supervisor = new TeamProcessSupervisor();
  private readonly gatewayRpc: TeamGatewayRpc | null;

  private readonly teams = new Map<string, VirtualTeam>();
  private readonly taskMap = new Map<string, TeamTask>();
  private readonly teamTaskOrder = new Map<string, string[]>();
  private readonly teamTaskQueue = new Map<string, string[]>();
  private readonly teamLogs = new Map<string, TeamAuditLogEntry[]>();
  private readonly drainingQueue = new Set<string>();
  private readonly gatewayRoleActiveTask = new Map<string, string>();

  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor(options: TeamOrchestratorOptions = {}) {
    super();
    this.gatewayRpc = options.gatewayRpc ?? null;

    this.supervisor.on('runtime-status', (snapshot: RoleRuntimeSnapshot) => {
      this.emitRuntimeSnapshot(snapshot.teamId);
    });

    this.supervisor.on('runtime-log', (event: { teamId: string; roleId: string; level: 'info' | 'warn' | 'error'; message: string }) => {
      const runtimeMessage = `[team=${event.teamId} role=${event.roleId}] ${event.message}`;
      if (event.level === 'error') {
        logger.error(`Role runtime error ${runtimeMessage}`);
      } else if (event.level === 'warn') {
        logger.warn(`Role runtime warning ${runtimeMessage}`);
      } else {
        logger.info(`Role runtime info ${runtimeMessage}`);
      }
      this.appendLog(event.teamId, {
        level: event.level,
        source: 'runtime',
        message: `[${event.roleId}] ${event.message}`,
      });
    });

    this.supervisor.on('task-result', (event: { teamId: string; roleId: string; taskId: string; output: string }) => {
      const task = this.taskMap.get(event.taskId);
      if (!task) return;
      task.status = 'completed';
      task.completedAt = new Date().toISOString();
      task.result = event.output;
      this.emit('task-changed', { ...task });
      this.appendLog(event.teamId, {
        level: 'info',
        source: 'task',
        message: `Task ${task.id} completed by role ${event.roleId}`,
      });
      void this.drainTeamQueue(event.teamId);
      this.emitRuntimeSnapshot(event.teamId);
    });

    this.supervisor.on('task-error', (event: { teamId: string; roleId: string; taskId: string; error: string }) => {
      const task = this.taskMap.get(event.taskId);
      if (!task) return;
      task.status = 'failed';
      task.completedAt = new Date().toISOString();
      task.error = event.error;
      this.emit('task-changed', { ...task });
      this.appendLog(event.teamId, {
        level: 'error',
        source: 'task',
        message: `Task ${task.id} failed in role ${event.roleId}: ${event.error}`,
      });
      void this.drainTeamQueue(event.teamId);
      this.emitRuntimeSnapshot(event.teamId);
    });
  }

  async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }
    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    this.initPromise = (async () => {
      const persistedTeams = await this.persistence.listTeams();
      let recoveredTeamCount = 0;
      let normalizedTeamCount = 0;

      for (const [index, persistedTeam] of persistedTeams.entries()) {
        const team = normalizePersistedTeam(persistedTeam);
        if (JSON.stringify(persistedTeam) !== JSON.stringify(team)) {
          normalizedTeamCount += 1;
        }
        // Runtime processes are in-memory only; after app restart we must not keep stale
        // "running/starting/hibernating" statuses from disk.
        if (team.status === 'running' || team.status === 'starting' || team.status === 'hibernating') {
          team.status = 'stopped';
          team.updatedAt = new Date().toISOString();
          team.lastError = undefined;
          recoveredTeamCount += 1;
        }
        persistedTeams[index] = team;
        this.teams.set(team.id, team);
        this.teamTaskOrder.set(team.id, []);
        this.teamTaskQueue.set(team.id, []);
        this.teamLogs.set(team.id, []);
        this.emitRuntimeSnapshot(team.id);
      }

      if (recoveredTeamCount > 0 || normalizedTeamCount > 0) {
        await this.persistence.saveTeams(persistedTeams);
        logger.info(
          `Recovered ${recoveredTeamCount} team(s) and normalized ${normalizedTeamCount} team(s) after app restart`,
        );
      }

      this.initialized = true;
      logger.info(`TeamOrchestrator initialized with ${persistedTeams.length} team(s)`);
    })();

    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  private async resolveRoleAgentBinding(
    role: TeamRoleDefinition,
  ): Promise<RoleRuntimeAgentBinding | null> {
    const configuredProvider = sanitizeRuntimeBindingText(role.agent?.provider || DEFAULT_AGENT_PROVIDER);
    const providerId = configuredProvider === DEFAULT_AGENT_PROVIDER
      ? sanitizeRuntimeBindingText(await getDefaultProvider())
      : configuredProvider;

    if (!providerId) {
      return null;
    }

    const provider = await getStoredProvider(providerId);
    if (!provider || provider.enabled === false) {
      return null;
    }

    const resolvedModel = (() => {
      const preferredModel = sanitizeRuntimeBindingText(role.agent?.model);
      if (preferredModel && preferredModel !== DEFAULT_AGENT_MODEL) {
        return preferredModel;
      }
      return sanitizeRuntimeBindingText(provider.model);
    })();

    const registryBaseUrl = getBackendProviderConfig(provider.type)?.baseUrl;
    const resolvedBaseUrl = sanitizeRuntimeBindingText(provider.baseUrl || registryBaseUrl);
    const resolvedApiKey = sanitizeRuntimeBindingText(await getApiKey(providerId) || '');
    const resolvedSystemPrompt = role.agent?.systemPrompt?.trim() || buildDefaultSystemPrompt(
      role.name,
      role.personality,
      role.skills ?? [],
    );

    if (!resolvedModel || !resolvedBaseUrl || !resolvedApiKey) {
      return null;
    }

    return {
      providerId,
      providerType: provider.type,
      providerLabel: configuredProvider,
      model: resolvedModel,
      baseUrl: resolvedBaseUrl,
      apiKey: resolvedApiKey,
      systemPrompt: resolvedSystemPrompt,
      temperature: typeof role.agent?.temperature === 'number'
        ? role.agent.temperature
        : DEFAULT_AGENT_TEMPERATURE,
      maxTokens: typeof role.agent?.maxTokens === 'number'
        ? role.agent.maxTokens
        : DEFAULT_AGENT_MAX_TOKENS,
    };
  }

  listTemplates(locale?: string): TeamTemplate[] {
    return listTeamTemplates(locale).map((template) => JSON.parse(JSON.stringify(template)) as TeamTemplate);
  }

  listTeams(): VirtualTeam[] {
    return [...this.teams.values()].map((team) => this.toPublicTeam(team));
  }

  getTeam(teamId: string): VirtualTeam | null {
    const team = this.teams.get(teamId);
    return team ? this.toPublicTeam(team) : null;
  }

  private getRequiredTeam(teamId: string): VirtualTeam {
    assertTeamId(teamId);
    const team = this.teams.get(teamId);
    if (!team) {
      throw new Error(`Team not found: ${teamId}`);
    }
    return team;
  }

  private toPublicTeam(team: VirtualTeam): VirtualTeam {
    const cloned = cloneTeam(team);
    cloned.feishu.appSecret = maskSecret(cloned.feishu.appSecret);
    return cloned;
  }

  private emitTeamChanged(team: VirtualTeam): void {
    this.emit('team-changed', this.toPublicTeam(team));
  }

  private emitTeamRemoved(teamId: string): void {
    this.emit('team-removed', teamId);
  }

  private appendLog(teamId: string, input: {
    level: 'info' | 'warn' | 'error';
    source: 'orchestrator' | 'runtime' | 'gateway' | 'task';
    message: string;
    meta?: Record<string, unknown>;
  }): void {
    const entry: TeamAuditLogEntry = {
      id: randomUUID(),
      teamId,
      timestamp: new Date().toISOString(),
      level: input.level,
      source: input.source,
      message: input.message,
      meta: input.meta,
    };

    const entries = this.teamLogs.get(teamId) ?? [];
    entries.push(entry);
    if (entries.length > 800) {
      entries.splice(0, entries.length - 800);
    }
    this.teamLogs.set(teamId, entries);
    this.emit('log', { ...entry });
  }

  getLogs(teamId: string, limit = 100): TeamAuditLogEntry[] {
    assertTeamId(teamId);
    const entries = this.teamLogs.get(teamId) ?? [];
    return entries.slice(Math.max(0, entries.length - limit)).map((entry) => ({ ...entry }));
  }

  getTasks(teamId: string, limit = 100): TeamTask[] {
    assertTeamId(teamId);
    const taskOrder = this.teamTaskOrder.get(teamId) ?? [];
    return taskOrder
      .slice(Math.max(0, taskOrder.length - limit))
      .map((taskId) => this.taskMap.get(taskId))
      .filter((task): task is TeamTask => !!task)
      .map((task) => ({ ...task }));
  }

  getRuntime(teamId: string): TeamRuntimeSnapshot {
    assertTeamId(teamId);
    return this.computeRuntimeSnapshot(teamId);
  }

  getRuntimeOverview(): TeamRuntimeSnapshot[] {
    return [...this.teams.keys()].map((teamId) => this.computeRuntimeSnapshot(teamId));
  }

  private emitRuntimeSnapshot(teamId: string): void {
    if (!this.teams.has(teamId)) return;
    const snapshot = this.computeRuntimeSnapshot(teamId);
    this.emit('runtime-changed', { ...snapshot, roles: snapshot.roles.map((role) => ({ ...role })) });
  }

  private isGatewaySessionModeEnabled(): boolean {
    return Boolean(this.gatewayRpc);
  }

  private buildGatewayRoleRuntimeKey(teamId: string, roleId: string): string {
    return `${teamId}:${roleId}`;
  }

  private clearGatewayRoleBusyState(teamId: string): void {
    const prefix = `${teamId}:`;
    for (const key of [...this.gatewayRoleActiveTask.keys()]) {
      if (!key.startsWith(prefix)) continue;
      this.gatewayRoleActiveTask.delete(key);
    }
  }

  private buildGatewayRoleSessionKey(teamId: string, roleId: string): string {
    const teamSegment = sanitizeId(teamId) || 'team';
    const roleSegment = sanitizeId(roleId) || 'role';
    return `${TEAM_GATEWAY_SESSION_KEY_PREFIX}-${teamSegment}-${roleSegment}`;
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

    const directTextCandidates = [
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

    const direct = directTextCandidates
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

  private extractLatestAssistantMarker(history: GatewayChatHistoryMessage[]): GatewayAssistantMarker | null {
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

  private isAssistantMarkerNewer(
    latest: GatewayAssistantMarker,
    baseline: GatewayAssistantMarker | null,
  ): boolean {
    if (!baseline) return true;
    if (latest.index > baseline.index) return true;
    if (latest.id && baseline.id && latest.id !== baseline.id) return true;

    if (
      latest.timestampMs !== undefined &&
      baseline.timestampMs !== undefined &&
      latest.timestampMs > baseline.timestampMs
    ) {
      return true;
    }

    return latest.text !== baseline.text;
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      timer.unref();
    });
  }

  private buildGatewayTaskInput(team: VirtualTeam, role: TeamRoleDefinition, input: string): string {
    const responsibilities = role.responsibilities?.length
      ? role.responsibilities.join('; ')
      : '(none)';
    const boundaries = role.boundaries?.length
      ? role.boundaries.join('; ')
      : '(none)';
    const skills = role.skills?.length
      ? role.skills.join(', ')
      : '(none)';

    return [
      `Team: ${team.name} (${team.id})`,
      `Role: ${role.name} (${role.id})`,
      `Persona: ${role.personality}`,
      `Responsibilities: ${responsibilities}`,
      `Boundaries: ${boundaries}`,
      `Skills: ${skills}`,
      '',
      'Role system prompt:',
      role.agent?.systemPrompt || buildDefaultSystemPrompt(role.name, role.personality, role.skills ?? []),
      '',
      'Task:',
      input,
      '',
      'Output contract:',
      '- Keep answer concise and actionable.',
      '- Prefer bullets and avoid markdown tables.',
      '- Do not execute irreversible actions.',
    ].join('\n');
  }

  private async getGatewayHistory(
    rpc: TeamGatewayRpc,
    sessionKey: string,
  ): Promise<GatewayChatHistoryMessage[]> {
    const raw = await rpc<unknown>(
      'chat.history',
      { sessionKey, limit: TEAM_GATEWAY_HISTORY_LIMIT },
      TEAM_GATEWAY_RPC_TIMEOUT_MS,
    );
    if (Array.isArray(raw)) {
      return raw as GatewayChatHistoryMessage[];
    }

    if (raw && typeof raw === 'object') {
      const messages = (raw as { messages?: unknown }).messages;
      if (Array.isArray(messages)) {
        return messages as GatewayChatHistoryMessage[];
      }
    }

    return [];
  }

  private async waitForGatewayAssistantText(
    rpc: TeamGatewayRpc,
    sessionKey: string,
    baseline: GatewayAssistantMarker | null,
    fallbackText: string,
  ): Promise<string> {
    const deadline = Date.now() + TEAM_GATEWAY_HISTORY_TIMEOUT_MS;
    let latestError: unknown = null;

    while (Date.now() <= deadline) {
      try {
        const history = await this.getGatewayHistory(rpc, sessionKey);
        const latest = this.extractLatestAssistantMarker(history);
        if (latest && this.isAssistantMarkerNewer(latest, baseline)) {
          return latest.text;
        }
      } catch (error) {
        latestError = error;
      }

      await this.sleep(TEAM_GATEWAY_HISTORY_POLL_INTERVAL_MS);
    }

    const fallback = fallbackText.trim();
    if (fallback) {
      return fallback;
    }

    if (latestError) {
      throw new Error(`Gateway history polling failed: ${String(latestError)}`);
    }

    throw new Error('Timed out waiting for assistant output in Gateway session history');
  }

  private async runTaskViaGateway(team: VirtualTeam, role: TeamRoleDefinition, task: TeamTask): Promise<void> {
    const rpc = this.gatewayRpc;
    const runtimeKey = this.buildGatewayRoleRuntimeKey(team.id, role.id);
    if (!rpc) {
      throw new Error('Gateway RPC is unavailable for team dispatch');
    }

    try {
      const sessionKey = this.buildGatewayRoleSessionKey(team.id, role.id);
      const baseline = await this.getGatewayHistory(rpc, sessionKey)
        .then((history) => this.extractLatestAssistantMarker(history))
        .catch(() => null);
      const message = this.buildGatewayTaskInput(team, role, task.input);

      const sendResult = await rpc<unknown>(
        'chat.send',
        {
          sessionKey,
          message,
          deliver: false,
          idempotencyKey: `monoclaw-team:${task.id}:${randomUUID()}`,
        },
        TEAM_GATEWAY_RPC_TIMEOUT_MS,
      );
      const fallbackText = this.extractTextContent(sendResult);
      const output = await this.waitForGatewayAssistantText(rpc, sessionKey, baseline, fallbackText);

      task.status = 'completed';
      task.completedAt = new Date().toISOString();
      task.result = output;
      task.error = undefined;
      this.emit('task-changed', { ...task });
      this.appendLog(team.id, {
        level: 'info',
        source: 'task',
        message: `Task ${task.id} completed by role ${role.id} via OpenClaw session`,
      });
    } catch (error) {
      task.status = 'failed';
      task.completedAt = new Date().toISOString();
      task.error = String(error);
      this.emit('task-changed', { ...task });
      this.appendLog(team.id, {
        level: 'error',
        source: 'task',
        message: `Task ${task.id} failed in role ${role.id}: ${task.error}`,
      });
    } finally {
      if (this.gatewayRoleActiveTask.get(runtimeKey) === task.id) {
        this.gatewayRoleActiveTask.delete(runtimeKey);
      }
      void this.drainTeamQueue(team.id);
      this.emitRuntimeSnapshot(team.id);
    }
  }

  private buildGatewayRoleSnapshot(team: VirtualTeam, role: TeamRoleDefinition): RoleRuntimeSnapshot {
    if (role.enabled === false) {
      return {
        teamId: team.id,
        roleId: role.id,
        roleName: role.name,
        status: 'stopped',
      };
    }

    const currentTaskId = this.gatewayRoleActiveTask.get(this.buildGatewayRoleRuntimeKey(team.id, role.id));
    if (team.status === 'running') {
      return {
        teamId: team.id,
        roleId: role.id,
        roleName: role.name,
        status: currentTaskId ? 'busy' : 'idle',
        currentTaskId,
      };
    }

    if (team.status === 'starting') {
      return {
        teamId: team.id,
        roleId: role.id,
        roleName: role.name,
        status: 'starting',
        currentTaskId,
      };
    }

    if (team.status === 'error') {
      return {
        teamId: team.id,
        roleId: role.id,
        roleName: role.name,
        status: 'error',
        currentTaskId,
        lastError: team.lastError,
      };
    }

    return {
      teamId: team.id,
      roleId: role.id,
      roleName: role.name,
      status: 'stopped',
      currentTaskId,
    };
  }

  private computeRuntimeSnapshot(teamId: string): TeamRuntimeSnapshot {
    const team = this.getRequiredTeam(teamId);
    const roleSnapshots = this.isGatewaySessionModeEnabled()
      ? team.roles.map((role) => this.buildGatewayRoleSnapshot(team, role))
      : (() => {
        const runtimeByRole = new Map(
          this.supervisor.getTeamSnapshots(teamId).map((snapshot) => [snapshot.roleId, snapshot]),
        );
        return team.roles.map((role) => {
          const runtime = runtimeByRole.get(role.id);
          if (runtime) {
            return runtime;
          }
          return {
            teamId,
            roleId: role.id,
            roleName: role.name,
            status: 'stopped',
          } as RoleRuntimeSnapshot;
        });
      })();

    const runningTasks = (this.teamTaskOrder.get(teamId) ?? [])
      .map((taskId) => this.taskMap.get(taskId))
      .filter((task): task is TeamTask => !!task)
      .filter((task) => task.status === 'running').length;

    const queuedTasks = this.teamTaskQueue.get(teamId)?.length ?? 0;

    return {
      teamId,
      status: team.status,
      roles: roleSnapshots,
      runningTasks,
      queuedTasks,
      gatewayConnected:
        team.status === 'running' &&
        team.feishu.enabled &&
        Boolean(team.feishu.appId && team.feishu.appSecret),
      lastUpdatedAt: new Date().toISOString(),
      lastError: team.lastError,
    };
  }

  private buildTeamId(rawName: string): string {
    const base = sanitizeId(rawName || `team-${Date.now()}`);
    if (!base) {
      return `team-${Date.now()}`;
    }

    let candidate = base;
    let index = 1;
    while (this.teams.has(candidate)) {
      candidate = `${base}-${index}`;
      index += 1;
    }
    return candidate;
  }

  private validateRoles(roles: TeamRoleDefinition[]): TeamRoleDefinition[] {
    if (!Array.isArray(roles) || roles.length === 0) {
      throw new Error('At least one role is required to create a team');
    }

    const normalized = uniqueByRoleId(roles.map((role) => normalizeRole(role)));
    if (normalized.length === 0) {
      throw new Error('No valid roles provided');
    }

    return normalized;
  }

  async createTeam(payload: CreateTeamPayload): Promise<VirtualTeam> {
    await this.ensureInitialized();

    const name = payload.name?.trim();
    if (!name) {
      throw new Error('Team name is required');
    }

    const roles = this.validateRoles(payload.roles);
    const now = new Date().toISOString();
    const teamId = this.buildTeamId(name);

    const team: VirtualTeam = {
      id: teamId,
      name,
      domain: payload.domain?.trim() || 'general',
      description: payload.description?.trim() || '',
      defaultCollaborationProtocol: normalizeCollaborationProtocol(payload.defaultCollaborationProtocol),
      templateId: payload.templateId,
      createdAt: now,
      updatedAt: now,
      status: 'stopped',
      roles,
      feishu: buildDefaultFeishuConfig(payload.feishu),
    };

    await this.persistence.ensureTeamFilesystem(team);
    await this.persistence.saveTeam(team);

    this.teams.set(team.id, team);
    this.teamTaskOrder.set(team.id, []);
    this.teamTaskQueue.set(team.id, []);
    this.teamLogs.set(team.id, []);

    this.appendLog(team.id, {
      level: 'info',
      source: 'orchestrator',
      message: `Team created from ${team.templateId ? `template ${team.templateId}` : 'custom configuration'}`,
    });
    this.emitTeamChanged(team);
    this.emitRuntimeSnapshot(team.id);
    return this.toPublicTeam(team);
  }

  async createTeamFromTemplate(templateId: string, customName?: string, locale?: string): Promise<VirtualTeam> {
    await this.ensureInitialized();
    const template = findTeamTemplate(templateId, locale);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    return this.createTeam({
      name: customName?.trim() || template.name,
      domain: template.domain,
      description: template.description,
      templateId: template.id,
      roles: template.roles,
    });
  }

  async updateTeam(teamId: string, payload: UpdateTeamPayload): Promise<VirtualTeam> {
    await this.ensureInitialized();
    const team = this.getRequiredTeam(teamId);

    if (payload.name?.trim()) {
      team.name = payload.name.trim();
    }
    if (payload.domain?.trim()) {
      team.domain = payload.domain.trim();
    }
    if (payload.description !== undefined) {
      team.description = payload.description.trim();
    }
    if (payload.defaultCollaborationProtocol !== undefined) {
      team.defaultCollaborationProtocol = normalizeCollaborationProtocol(payload.defaultCollaborationProtocol);
    }

    let roleStructureChanged = false;
    if (payload.roles) {
      const normalizedRoles = this.validateRoles(payload.roles);
      const oldRoleSignature = JSON.stringify(team.roles.map((role) => role.id));
      const nextRoleSignature = JSON.stringify(normalizedRoles.map((role) => role.id));
      roleStructureChanged = oldRoleSignature !== nextRoleSignature;
      team.roles = normalizedRoles;
    }

    team.updatedAt = new Date().toISOString();
    team.lastError = undefined;

    await this.persistence.ensureTeamFilesystem(team);
    await this.persistence.cleanupStaleRoleDirectories(team);
    await this.persistence.saveTeam(team);

    this.appendLog(team.id, {
      level: 'info',
      source: 'orchestrator',
      message: 'Team configuration updated',
    });

    if (roleStructureChanged && team.status === 'running') {
      await this.hibernateTeam(team.id);
      await this.startTeam(team.id);
    }

    this.emitTeamChanged(team);
    this.emitRuntimeSnapshot(team.id);
    return this.toPublicTeam(team);
  }

  async updateFeishu(teamId: string, payload: UpdateFeishuPayload): Promise<VirtualTeam> {
    await this.ensureInitialized();
    const team = this.getRequiredTeam(teamId);

    if (payload.enabled !== undefined) {
      team.feishu.enabled = payload.enabled;
    }
    if (payload.appId !== undefined) {
      team.feishu.appId = payload.appId.trim();
    }
    if (payload.appSecret !== undefined) {
      const candidate = payload.appSecret.trim();
      if (candidate && candidate !== FEISHU_SECRET_MASK) {
        team.feishu.appSecret = candidate;
      }
      if (!candidate) {
        team.feishu.appSecret = '';
      }
    }
    if (payload.verificationToken !== undefined) {
      team.feishu.verificationToken = payload.verificationToken.trim();
    }
    if (payload.encryptKey !== undefined) {
      team.feishu.encryptKey = payload.encryptKey.trim();
    }
    if (payload.botName !== undefined) {
      team.feishu.botName = payload.botName.trim() || team.feishu.botName;
    }

    team.updatedAt = new Date().toISOString();
    await this.persistence.saveTeam(team);

    this.appendLog(team.id, {
      level: 'info',
      source: 'gateway',
      message: 'Feishu gateway settings updated',
      meta: {
        enabled: team.feishu.enabled,
        appIdConfigured: Boolean(team.feishu.appId),
        appSecretConfigured: Boolean(team.feishu.appSecret),
      },
    });

    this.emitTeamChanged(team);
    this.emitRuntimeSnapshot(team.id);
    return this.toPublicTeam(team);
  }

  async startTeam(teamId: string): Promise<TeamRuntimeSnapshot> {
    await this.ensureInitialized();
    const team = this.getRequiredTeam(teamId);
    const enabledRoles = team.roles.filter((role) => role.enabled);

    if (enabledRoles.length === 0) {
      team.status = 'error';
      team.lastError = 'No enabled roles to start';
      await this.persistence.saveTeam(team);
      this.emitTeamChanged(team);
      this.emitRuntimeSnapshot(team.id);
      throw new Error(team.lastError);
    }

    if (this.isGatewaySessionModeEnabled()) {
      if (team.status === 'running') {
        return this.computeRuntimeSnapshot(teamId);
      }

      try {
        team.status = 'starting';
        team.lastError = undefined;
        team.updatedAt = new Date().toISOString();
        await this.persistence.ensureTeamFilesystem(team);
        await this.persistence.saveTeam(team);
        this.emitTeamChanged(team);
        this.emitRuntimeSnapshot(team.id);

        this.clearGatewayRoleBusyState(team.id);

        team.status = 'running';
        team.lastError = undefined;
        team.updatedAt = new Date().toISOString();
        await this.persistence.saveTeam(team);

        this.appendLog(team.id, {
          level: 'info',
          source: 'orchestrator',
          message: `Team started with ${enabledRoles.length} OpenClaw role session(s)`,
        });

        this.emitTeamChanged(team);
        this.emitRuntimeSnapshot(team.id);
        return this.computeRuntimeSnapshot(team.id);
      } catch (error) {
        team.status = 'error';
        team.lastError = String(error);
        team.updatedAt = new Date().toISOString();
        await this.persistence.saveTeam(team);
        this.appendLog(team.id, {
          level: 'error',
          source: 'orchestrator',
          message: `Failed to start team: ${team.lastError}`,
        });
        this.emitTeamChanged(team);
        this.emitRuntimeSnapshot(team.id);
        throw error;
      }
    }

    if (team.status === 'running') {
      const runtimeByRole = new Map(
        this.supervisor.getTeamSnapshots(teamId).map((snapshot) => [snapshot.roleId, snapshot.status]),
      );
      const missingOrUnhealthyRuntime = enabledRoles.some((role) => {
        const status = runtimeByRole.get(role.id);
        return !status || status === 'stopped' || status === 'error';
      });

      if (!missingOrUnhealthyRuntime) {
        return this.computeRuntimeSnapshot(teamId);
      }

      this.appendLog(team.id, {
        level: 'warn',
        source: 'orchestrator',
        message: 'Detected stale role runtime state while team marked running, rebuilding runtimes',
      });

      await this.supervisor.stopTeam(team.id);
    }

    try {
      team.status = 'starting';
      team.lastError = undefined;
      team.updatedAt = new Date().toISOString();
      await this.persistence.ensureTeamFilesystem(team);
      await this.persistence.saveTeam(team);
      this.emitTeamChanged(team);
      this.emitRuntimeSnapshot(team.id);

      for (const role of enabledRoles) {
        const soulPath = this.persistence.getRoleSoulPath(team.id, role.id);
        const agentBinding = await this.resolveRoleAgentBinding(role);
        if (!agentBinding) {
          this.appendLog(team.id, {
            level: 'warn',
            source: 'orchestrator',
            message: `Role ${role.name} is running without a resolved provider binding; mock runtime fallback will be used.`,
            meta: {
              roleId: role.id,
              provider: role.agent?.provider || DEFAULT_AGENT_PROVIDER,
              model: role.agent?.model || DEFAULT_AGENT_MODEL,
            },
          });
        }
        await this.supervisor.startRole({
          teamId: team.id,
          role,
          soulPath,
          agentBinding,
        });
      }

      team.status = 'running';
      team.lastError = undefined;
      team.updatedAt = new Date().toISOString();
      await this.persistence.saveTeam(team);

      this.appendLog(team.id, {
        level: 'info',
        source: 'orchestrator',
        message: `Team started with ${enabledRoles.length} role process(es)`,
      });

      this.emitTeamChanged(team);
      this.emitRuntimeSnapshot(team.id);
      return this.computeRuntimeSnapshot(team.id);
    } catch (error) {
      team.status = 'error';
      team.lastError = String(error);
      team.updatedAt = new Date().toISOString();
      await this.persistence.saveTeam(team);
      this.appendLog(team.id, {
        level: 'error',
        source: 'orchestrator',
        message: `Failed to start team: ${team.lastError}`,
      });
      this.emitTeamChanged(team);
      this.emitRuntimeSnapshot(team.id);
      throw error;
    }
  }

  async hibernateTeam(teamId: string): Promise<TeamRuntimeSnapshot> {
    await this.ensureInitialized();
    const team = this.getRequiredTeam(teamId);

    if (team.status === 'stopped') {
      return this.computeRuntimeSnapshot(teamId);
    }

    team.status = 'hibernating';
    team.updatedAt = new Date().toISOString();
    await this.persistence.saveTeam(team);
    this.emitTeamChanged(team);
    this.emitRuntimeSnapshot(team.id);

    if (this.isGatewaySessionModeEnabled()) {
      this.clearGatewayRoleBusyState(team.id);
    } else {
      await this.supervisor.stopTeam(team.id);
    }

    team.status = 'stopped';
    team.lastError = undefined;
    team.updatedAt = new Date().toISOString();
    await this.persistence.saveTeam(team);

    this.appendLog(team.id, {
      level: 'info',
      source: 'orchestrator',
      message: this.isGatewaySessionModeEnabled()
        ? 'Team hibernated and Gateway role session dispatch paused'
        : 'Team hibernated and all role runtimes stopped',
    });

    this.emitTeamChanged(team);
    this.emitRuntimeSnapshot(team.id);
    return this.computeRuntimeSnapshot(team.id);
  }

  async dissolveTeam(teamId: string): Promise<void> {
    await this.ensureInitialized();
    const team = this.getRequiredTeam(teamId);

    await this.supervisor.stopTeam(team.id);
    this.clearGatewayRoleBusyState(team.id);
    await this.persistence.removeTeam(team.id);

    this.teams.delete(team.id);
    this.teamTaskQueue.delete(team.id);
    this.teamTaskOrder.delete(team.id);
    this.teamLogs.delete(team.id);

    this.emitTeamRemoved(team.id);
  }

  private registerTask(teamId: string, task: TeamTask, enqueue: boolean): void {
    this.taskMap.set(task.id, task);

    const order = this.teamTaskOrder.get(teamId) ?? [];
    order.push(task.id);
    this.teamTaskOrder.set(teamId, order);

    if (enqueue) {
      const queue = this.teamTaskQueue.get(teamId) ?? [];
      queue.push(task.id);
      this.teamTaskQueue.set(teamId, queue);
    }

    this.emit('task-changed', { ...task });
  }

  private getRoleById(team: VirtualTeam, roleId: string): TeamRoleDefinition {
    const role = team.roles.find((item) => item.id === roleId && item.enabled);
    if (!role) {
      throw new Error(`Collaborative role is unavailable: ${roleId}`);
    }
    return role;
  }

  private buildCollaborativeWorkspacePath(teamId: string, goalId: string): string {
    return join(this.persistence.getTeamDir(teamId), 'goals', goalId);
  }

  private buildCollaborativeStepInput(
    protocol: CollaborationProtocol,
    frame: RoleCollaborationInteraction,
    goalInput: string,
    role: TeamRoleDefinition,
    totalSteps: number,
    workspacePath: string,
    previousOutputs: Array<{ roleName: string; output: string }>,
  ): string {
    const contextSection = previousOutputs.length > 0
      ? previousOutputs
        .slice(-2)
        .map((item, index) => [
          `Context ${index + 1} from ${item.roleName}:`,
          item.output.slice(0, COLLABORATIVE_CONTEXT_SNIPPET_LIMIT),
        ].join('\n'))
        .join('\n\n')
      : 'No previous role outputs yet.';
    const taskLanguage = detectTaskLanguage(goalInput);

    return [
      `Goal-driven collaborative task (${frame.step}/${totalSteps}).`,
      `Protocol: ${protocol}`,
      `Intent: ${frame.intent}`,
      `Target role: ${role.name} (${role.id})`,
      `Interaction: ${frame.fromRoleId} -> ${frame.toRoleId}`,
      `Expected output: ${frame.expectedOutput}`,
      `Response language: ${describeTaskLanguage(taskLanguage)}`,
      '',
      'Goal:',
      goalInput,
      '',
      'Shared workspace:',
      workspacePath,
      '',
      'Latest context:',
      contextSection,
      '',
      'Role skills:',
      role.skills && role.skills.length > 0 ? role.skills.join(', ') : '(no skill binding)',
      '',
      'Output requirements:',
      '- Be concise and actionable.',
      `- Keep the response under ${COLLABORATIVE_OUTPUT_WORD_LIMIT} words whenever possible.`,
      '- Follow the response language setting above.',
      '- State assumptions and unresolved blockers clearly.',
      '- Return role-specific deliverables for handoff to next role.',
      '- Prefer bullets over long paragraphs.',
      '- Use at most 5 bullets unless the task explicitly requires more.',
      '- Do not use markdown tables or fenced code blocks.',
      '- If you provide options, cap the list at 3 items.',
      '- Do not repeat the full shared context; return only the decision, evidence, and handoff delta.',
      '- If blocked, explicitly list the missing information before handoff.',
    ].join('\n');
  }

  private waitForTaskTerminalState(taskId: string, timeoutMs = COLLABORATIVE_TASK_TIMEOUT_MS): Promise<TeamTask> {
    const immediate = this.taskMap.get(taskId);
    if (immediate && (immediate.status === 'completed' || immediate.status === 'failed')) {
      return Promise.resolve({ ...immediate });
    }

    return new Promise<TeamTask>((resolve, reject) => {
      const finish = (task: TeamTask) => {
        clearTimeout(timeout);
        this.off('task-changed', onTaskChanged);
        resolve({ ...task });
      };

      const onTaskChanged = (task: TeamTask) => {
        if (task.id !== taskId) return;
        if (task.status !== 'completed' && task.status !== 'failed') return;
        finish(task);
      };

      const timeout = setTimeout(() => {
        this.off('task-changed', onTaskChanged);
        reject(new Error(`Task timed out while waiting for completion: ${taskId}`));
      }, timeoutMs);
      timeout.unref();

      this.on('task-changed', onTaskChanged);

      const latest = this.taskMap.get(taskId);
      if (latest && (latest.status === 'completed' || latest.status === 'failed')) {
        finish(latest);
      }
    });
  }

  private async runCollaborativeGoal(
    team: VirtualTeam,
    rootTask: TeamTask,
    plan: RoleCollaborationPlan,
  ): Promise<void> {
    const collaboration = rootTask.collaboration;
    if (!collaboration) {
      throw new Error('Missing collaboration metadata on root goal task');
    }

    const { goalId, workspacePath } = collaboration;
    const totalSteps = plan.interactions.length;
    const stepDir = join(workspacePath || '', 'steps');

    try {
      await mkdir(stepDir, { recursive: true, mode: 0o700 });

      const goalDocument = [
        `# Goal ${goalId}`,
        '',
        `- Team: ${team.name} (${team.id})`,
        `- Requested at: ${rootTask.requestedAt}`,
        `- Protocol: ${plan.protocol}`,
        `- Total steps: ${totalSteps}`,
        `- Role sequence: ${plan.roleSequence.join(' -> ')}`,
        '',
        '## Goal Input',
        rootTask.input,
        '',
      ].join('\n');
      await writeFile(join(workspacePath || '', 'GOAL.md'), goalDocument, { encoding: 'utf-8', mode: 0o600 });

      const stepOutputs: Array<{ step: number; role: TeamRoleDefinition; taskId: string; output: string }> = [];

      for (const frame of plan.interactions) {
        const role = this.getRoleById(team, frame.executorRoleId);
        const step = frame.step;
        const stepInput = this.buildCollaborativeStepInput(
          plan.protocol,
          frame,
          rootTask.input,
          role,
          totalSteps,
          workspacePath || '',
          stepOutputs.map((item) => ({ roleName: item.role.name, output: item.output })),
        );

        this.appendLog(team.id, {
          level: 'info',
          source: 'task',
          message: `Collaborative step ${step}/${totalSteps} started: ${frame.intent} by ${role.name}`,
          meta: {
            goalId,
            rootTaskId: rootTask.id,
            step,
            roleId: role.id,
            protocol: plan.protocol,
            intent: frame.intent,
            fromRoleId: frame.fromRoleId,
            toRoleId: frame.toRoleId,
          },
        });

        const childTask = await this.dispatchTask(team.id, {
          input: stepInput,
          requestedRoleId: role.id,
        });

        const childTaskRef = this.taskMap.get(childTask.id);
        if (!childTaskRef) {
          throw new Error(`Collaborative step task is missing after dispatch: ${childTask.id}`);
        }

        childTaskRef.collaboration = {
          enabled: true,
          goalId,
          protocol: plan.protocol,
          isRoot: false,
          parentTaskId: rootTask.id,
          step,
          totalSteps,
          intent: frame.intent,
          interactionId: frame.id,
          fromRoleId: frame.fromRoleId,
          toRoleId: frame.toRoleId,
          expectedOutput: frame.expectedOutput,
          workspacePath,
          roleSequence: plan.roleSequence,
        };
        this.emit('task-changed', { ...childTaskRef });

        const finishedChildTask = await this.waitForTaskTerminalState(childTask.id);
        if (finishedChildTask.status !== 'completed') {
          throw new Error(finishedChildTask.error || `Collaborative step failed: ${finishedChildTask.id}`);
        }

        const stepOutput = finishedChildTask.result?.trim() || '(empty output)';
        stepOutputs.push({
          step,
          role,
          taskId: finishedChildTask.id,
          output: stepOutput,
        });

        const stepFileName = [
          String(step).padStart(2, '0'),
          toSafeFileSegment(frame.intent),
          toSafeFileSegment(role.id),
        ].join('-') + '.md';
        const stepDocument = [
          `# Step ${step}/${totalSteps}`,
          '',
          `- Protocol: ${plan.protocol}`,
          `- Intent: ${frame.intent}`,
          `- Interaction: ${frame.fromRoleId} -> ${frame.toRoleId}`,
          `- Role: ${role.name} (${role.id})`,
          `- Task ID: ${finishedChildTask.id}`,
          `- Completed at: ${finishedChildTask.completedAt || new Date().toISOString()}`,
          '',
          '## Input',
          stepInput,
          '',
          '## Output',
          stepOutput,
          '',
        ].join('\n');
        await writeFile(join(stepDir, stepFileName), stepDocument, { encoding: 'utf-8', mode: 0o600 });

        this.appendLog(team.id, {
          level: 'info',
          source: 'task',
          message: `Collaborative step ${step}/${totalSteps} completed: ${frame.intent} by ${role.name}`,
          meta: {
            goalId,
            rootTaskId: rootTask.id,
            childTaskId: finishedChildTask.id,
            step,
            roleId: role.id,
            protocol: plan.protocol,
            intent: frame.intent,
          },
        });
      }

      const rawFinalOutput = stepOutputs[stepOutputs.length - 1]?.output || '';
      const finalOutput = sanitizeCollaborativeOutput(rawFinalOutput);
      const fallbackResult = getFallbackCollaborativeOutput(detectTaskLanguage(rootTask.input));
      const resultDocument = [
        `# Collaborative Result ${goalId}`,
        '',
        `- Team: ${team.name} (${team.id})`,
        `- Protocol: ${plan.protocol}`,
        `- Root task: ${rootTask.id}`,
        `- Finished at: ${new Date().toISOString()}`,
        '',
        '## Step Outputs',
        ...stepOutputs.map((item) => [
          `### Step ${item.step}: ${item.role.name} (${item.role.id})`,
          item.output,
          '',
        ].join('\n')),
        '## Final Synthesis',
        finalOutput || fallbackResult,
        '',
      ].join('\n');
      await writeFile(join(workspacePath || '', 'RESULT.md'), resultDocument, { encoding: 'utf-8', mode: 0o600 });

      rootTask.status = 'completed';
      rootTask.completedAt = new Date().toISOString();
      rootTask.result = finalOutput || fallbackResult;
      rootTask.error = undefined;
      this.emit('task-changed', { ...rootTask });
      this.appendLog(team.id, {
        level: 'info',
        source: 'task',
        message: `Collaborative goal ${goalId} completed`,
        meta: {
          goalId,
          rootTaskId: rootTask.id,
          totalSteps,
        },
      });
    } catch (error) {
      const errorText = String(error);
      rootTask.status = 'failed';
      rootTask.completedAt = new Date().toISOString();
      rootTask.error = errorText;
      this.emit('task-changed', { ...rootTask });
      this.appendLog(team.id, {
        level: 'error',
        source: 'task',
        message: `Collaborative goal ${goalId} failed: ${errorText}`,
        meta: {
          goalId,
          rootTaskId: rootTask.id,
        },
      });

      if (workspacePath) {
        const errorDocument = [
          `# Collaborative Goal Error ${goalId}`,
          '',
          `- Root task: ${rootTask.id}`,
          `- Failed at: ${new Date().toISOString()}`,
          '',
          '## Error',
          errorText,
          '',
        ].join('\n');
        try {
          await mkdir(workspacePath, { recursive: true, mode: 0o700 });
          await writeFile(join(workspacePath, 'ERROR.md'), errorDocument, { encoding: 'utf-8', mode: 0o600 });
        } catch {
          // Keep root task failure as source of truth even if workspace error report cannot be written.
        }
      }
    } finally {
      this.emitRuntimeSnapshot(team.id);
    }
  }

  async dispatchTask(teamId: string, payload: DispatchTaskPayload): Promise<TeamTask> {
    await this.ensureInitialized();
    const team = this.getRequiredTeam(teamId);

    if (team.status !== 'running') {
      throw new Error('Team is not running. Start the team before dispatching tasks.');
    }

    const input = payload.input?.trim();
    if (!input) {
      throw new Error('Task input is required');
    }

    if (payload.collaborative === true) {
      const plan = buildRoleCollaborationPlan({
        team,
        goalInput: input,
        requestedRoleId: payload.requestedRoleId,
        protocol: payload.collaborationProtocol,
      });
      const goalId = plan.goalId;
      const workspacePath = this.buildCollaborativeWorkspacePath(team.id, goalId);
      const now = new Date().toISOString();

      const rootTask: TeamTask = {
        id: randomUUID(),
        teamId: team.id,
        input,
        requestedAt: now,
        routeMode: 'collaborative',
        requestedRoleId: payload.requestedRoleId,
        assignedRoleId: plan.coordinatorRoleId,
        status: 'running',
        startedAt: now,
        collaboration: {
          enabled: true,
          goalId,
          protocol: plan.protocol,
          isRoot: true,
          totalSteps: plan.interactions.length,
          workspacePath,
          roleSequence: plan.roleSequence,
        },
      };

      this.registerTask(team.id, rootTask, false);
      this.appendLog(team.id, {
        level: 'info',
        source: 'task',
        message: `Collaborative goal started with protocol ${plan.protocol}`,
        meta: {
          taskId: rootTask.id,
          goalId,
          totalSteps: plan.interactions.length,
          coordinatorRoleId: plan.coordinatorRoleId,
          protocol: plan.protocol,
          workspacePath,
        },
      });
      this.emitRuntimeSnapshot(team.id);
      void this.runCollaborativeGoal(team, rootTask, plan);
      return { ...rootTask };
    }

    const routed = routeRole(team.roles, input, payload.requestedRoleId);
    const task: TeamTask = {
      id: randomUUID(),
      teamId: team.id,
      input,
      requestedAt: new Date().toISOString(),
      routeMode: routed.mode,
      requestedRoleId: routed.requestedRoleId,
      assignedRoleId: routed.role.id,
      status: 'queued',
    };

    this.registerTask(team.id, task, true);
    this.appendLog(team.id, {
      level: 'info',
      source: 'task',
      message: `Task queued for role ${routed.role.name}`,
      meta: {
        taskId: task.id,
        routeMode: task.routeMode,
        assignedRoleId: task.assignedRoleId,
      },
    });

    this.emitRuntimeSnapshot(team.id);
    await this.drainTeamQueue(team.id);
    return { ...task };
  }

  private async drainTeamQueue(teamId: string): Promise<void> {
    if (this.drainingQueue.has(teamId)) {
      return;
    }

    // Serialize queue draining per team to avoid duplicate dispatch attempts.
    this.drainingQueue.add(teamId);

    try {
      const queue = this.teamTaskQueue.get(teamId);
      if (!queue || queue.length === 0) {
        return;
      }
      const initialTeam = this.teams.get(teamId);
      if (!initialTeam || initialTeam.status !== 'running') {
        return;
      }

      while (true) {
        const queueIds = this.teamTaskQueue.get(teamId);
        if (!queueIds || queueIds.length === 0) {
          break;
        }

        const team = this.teams.get(teamId);
        if (!team || team.status !== 'running') {
          break;
        }

        const runtimeState = this.isGatewaySessionModeEnabled()
          ? new Map(
            team.roles
              .filter((role) => role.enabled)
              .map((role) => [
                role.id,
                this.gatewayRoleActiveTask.has(this.buildGatewayRoleRuntimeKey(teamId, role.id))
                  ? 'busy'
                  : 'idle',
              ]),
          )
          : new Map(
            this.supervisor
              .getTeamSnapshots(teamId)
              .map((snapshot) => [snapshot.roleId, snapshot.status]),
          );

        let dispatchedAny = false;

        for (let index = 0; index < queueIds.length; index += 1) {
          const taskId = queueIds[index];
          const task = this.taskMap.get(taskId);
          if (!task || task.status !== 'queued') {
            queueIds.splice(index, 1);
            index -= 1;
            continue;
          }

          const roleStatus = runtimeState.get(task.assignedRoleId);
          if (roleStatus !== 'idle') {
            continue;
          }

          task.status = 'running';
          task.startedAt = new Date().toISOString();
          this.emit('task-changed', { ...task });

          queueIds.splice(index, 1);
          index -= 1;

          if (this.isGatewaySessionModeEnabled()) {
            const role = team.roles.find((item) => item.id === task.assignedRoleId && item.enabled);
            if (!role) {
              task.status = 'failed';
              task.error = `Role is unavailable: ${task.assignedRoleId}`;
              task.completedAt = new Date().toISOString();
              this.emit('task-changed', { ...task });
              this.appendLog(teamId, {
                level: 'error',
                source: 'task',
                message: `Task ${task.id} dispatch failed: ${task.error}`,
              });
              continue;
            }

            const runtimeKey = this.buildGatewayRoleRuntimeKey(teamId, role.id);
            this.gatewayRoleActiveTask.set(runtimeKey, task.id);
            runtimeState.set(task.assignedRoleId, 'busy');
            dispatchedAny = true;
            void this.runTaskViaGateway(team, role, task).catch((error) => {
              logger.error('Unhandled gateway team task execution error:', error);
            });
            continue;
          }

          try {
            await this.supervisor.dispatchTask(teamId, task.assignedRoleId, task.id, task.input);
            runtimeState.set(task.assignedRoleId, 'busy');
            dispatchedAny = true;
          } catch (error) {
            task.status = 'failed';
            task.error = String(error);
            task.completedAt = new Date().toISOString();
            this.emit('task-changed', { ...task });
            this.appendLog(teamId, {
              level: 'error',
              source: 'task',
              message: `Task ${task.id} dispatch failed: ${task.error}`,
            });
          }
        }

        if (!dispatchedAny) {
          break;
        }
      }
    } finally {
      this.drainingQueue.delete(teamId);
      this.emitRuntimeSnapshot(teamId);
    }
  }

  async shutdownAllTeams(): Promise<void> {
    await this.supervisor.stopAll();

    for (const team of this.teams.values()) {
      this.clearGatewayRoleBusyState(team.id);
      if (team.status === 'running' || team.status === 'starting' || team.status === 'hibernating') {
        team.status = 'stopped';
        team.updatedAt = new Date().toISOString();
        await this.persistence.saveTeam(team);
      }
    }
  }
}
