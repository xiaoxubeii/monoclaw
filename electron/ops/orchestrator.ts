import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { GatewayManager, GatewayStatus } from '../gateway/manager';
import type { TeamOrchestrator } from '../team/orchestrator';
import type { TeamRuntimeSnapshot } from '../team/types';
import type { LocalModelManager, LocalModelRuntimeStatus } from '../utils/local-model-manager';
import { getOpenClawEntryPath, getOpenClawStatus } from '../utils/paths';
import { getDefaultProvider, getProvider } from '../utils/secure-storage';
import { logger } from '../utils/logger';
import { DEFAULT_OPS_POLICY, OpsStateStore } from './store';
import type {
  OpsActionRecord,
  OpsActionType,
  OpsEvent,
  OpsHealthSnapshot,
  OpsOverviewPayload,
  OpsPolicy,
  OpsStatusPayload,
  OpsSubsystem,
  OpsSubsystemHealth,
  OpsSymptomCode,
} from './types';

const CHECK_INTERVAL_MS = 30000;
const MIN_MANUAL_CHECK_GAP_MS = 3000;
const DEFAULT_OVERVIEW_LIMIT = 50;
const DOCTOR_CHECK_INTERVAL_MS = 15 * 60 * 1000;
const COPILOT_REQUEST_TIMEOUT_MS = 8000;

interface HealthFacts {
  gatewayStatus: GatewayStatus;
  gatewayHealth: { ok: boolean; error?: string; uptime?: number };
  localModelStatus: LocalModelRuntimeStatus;
  defaultProviderType: string | null;
  defaultProviderModel: string | null;
  runtimeOverview: TeamRuntimeSnapshot[];
  doctorCheckOk?: boolean;
  doctorCheckSummary?: string;
  copilotModel: string | null;
}

interface DetectedSymptom {
  code: OpsSymptomCode;
  subsystem: OpsSubsystem;
  severity: 'info' | 'warn' | 'error';
  summary: string;
  rootCause: string;
  recommendedActions: OpsActionType[];
  details?: Record<string, unknown>;
}

interface DoctorResult {
  success: boolean;
  code: number | null;
  output: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function toHealth(status: OpsHealthSnapshot['overall'], message: string): OpsSubsystemHealth {
  return {
    status,
    message,
    updatedAt: nowIso(),
  };
}

function computeOverallStatus(parts: OpsSubsystemHealth[]): OpsHealthSnapshot['overall'] {
  if (parts.some((part) => part.status === 'critical')) return 'critical';
  if (parts.some((part) => part.status === 'degraded')) return 'degraded';
  return 'healthy';
}

function computeScore(parts: OpsSubsystemHealth[]): number {
  let score = 100;
  for (const part of parts) {
    if (part.status === 'critical') score -= 30;
    else if (part.status === 'degraded') score -= 10;
  }
  return Math.max(0, score);
}

export class OpsOrchestrator extends EventEmitter {
  private readonly store = new OpsStateStore();

  private readonly symptomLastSeenAt = new Map<OpsSymptomCode, number>();
  private readonly actionRetryCounter = new Map<string, number>();

  private started = false;
  private checkTimer: NodeJS.Timeout | null = null;
  private checkInFlight: Promise<OpsOverviewPayload> | null = null;
  private lastCheckAtMs = 0;
  private lastDoctorCheckAtMs = 0;

  private policy: OpsPolicy = { ...DEFAULT_OPS_POLICY };
  private paused = false;

  constructor(
    private readonly gatewayManager: GatewayManager,
    private readonly teamOrchestrator: TeamOrchestrator,
    private readonly localModelManager: LocalModelManager,
  ) {
    super();
  }

  async start(): Promise<void> {
    if (this.started) return;

    const initial = await this.store.load();
    this.policy = {
      ...DEFAULT_OPS_POLICY,
      ...(initial.policy || {}),
    };
    this.paused = initial.paused;

    this.bindSources();
    this.checkTimer = setInterval(() => {
      void this.runCheckNow('scheduled').catch((error) => {
        logger.warn('[Ops] scheduled check failed:', error);
      });
    }, CHECK_INTERVAL_MS);
    this.checkTimer.unref();

    this.started = true;
    await this.runCheckNow('startup');
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;

    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }

    this.removeAllListeners();
  }

  async getStatus(): Promise<OpsStatusPayload> {
    const data = await this.store.load();
    const fallbackSnapshot: OpsHealthSnapshot = {
      overall: 'degraded',
      score: 60,
      subsystems: {
        gateway: toHealth('degraded', 'Initializing checks...'),
        openclaw: toHealth('degraded', 'Initializing checks...'),
        localModel: toHealth('degraded', 'Initializing checks...'),
        teams: toHealth('degraded', 'Initializing checks...'),
        scheduler: toHealth('healthy', 'Scheduler running'),
        copilot: toHealth('degraded', 'Copilot not evaluated yet'),
      },
      updatedAt: nowIso(),
      lastCheckAt: nowIso(),
      activeIncidents: 0,
      autoRemediationEnabled: this.policy.autoRemediationEnabled,
      paused: this.paused,
      copilotAvailable: false,
    };

    return {
      snapshot: data.lastSnapshot || fallbackSnapshot,
      policy: { ...this.policy },
      paused: this.paused,
      lastDoctorAt: data.lastDoctorAt,
      lastDoctorOk: data.lastDoctorOk,
    };
  }

  async listEvents(limit = DEFAULT_OVERVIEW_LIMIT): Promise<OpsEvent[]> {
    const state = await this.store.load();
    const safeLimit = Math.max(1, Math.min(300, Math.floor(limit)));
    return state.events.slice(-safeLimit).reverse();
  }

  async listActions(limit = DEFAULT_OVERVIEW_LIMIT): Promise<OpsActionRecord[]> {
    const state = await this.store.load();
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    return state.actions.slice(-safeLimit).reverse();
  }

  async getOverview(limit = DEFAULT_OVERVIEW_LIMIT): Promise<OpsOverviewPayload> {
    const [status, events, actions] = await Promise.all([
      this.getStatus(),
      this.listEvents(limit),
      this.listActions(limit),
    ]);

    return {
      status,
      events,
      actions,
    };
  }

  async runCheckNow(trigger: 'manual' | 'scheduled' | 'event' | 'startup' = 'manual'): Promise<OpsOverviewPayload> {
    const now = Date.now();
    if (trigger === 'manual' && now - this.lastCheckAtMs < MIN_MANUAL_CHECK_GAP_MS) {
      return this.getOverview();
    }

    if (this.checkInFlight) {
      return this.checkInFlight;
    }

    this.checkInFlight = this.executeCheck(trigger)
      .finally(() => {
        this.checkInFlight = null;
      });

    return this.checkInFlight;
  }

  async pauseAutoRemediation(): Promise<OpsStatusPayload> {
    this.paused = true;
    await this.store.setPaused(true);
    await this.emitUpdated();
    return this.getStatus();
  }

  async resumeAutoRemediation(): Promise<OpsStatusPayload> {
    this.paused = false;
    await this.store.setPaused(false);
    await this.emitUpdated();
    return this.getStatus();
  }

  private bindSources(): void {
    this.gatewayManager.on('status', () => {
      void this.runCheckNow('event');
    });

    this.gatewayManager.on('error', () => {
      void this.runCheckNow('event');
    });

    this.gatewayManager.on('exit', () => {
      void this.runCheckNow('event');
    });

    this.teamOrchestrator.on('runtime-changed', () => {
      void this.runCheckNow('event');
    });
  }

  private async executeCheck(trigger: 'manual' | 'scheduled' | 'event' | 'startup'): Promise<OpsOverviewPayload> {
    const checkId = randomUUID();
    this.lastCheckAtMs = Date.now();

    try {
      await this.teamOrchestrator.ensureInitialized();
    } catch (error) {
      logger.warn('[Ops] team orchestrator init failed during check:', error);
    }

    const facts = await this.collectFacts(trigger);
    const symptoms = this.detectSymptoms(facts);

    const activeSymptomCodes = new Set(symptoms.map((symptom) => symptom.code));
    for (const retryKey of this.actionRetryCounter.keys()) {
      const symptomCode = retryKey.split(':', 1)[0] as OpsSymptomCode;
      if (!activeSymptomCodes.has(symptomCode)) {
        this.actionRetryCounter.delete(retryKey);
      }
    }

    const activeEvents: OpsEvent[] = [];
    for (const symptom of symptoms) {
      const event = await this.recordSymptomEvent(symptom, checkId, facts);
      if (event) {
        activeEvents.push(event);
      }
    }

    if (this.policy.autoRemediationEnabled && !this.paused) {
      for (const event of activeEvents) {
        const symptom = symptoms.find((item) => item.code === event.symptomCode);
        if (!symptom) continue;
        await this.tryAutoRemediation(symptom, event, checkId, facts);
      }
    }

    const snapshot = this.buildSnapshot(facts, symptoms.length);
    await this.store.setSnapshot(snapshot);
    await this.emitUpdated();

    return this.getOverview();
  }

  private async collectFacts(trigger: 'manual' | 'scheduled' | 'event' | 'startup'): Promise<HealthFacts> {
    const [gatewayHealth, localModelStatus] = await Promise.all([
      this.gatewayManager.checkHealth(),
      this.localModelManager.getStatus(),
    ]);

    const gatewayStatus = this.gatewayManager.getStatus();

    const defaultProviderId = await getDefaultProvider().catch(() => null);
    let defaultProviderType: string | null = null;
    let defaultProviderModel: string | null = null;
    if (defaultProviderId) {
      const provider = await getProvider(defaultProviderId).catch(() => null);
      defaultProviderType = provider?.type ?? null;
      defaultProviderModel = provider?.model ?? null;
    }

    const runtimeOverview = this.teamOrchestrator.getRuntimeOverview();

    const now = Date.now();
    const shouldRunDoctor =
      trigger === 'manual'
      || trigger === 'startup'
      || gatewayStatus.state === 'error'
      || !gatewayHealth.ok
      || (now - this.lastDoctorCheckAtMs) > DOCTOR_CHECK_INTERVAL_MS;

    let doctorCheckOk: boolean | undefined;
    let doctorCheckSummary: string | undefined;

    if (shouldRunDoctor) {
      const doctor = await this.runOpenClawDoctor(false, 45000);
      doctorCheckOk = doctor.success;
      doctorCheckSummary = doctor.output;
      this.lastDoctorCheckAtMs = now;
      await this.store.setLastDoctorResult(doctor.success);
    }

    const copilotModel = this.resolveCopilotModel(localModelStatus);

    return {
      gatewayStatus,
      gatewayHealth,
      localModelStatus,
      defaultProviderType,
      defaultProviderModel,
      runtimeOverview,
      doctorCheckOk,
      doctorCheckSummary,
      copilotModel,
    };
  }

  private detectSymptoms(facts: HealthFacts): DetectedSymptom[] {
    const symptoms: DetectedSymptom[] = [];

    if (facts.gatewayStatus.state === 'stopped' || facts.gatewayStatus.state === 'error') {
      symptoms.push({
        code: 'gateway_not_running',
        subsystem: 'gateway',
        severity: 'error',
        summary: `Gateway is ${facts.gatewayStatus.state}.`,
        rootCause: facts.gatewayStatus.error || 'Gateway process is not available.',
        recommendedActions: ['gateway.start', 'openclaw.doctor.fix'],
        details: {
          state: facts.gatewayStatus.state,
          error: facts.gatewayStatus.error,
        },
      });
    } else if (facts.gatewayStatus.state === 'running' && !facts.gatewayHealth.ok) {
      symptoms.push({
        code: 'gateway_health_failed',
        subsystem: 'gateway',
        severity: 'warn',
        summary: 'Gateway is running but health check failed.',
        rootCause: facts.gatewayHealth.error || 'WebSocket heartbeat is unhealthy.',
        recommendedActions: ['gateway.restart', 'openclaw.doctor.fix'],
        details: {
          state: facts.gatewayStatus.state,
          health: facts.gatewayHealth,
        },
      });
    }

    if (
      facts.defaultProviderType === 'ollama'
      && facts.localModelStatus.runtimeInstalled
      && !facts.localModelStatus.serviceRunning
    ) {
      symptoms.push({
        code: 'local_model_service_down',
        subsystem: 'localModel',
        severity: 'warn',
        summary: 'Local model provider is enabled, but Ollama service is down.',
        rootCause: 'Ollama process is not listening on 127.0.0.1:11434.',
        recommendedActions: ['localModel.service.start', 'gateway.restart'],
        details: {
          defaultProviderType: facts.defaultProviderType,
          defaultProviderModel: facts.defaultProviderModel,
          runtimeInstalled: facts.localModelStatus.runtimeInstalled,
          serviceRunning: facts.localModelStatus.serviceRunning,
        },
      });
    }

    const erroredTeams = facts.runtimeOverview.filter((runtime) => {
      if (runtime.status === 'error') return true;
      return runtime.roles.some((role) => role.status === 'error');
    });

    if (erroredTeams.length > 0) {
      symptoms.push({
        code: 'team_runtime_error',
        subsystem: 'teams',
        severity: 'warn',
        summary: `${erroredTeams.length} team runtime(s) reported role errors.`,
        rootCause: 'One or more role worker processes crashed or lost heartbeat.',
        recommendedActions: ['teams.restartErrored'],
        details: {
          teamIds: erroredTeams.map((item) => item.teamId),
        },
      });
    }

    if (facts.doctorCheckOk === false) {
      symptoms.push({
        code: 'openclaw_validation_issue',
        subsystem: 'openclaw',
        severity: 'error',
        summary: 'OpenClaw doctor reported configuration/runtime issues.',
        rootCause: 'OpenClaw doctor check failed.',
        recommendedActions: ['openclaw.doctor.fix', 'gateway.restart'],
        details: {
          doctorSummary: facts.doctorCheckSummary?.slice(0, 1200),
        },
      });
    }

    return symptoms;
  }

  private async recordSymptomEvent(
    symptom: DetectedSymptom,
    checkId: string,
    facts: HealthFacts,
  ): Promise<OpsEvent | null> {
    const now = Date.now();
    const lastTs = this.symptomLastSeenAt.get(symptom.code) ?? 0;
    if (now - lastTs < Math.max(30000, this.policy.cooldownMs)) {
      return null;
    }
    this.symptomLastSeenAt.set(symptom.code, now);

    const copilotSummary = await this.generateCopilotSummary(symptom, facts);

    const event: OpsEvent = {
      id: randomUUID(),
      ts: nowIso(),
      severity: symptom.severity,
      subsystem: symptom.subsystem,
      symptomCode: symptom.code,
      summary: symptom.summary,
      rootCause: symptom.rootCause,
      recommendedActionIds: symptom.recommendedActions,
      checkId,
      details: symptom.details,
      copilotSummary: copilotSummary || undefined,
    };

    await this.store.appendEvent(event);
    this.emit('event', event);
    return event;
  }

  private async tryAutoRemediation(
    symptom: DetectedSymptom,
    event: OpsEvent,
    checkId: string,
    facts: HealthFacts,
  ): Promise<void> {
    for (const action of symptom.recommendedActions) {
      const record = await this.executeAction(action, event.id, checkId, facts, symptom.code);
      if (record.status === 'success') {
        return;
      }
      if (record.status === 'blocked') {
        return;
      }
    }
  }

  private async executeAction(
    actionType: OpsActionType,
    eventId: string,
    checkId: string,
    facts: HealthFacts,
    symptomCode: OpsSymptomCode,
  ): Promise<OpsActionRecord> {
    const startedAt = nowIso();
    const actionId = randomUUID();
    const retryKey = `${symptomCode}:${actionType}`;

    const baseline: OpsActionRecord = {
      id: actionId,
      eventId,
      checkId,
      actionType,
      level: 'L1',
      status: 'running',
      startedAt,
      meta: {
        symptomCode,
      },
    };

    const attempts = this.actionRetryCounter.get(retryKey) ?? 0;
    if (!this.policy.allowedAutoActions.includes(actionType)) {
      const blocked = {
        ...baseline,
        status: 'blocked' as const,
        endedAt: nowIso(),
        verifyResult: 'Action is not in allowed auto-remediation list.',
      };
      await this.store.appendAction(blocked);
      this.emit('action', blocked);
      return blocked;
    }

    if (attempts >= this.policy.maxRetryPerAction) {
      const blocked = {
        ...baseline,
        status: 'blocked' as const,
        endedAt: nowIso(),
        verifyResult: `Retry cap reached (${this.policy.maxRetryPerAction}).`,
      };
      await this.store.appendAction(blocked);
      this.emit('action', blocked);
      return blocked;
    }

    this.actionRetryCounter.set(retryKey, attempts + 1);

    await this.store.appendAction(baseline);

    try {
      await this.runAction(actionType, facts);
      const verifyResult = await this.verifyAction(actionType);
      const success: OpsActionRecord = {
        ...baseline,
        status: 'success',
        endedAt: nowIso(),
        durationMs: Date.now() - Date.parse(startedAt),
        verifyResult,
      };
      this.actionRetryCounter.delete(retryKey);
      await this.store.updateAction(actionId, success);
      this.emit('action', success);
      return success;
    } catch (error) {
      const failed: OpsActionRecord = {
        ...baseline,
        status: 'failed',
        endedAt: nowIso(),
        durationMs: Date.now() - Date.parse(startedAt),
        error: String(error),
      };
      await this.store.updateAction(actionId, failed);
      this.emit('action', failed);
      return failed;
    }
  }

  private async runAction(actionType: OpsActionType, facts: HealthFacts): Promise<void> {
    switch (actionType) {
      case 'gateway.start':
        if (this.gatewayManager.getStatus().state !== 'running') {
          await this.gatewayManager.start();
        }
        return;
      case 'gateway.restart':
        await this.gatewayManager.restart();
        return;
      case 'openclaw.doctor.fix': {
        const result = await this.runOpenClawDoctor(true, 120000);
        if (!result.success) {
          throw new Error(`openclaw doctor --fix failed: ${result.output}`);
        }
        return;
      }
      case 'localModel.service.start':
        await this.localModelManager.ensureServiceRunning();
        return;
      case 'teams.restartErrored': {
        await this.teamOrchestrator.ensureInitialized();
        const errored = this.teamOrchestrator.getRuntimeOverview().filter((runtime) => {
          if (runtime.status === 'error') return true;
          return runtime.roles.some((role) => role.status === 'error');
        });

        for (const runtime of errored) {
          try {
            await this.teamOrchestrator.startTeam(runtime.teamId);
          } catch (error) {
            logger.warn(`[Ops] failed to restart team ${runtime.teamId}:`, error);
          }
        }
        return;
      }
      default:
        return;
    }
  }

  private async verifyAction(actionType: OpsActionType): Promise<string> {
    switch (actionType) {
      case 'gateway.start':
      case 'gateway.restart': {
        const status = this.gatewayManager.getStatus();
        const health = await this.gatewayManager.checkHealth();
        if (status.state !== 'running' || !health.ok) {
          throw new Error(`Gateway verification failed (state=${status.state}, health=${health.ok})`);
        }
        return `Gateway healthy (state=${status.state})`;
      }
      case 'openclaw.doctor.fix': {
        const check = await this.runOpenClawDoctor(false, 45000);
        if (!check.success) {
          throw new Error('Post-fix doctor check failed');
        }
        return 'Doctor check passed after fix';
      }
      case 'localModel.service.start': {
        const status = await this.localModelManager.getStatus();
        if (!status.serviceRunning) {
          throw new Error('Ollama service is still unavailable after restart');
        }
        return 'Ollama service is running';
      }
      case 'teams.restartErrored': {
        const stillErrored = this.teamOrchestrator.getRuntimeOverview().filter((runtime) =>
          runtime.roles.some((role) => role.status === 'error')
        );
        if (stillErrored.length > 0) {
          throw new Error(`Still ${stillErrored.length} team runtime(s) in error`);
        }
        return 'No errored team role runtime remains';
      }
      default:
        return 'No verification needed';
    }
  }

  private buildSnapshot(facts: HealthFacts, activeIncidents: number): OpsHealthSnapshot {
    const gateway = (() => {
      if (facts.gatewayStatus.state === 'running' && facts.gatewayHealth.ok) {
        return toHealth('healthy', 'Gateway running and connected');
      }
      if (facts.gatewayStatus.state === 'starting' || facts.gatewayStatus.state === 'reconnecting') {
        return toHealth('degraded', `Gateway ${facts.gatewayStatus.state}`);
      }
      return toHealth('critical', facts.gatewayStatus.error || `Gateway ${facts.gatewayStatus.state}`);
    })();

    const localModel = (() => {
      if (facts.defaultProviderType !== 'ollama') {
        return toHealth('degraded', 'Local model provider is not the active default');
      }
      if (!facts.localModelStatus.runtimeInstalled) {
        return toHealth('critical', 'Ollama runtime is missing');
      }
      if (!facts.localModelStatus.serviceRunning) {
        return toHealth('critical', 'Ollama service is stopped');
      }
      return toHealth('healthy', 'Local model runtime and service are ready');
    })();

    const teams = (() => {
      const errored = facts.runtimeOverview.filter((runtime) =>
        runtime.status === 'error' || runtime.roles.some((role) => role.status === 'error')
      );
      if (errored.length > 0) {
        return toHealth('critical', `${errored.length} team(s) contain runtime errors`);
      }

      const runningCount = facts.runtimeOverview.filter((item) => item.status === 'running').length;
      if (runningCount === 0) {
        return toHealth('degraded', 'No running teams');
      }
      return toHealth('healthy', `${runningCount} team(s) running normally`);
    })();

    const openclaw = (() => {
      if (facts.doctorCheckOk === false) {
        return toHealth('critical', 'Doctor check failed');
      }
      if (facts.doctorCheckOk === true) {
        return toHealth('healthy', 'Doctor check passed');
      }
      return toHealth('degraded', 'Doctor check not refreshed in this cycle');
    })();

    const copilot = facts.copilotModel
      ? toHealth('healthy', `Copilot model ready: ${facts.copilotModel}`)
      : toHealth('degraded', 'Copilot model is unavailable, running in rule mode');

    const scheduler = toHealth('healthy', 'Self-healing scheduler active');

    const subsystems: OpsHealthSnapshot['subsystems'] = {
      gateway,
      openclaw,
      localModel,
      teams,
      scheduler,
      copilot,
    };

    const partList = Object.values(subsystems);
    return {
      overall: computeOverallStatus(partList),
      score: computeScore(partList),
      subsystems,
      updatedAt: nowIso(),
      lastCheckAt: nowIso(),
      activeIncidents,
      autoRemediationEnabled: this.policy.autoRemediationEnabled,
      paused: this.paused,
      copilotAvailable: Boolean(facts.copilotModel),
    };
  }

  private resolveCopilotModel(localModelStatus: LocalModelRuntimeStatus): string | null {
    if (!localModelStatus.serviceRunning) return null;
    const preferred = localModelStatus.presets.find((preset) => preset.id === 'speed')?.model;
    if (preferred && localModelStatus.installedModels.includes(preferred)) {
      return preferred;
    }
    return localModelStatus.installedModels[0] || null;
  }

  private async generateCopilotSummary(symptom: DetectedSymptom, facts: HealthFacts): Promise<string | null> {
    if (!facts.copilotModel) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), COPILOT_REQUEST_TIMEOUT_MS);
    timer.unref();

    try {
      const response = await fetch('http://127.0.0.1:11434/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ollama-local',
        },
        body: JSON.stringify({
          model: facts.copilotModel,
          temperature: 0.2,
          max_tokens: 120,
          messages: [
            {
              role: 'system',
              content: 'You are a concise SRE copilot for Monoclaw/OpenClaw. Return one short diagnosis and one safe action recommendation.',
            },
            {
              role: 'user',
              content: JSON.stringify({
                symptom: symptom.code,
                summary: symptom.summary,
                rootCause: symptom.rootCause,
                gatewayState: facts.gatewayStatus.state,
                gatewayHealthOk: facts.gatewayHealth.ok,
                defaultProviderType: facts.defaultProviderType,
                defaultProviderModel: facts.defaultProviderModel,
                recommendedActions: symptom.recommendedActions,
              }),
            },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        return null;
      }

      const payload = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      const text = payload.choices?.[0]?.message?.content?.trim();
      return text || null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async runOpenClawDoctor(fix: boolean, timeoutMs: number): Promise<DoctorResult> {
    const status = getOpenClawStatus();
    const entryPath = getOpenClawEntryPath();
    if (!status.packageExists) {
      return {
        success: false,
        code: -1,
        output: `OpenClaw package missing at ${status.dir}`,
      };
    }

    return new Promise<DoctorResult>((resolve) => {
      const args = [entryPath, 'doctor', ...(fix ? ['--fix'] : [])];
      const child = spawn(process.execPath, args, {
        cwd: status.dir,
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          OPENCLAW_NO_RESPAWN: '1',
          OPENCLAW_EMBEDDED_IN: 'Monoclaw',
        },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 1000).unref();
      }, timeoutMs);
      timer.unref();

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.once('error', (error) => {
        clearTimeout(timer);
        resolve({
          success: false,
          code: -1,
          output: String(error),
        });
      });

      child.once('close', (code) => {
        clearTimeout(timer);
        const combined = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
        if (timedOut && code === null) {
          resolve({
            success: false,
            code: 124,
            output: combined || 'Doctor timed out',
          });
          return;
        }

        resolve({
          success: code === 0,
          code,
          output: combined || 'No output',
        });
      });
    });
  }

  private async emitUpdated(): Promise<void> {
    const payload = await this.getOverview(30);
    this.emit('updated', payload);
  }
}
