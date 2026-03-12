import { app } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  OpsActionRecord,
  OpsEvent,
  OpsHealthSnapshot,
  OpsPersistedState,
  OpsPolicy,
} from './types';

const MAX_EVENTS = 300;
const MAX_ACTIONS = 500;

export const DEFAULT_OPS_POLICY: OpsPolicy = {
  autoRemediationEnabled: true,
  allowedAutoActions: [
    'gateway.start',
    'gateway.restart',
    'openclaw.doctor.fix',
    'localModel.service.start',
    'teams.restartErrored',
  ],
  maxRetryPerAction: 2,
  cooldownMs: 120000,
  escalationThreshold: 3,
};

function defaultState(): OpsPersistedState {
  return {
    version: 1,
    policy: { ...DEFAULT_OPS_POLICY },
    paused: false,
    events: [],
    actions: [],
    lastSnapshot: undefined,
    lastDoctorAt: undefined,
    lastDoctorOk: undefined,
  };
}

export class OpsStateStore {
  private readonly filePath: string;

  private loaded = false;
  private state: OpsPersistedState = defaultState();

  constructor() {
    this.filePath = join(app.getPath('userData'), 'ops', 'ops-state.json');
  }

  async load(): Promise<OpsPersistedState> {
    if (this.loaded) {
      return this.getState();
    }

    try {
      const raw = await readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<OpsPersistedState>;
      this.state = {
        ...defaultState(),
        ...parsed,
        policy: {
          ...DEFAULT_OPS_POLICY,
          ...(parsed.policy || {}),
        },
        events: Array.isArray(parsed.events) ? parsed.events.slice(-MAX_EVENTS) : [],
        actions: Array.isArray(parsed.actions) ? parsed.actions.slice(-MAX_ACTIONS) : [],
      };
    } catch {
      this.state = defaultState();
      await this.flush();
    }

    this.loaded = true;
    return this.getState();
  }

  getState(): OpsPersistedState {
    return JSON.parse(JSON.stringify(this.state)) as OpsPersistedState;
  }

  async setPolicy(policy: Partial<OpsPolicy>): Promise<OpsPolicy> {
    await this.load();
    this.state.policy = {
      ...this.state.policy,
      ...policy,
    };
    await this.flush();
    return { ...this.state.policy };
  }

  async setPaused(paused: boolean): Promise<void> {
    await this.load();
    this.state.paused = paused;
    await this.flush();
  }

  async appendEvent(event: OpsEvent): Promise<void> {
    await this.load();
    this.state.events.push(event);
    if (this.state.events.length > MAX_EVENTS) {
      this.state.events.splice(0, this.state.events.length - MAX_EVENTS);
    }
    await this.flush();
  }

  async appendAction(action: OpsActionRecord): Promise<void> {
    await this.load();
    this.state.actions.push(action);
    if (this.state.actions.length > MAX_ACTIONS) {
      this.state.actions.splice(0, this.state.actions.length - MAX_ACTIONS);
    }
    await this.flush();
  }

  async updateAction(actionId: string, patch: Partial<OpsActionRecord>): Promise<OpsActionRecord | null> {
    await this.load();
    const target = this.state.actions.find((item) => item.id === actionId);
    if (!target) return null;

    Object.assign(target, patch);
    await this.flush();
    return { ...target };
  }

  async setSnapshot(snapshot: OpsHealthSnapshot): Promise<void> {
    await this.load();
    this.state.lastSnapshot = snapshot;
    await this.flush();
  }

  async setLastDoctorResult(ok: boolean): Promise<void> {
    await this.load();
    this.state.lastDoctorAt = new Date().toISOString();
    this.state.lastDoctorOk = ok;
    await this.flush();
  }

  private async flush(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.state, null, 2), 'utf-8');
  }
}
