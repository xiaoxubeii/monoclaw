import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayStatus } from '@electron/gateway/manager';
import type { TeamRuntimeSnapshot } from '@electron/team/types';
import type { LocalModelRuntimeStatus } from '@electron/utils/local-model-manager';
import { OpsOrchestrator } from '@electron/ops/orchestrator';

const hoisted = vi.hoisted(() => {
  const defaultPolicy = {
    autoRemediationEnabled: true,
    allowedAutoActions: [
      'gateway.start',
      'gateway.restart',
      'openclaw.doctor.fix',
      'localModel.service.start',
      'teams.restartErrored',
    ],
    maxRetryPerAction: 2,
    cooldownMs: 0,
    escalationThreshold: 3,
  } as const;

  const makeState = () => ({
    version: 1 as const,
    policy: { ...defaultPolicy },
    paused: false,
    events: [] as any[],
    actions: [] as any[],
    lastSnapshot: undefined as any,
    lastDoctorAt: undefined as string | undefined,
    lastDoctorOk: undefined as boolean | undefined,
  });

  return {
    defaultPolicy,
    makeState,
    storeRef: { current: makeState() },
    getDefaultProviderMock: vi.fn(async () => null as string | null),
    getProviderMock: vi.fn(async () => null as { type?: string; model?: string } | null),
  };
});

vi.mock('@electron/ops/store', () => {
  class OpsStateStore {
    async load() {
      return JSON.parse(JSON.stringify(hoisted.storeRef.current));
    }

    async setPolicy(policy: Record<string, unknown>) {
      hoisted.storeRef.current.policy = {
        ...hoisted.storeRef.current.policy,
        ...policy,
      };
      return { ...hoisted.storeRef.current.policy };
    }

    async setPaused(paused: boolean) {
      hoisted.storeRef.current.paused = paused;
    }

    async appendEvent(event: Record<string, unknown>) {
      hoisted.storeRef.current.events.push(event);
    }

    async appendAction(action: Record<string, unknown>) {
      hoisted.storeRef.current.actions.push(action);
    }

    async updateAction(actionId: string, patch: Record<string, unknown>) {
      const target = hoisted.storeRef.current.actions.find((item: { id: string }) => item.id === actionId);
      if (!target) return null;
      Object.assign(target, patch);
      return { ...target };
    }

    async setSnapshot(snapshot: Record<string, unknown>) {
      hoisted.storeRef.current.lastSnapshot = snapshot;
    }

    async setLastDoctorResult(ok: boolean) {
      hoisted.storeRef.current.lastDoctorAt = new Date().toISOString();
      hoisted.storeRef.current.lastDoctorOk = ok;
    }
  }

  return {
    DEFAULT_OPS_POLICY: { ...hoisted.defaultPolicy },
    OpsStateStore,
  };
});

vi.mock('@electron/utils/secure-storage', () => ({
  getDefaultProvider: hoisted.getDefaultProviderMock,
  getProvider: hoisted.getProviderMock,
}));

function buildRuntime(partial?: Partial<TeamRuntimeSnapshot>): TeamRuntimeSnapshot {
  return {
    teamId: partial?.teamId || 'team-1',
    status: partial?.status || 'running',
    roles: partial?.roles || [
      {
        teamId: partial?.teamId || 'team-1',
        roleId: 'manager',
        roleName: 'Manager',
        status: 'idle',
      },
    ],
    queuedTasks: partial?.queuedTasks || 0,
    runningTasks: partial?.runningTasks || 0,
    gatewayConnected: partial?.gatewayConnected ?? true,
    lastUpdatedAt: partial?.lastUpdatedAt || new Date().toISOString(),
    lastError: partial?.lastError,
  };
}

class FakeGatewayManager extends EventEmitter {
  status: GatewayStatus;
  healthOk: boolean;
  startCalls = 0;
  restartCalls = 0;

  constructor(status: GatewayStatus, healthOk: boolean) {
    super();
    this.status = { ...status };
    this.healthOk = healthOk;
  }

  getStatus() {
    return { ...this.status };
  }

  async checkHealth() {
    if (!this.healthOk) {
      return { ok: false, error: 'health check failed' };
    }
    return { ok: true, uptime: 100 };
  }

  async start() {
    this.startCalls += 1;
    this.status.state = 'running';
    this.status.connectedAt = Date.now();
    this.healthOk = true;
    this.emit('status', this.getStatus());
  }

  async restart() {
    this.restartCalls += 1;
    this.status.state = 'running';
    this.status.connectedAt = Date.now();
    this.healthOk = true;
    this.emit('status', this.getStatus());
  }
}

class FakeTeamOrchestrator extends EventEmitter {
  runtimeOverview: TeamRuntimeSnapshot[];
  startTeamCalls: string[] = [];

  constructor(runtimeOverview: TeamRuntimeSnapshot[]) {
    super();
    this.runtimeOverview = runtimeOverview;
  }

  async ensureInitialized() {
    return;
  }

  getRuntimeOverview() {
    return this.runtimeOverview.map((item) => JSON.parse(JSON.stringify(item)) as TeamRuntimeSnapshot);
  }

  async startTeam(teamId: string) {
    this.startTeamCalls.push(teamId);
    this.runtimeOverview = this.runtimeOverview.map((runtime) => {
      if (runtime.teamId !== teamId) return runtime;
      return {
        ...runtime,
        status: 'running',
        roles: runtime.roles.map((role) => ({ ...role, status: 'idle', lastError: undefined })),
      };
    });
    this.emit('runtime-changed', this.runtimeOverview[0]);
  }
}

class FakeLocalModelManager extends EventEmitter {
  status: LocalModelRuntimeStatus;
  ensureServiceRunningCalls = 0;
  failEnsureService = false;

  constructor(status: LocalModelRuntimeStatus) {
    super();
    this.status = JSON.parse(JSON.stringify(status)) as LocalModelRuntimeStatus;
  }

  async getStatus() {
    return JSON.parse(JSON.stringify(this.status)) as LocalModelRuntimeStatus;
  }

  async ensureServiceRunning() {
    this.ensureServiceRunningCalls += 1;
    if (this.failEnsureService) {
      throw new Error('unable to start local model service');
    }
    this.status.serviceRunning = true;
  }
}

function createLocalModelStatus(partial?: Partial<LocalModelRuntimeStatus>): LocalModelRuntimeStatus {
  return {
    runtimeInstalled: partial?.runtimeInstalled ?? true,
    runtimeVersion: partial?.runtimeVersion ?? '0.6.0',
    serviceRunning: partial?.serviceRunning ?? true,
    installedModels: partial?.installedModels ?? ['qwen2.5:0.5b'],
    ollamaBinaryPath: partial?.ollamaBinaryPath ?? '/usr/bin/ollama',
    presets: partial?.presets ?? [
      { id: 'speed', model: 'qwen2.5:0.5b', minRamGb: 4, recommendedRamGb: 8 },
      { id: 'balanced', model: 'qwen2.5:3b', minRamGb: 8, recommendedRamGb: 16 },
    ],
  };
}

describe('ops orchestrator self-healing', () => {
  beforeEach(() => {
    hoisted.storeRef.current = hoisted.makeState();
    hoisted.getDefaultProviderMock.mockReset();
    hoisted.getProviderMock.mockReset();
    hoisted.getDefaultProviderMock.mockResolvedValue(null);
    hoisted.getProviderMock.mockResolvedValue(null);
    vi.unstubAllGlobals();
  });

  it('uses copilot model summary and auto-starts gateway when gateway is down', async () => {
    const gateway = new FakeGatewayManager({ state: 'stopped', port: 18789 }, false);
    const teams = new FakeTeamOrchestrator([buildRuntime({ teamId: 'team-1', status: 'running' })]);
    const localModel = new FakeLocalModelManager(createLocalModelStatus({ serviceRunning: true }));

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Diagnosis: gateway is down. Action: start gateway safely.' } }],
      }),
    }));

    const ops = new OpsOrchestrator(gateway as any, teams as any, localModel as any);
    vi.spyOn(ops as any, 'runOpenClawDoctor').mockResolvedValue({ success: true, code: 0, output: 'doctor ok' });

    await ops.start();
    const overview = await ops.getOverview();

    const gatewayEvent = overview.events.find((event) => event.symptomCode === 'gateway_not_running');
    const startAction = overview.actions.find((action) => action.actionType === 'gateway.start');

    expect(gateway.startCalls).toBe(1);
    expect(startAction?.status).toBe('success');
    expect(gatewayEvent?.copilotSummary).toContain('gateway is down');
    expect((globalThis.fetch as any).mock.calls.length).toBeGreaterThan(0);
  });

  it('restarts errored team runtimes automatically', async () => {
    const gateway = new FakeGatewayManager({ state: 'running', port: 18789, connectedAt: Date.now() }, true);
    const teams = new FakeTeamOrchestrator([
      buildRuntime({
        teamId: 'team-error',
        status: 'error',
        roles: [
          {
            teamId: 'team-error',
            roleId: 'analyst',
            roleName: 'Analyst',
            status: 'error',
            lastError: 'worker crashed',
          },
        ],
      }),
    ]);
    const localModel = new FakeLocalModelManager(createLocalModelStatus({ serviceRunning: false }));

    const ops = new OpsOrchestrator(gateway as any, teams as any, localModel as any);
    vi.spyOn(ops as any, 'runOpenClawDoctor').mockResolvedValue({ success: true, code: 0, output: 'doctor ok' });

    await ops.start();
    const overview = await ops.getOverview();

    const action = overview.actions.find((item) => item.actionType === 'teams.restartErrored');
    expect(teams.startTeamCalls).toEqual(['team-error']);
    expect(action?.status).toBe('success');
    expect(teams.getRuntimeOverview()[0].roles[0].status).toBe('idle');
  });

  it('allows local-model remediation again after issue is recovered then recurs', async () => {
    hoisted.getDefaultProviderMock.mockResolvedValue('provider-ollama');
    hoisted.getProviderMock.mockResolvedValue({ type: 'ollama', model: 'qwen2.5:0.5b' });

    const gateway = new FakeGatewayManager({ state: 'running', port: 18789, connectedAt: Date.now() }, true);
    const teams = new FakeTeamOrchestrator([buildRuntime({ teamId: 'team-1', status: 'running' })]);
    const localModel = new FakeLocalModelManager(createLocalModelStatus({ serviceRunning: false }));
    localModel.failEnsureService = true;

    const ops = new OpsOrchestrator(gateway as any, teams as any, localModel as any);
    vi.spyOn(ops as any, 'runOpenClawDoctor').mockResolvedValue({ success: true, code: 0, output: 'doctor ok' });

    await ops.start();

    // First attempt failed on startup. Force symptom clock forward for another remediation attempt.
    (ops as any).symptomLastSeenAt.set('local_model_service_down', 0);
    await ops.runCheckNow('event'); // second failure attempt

    // Recover externally: issue disappears.
    localModel.status.serviceRunning = true;
    await ops.runCheckNow('event');

    // Recurs later; force symptom clock forward again.
    localModel.status.serviceRunning = false;
    localModel.failEnsureService = false;
    (ops as any).symptomLastSeenAt.set('local_model_service_down', 0);
    await ops.runCheckNow('event');

    const overview = await ops.getOverview(100);
    const localActions = overview.actions.filter((action) => action.actionType === 'localModel.service.start');

    const latestAction = localActions[0];
    expect(localActions.length).toBeGreaterThanOrEqual(3);
    expect(latestAction?.status).toBe('success');
  });
});
