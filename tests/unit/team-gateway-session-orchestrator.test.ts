import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { TeamTask } from '@electron/team/types';
import { TeamOrchestrator } from '@electron/team/orchestrator';

const hoisted = vi.hoisted(() => ({
  tempRoot: '',
  teams: [] as any[],
  supervisorStartRoleCalls: 0,
  supervisorDispatchCalls: 0,
}));

vi.mock('@electron/team/store', () => {
  class TeamPersistenceStore {
    async listTeams() {
      return hoisted.teams.map((team) => JSON.parse(JSON.stringify(team)));
    }

    async saveTeams(teams: any[]) {
      hoisted.teams = teams.map((team) => JSON.parse(JSON.stringify(team)));
    }

    async saveTeam(team: any) {
      const idx = hoisted.teams.findIndex((item) => item.id === team.id);
      if (idx >= 0) {
        hoisted.teams[idx] = JSON.parse(JSON.stringify(team));
      } else {
        hoisted.teams.push(JSON.parse(JSON.stringify(team)));
      }
    }

    async removeTeam(teamId: string) {
      hoisted.teams = hoisted.teams.filter((item) => item.id !== teamId);
      await rm(this.getTeamDir(teamId), { recursive: true, force: true });
    }

    getRootDir() {
      return hoisted.tempRoot;
    }

    getTeamDir(teamId: string) {
      return `${hoisted.tempRoot}/teams/${teamId}`;
    }

    getRoleSoulPath(teamId: string, roleId: string) {
      return `${this.getTeamDir(teamId)}/roles/${roleId}/SOUL.md`;
    }

    async ensureTeamFilesystem(team: any) {
      const teamDir = this.getTeamDir(team.id);
      await mkdir(join(teamDir, 'roles'), { recursive: true });
      for (const role of team.roles as Array<{ id: string; name: string }>) {
        const roleDir = join(teamDir, 'roles', role.id);
        await mkdir(roleDir, { recursive: true });
        await writeFile(join(roleDir, 'SOUL.md'), `# ${role.name}`, 'utf8');
      }
    }

    async cleanupStaleRoleDirectories() {
      return;
    }
  }

  return { TeamPersistenceStore };
});

vi.mock('@electron/team/process-supervisor', () => {
  const { EventEmitter } = require('node:events') as typeof import('node:events');

  class TeamProcessSupervisor extends EventEmitter {
    async startRole() {
      hoisted.supervisorStartRoleCalls += 1;
      return;
    }

    async dispatchTask() {
      hoisted.supervisorDispatchCalls += 1;
      return;
    }

    async stopTeam() {
      return;
    }

    async stopAll() {
      return;
    }

    getTeamSnapshots() {
      return [];
    }
  }

  return { TeamProcessSupervisor };
});

vi.mock('@electron/utils/secure-storage', () => ({
  getDefaultProvider: vi.fn(async () => undefined),
  getProvider: vi.fn(async () => null),
  getApiKey: vi.fn(async () => null),
}));

vi.mock('@electron/utils/provider-registry', () => ({
  getProviderConfig: vi.fn(() => undefined),
}));

async function waitForTerminalTask(
  orchestrator: TeamOrchestrator,
  teamId: string,
  taskId: string,
  timeoutMs = 6000,
): Promise<TeamTask> {
  const existing = orchestrator.getTasks(teamId, 200).find((task) => task.id === taskId);
  if (existing && (existing.status === 'completed' || existing.status === 'failed')) {
    return existing;
  }

  return new Promise<TeamTask>((resolve, reject) => {
    const onTaskChanged = (task: TeamTask) => {
      if (task.id !== taskId) return;
      if (task.status !== 'completed' && task.status !== 'failed') return;
      clearTimeout(timeout);
      orchestrator.off('task-changed', onTaskChanged);
      resolve(task);
    };

    const timeout = setTimeout(() => {
      orchestrator.off('task-changed', onTaskChanged);
      reject(new Error(`timeout waiting for task ${taskId}`));
    }, timeoutMs);
    timeout.unref();

    orchestrator.on('task-changed', onTaskChanged);
  });
}

describe('team orchestrator gateway session mode', () => {
  let tempRoot = '';

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'monoclaw-team-gateway-'));
    hoisted.tempRoot = tempRoot;
    hoisted.teams = [];
    hoisted.supervisorStartRoleCalls = 0;
    hoisted.supervisorDispatchCalls = 0;
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('dispatches tasks through OpenClaw chat sessions instead of process runtimes', async () => {
    const rpcCalls: Array<{ method: string; params: unknown }> = [];
    let historyCallCount = 0;

    const gatewayRpc = vi.fn(async (method: string, params?: unknown) => {
      rpcCalls.push({ method, params });

      if (method === 'chat.history') {
        historyCallCount += 1;
        if (historyCallCount === 1) {
          return [
            { id: 'assistant-old', role: 'assistant', content: 'Previous answer', timestamp: Date.now() - 10_000 },
          ];
        }

        return [
          { id: 'assistant-old', role: 'assistant', content: 'Previous answer', timestamp: Date.now() - 10_000 },
          {
            id: 'assistant-new',
            role: 'assistant',
            content: [{ type: 'text', text: 'Gateway session completed result' }],
            timestamp: Date.now(),
          },
        ];
      }

      if (method === 'chat.send') {
        return { runId: 'team-run-1' };
      }

      return null;
    });

    const orchestrator = new TeamOrchestrator({ gatewayRpc });
    const team = await orchestrator.createTeam({
      name: 'Gateway Team',
      domain: 'travel',
      description: 'Gateway mode team',
      roles: [
        {
          id: 'trip-coordinator',
          name: 'Trip Coordinator',
          personality: 'Structured',
          responsibilities: ['Coordinate booking plan'],
          boundaries: ['No direct payment'],
          keywords: ['trip', 'flight'],
          enabled: true,
        },
      ],
    });

    await orchestrator.startTeam(team.id);
    expect(hoisted.supervisorStartRoleCalls).toBe(0);

    const queuedTask = await orchestrator.dispatchTask(team.id, {
      input: 'Prepare a concise same-day flight recommendation.',
      requestedRoleId: 'trip-coordinator',
    });
    const finishedTask = await waitForTerminalTask(orchestrator, team.id, queuedTask.id);

    expect(finishedTask.status).toBe('completed');
    expect(finishedTask.result).toContain('Gateway session completed result');
    expect(hoisted.supervisorDispatchCalls).toBe(0);

    const sendCall = rpcCalls.find((call) => call.method === 'chat.send');
    expect(sendCall).toBeTruthy();
    expect(sendCall?.params).toMatchObject({
      sessionKey: `agent:main:team-${team.id}-trip-coordinator`,
      deliver: false,
    });
    expect(String((sendCall?.params as { message?: unknown })?.message || ''))
      .toContain('Prepare a concise same-day flight recommendation.');
  });
});
