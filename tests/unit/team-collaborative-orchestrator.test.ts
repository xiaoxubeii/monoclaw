import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { TeamRoleDefinition, TeamTask } from '@electron/team/types';
import { TeamOrchestrator } from '@electron/team/orchestrator';

const hoisted = vi.hoisted(() => ({
  tempRoot: '',
  teams: [] as any[],
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
      const { rm } = await import('node:fs/promises');
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
      const { mkdir } = await import('node:fs/promises');
      const teamDir = this.getTeamDir(team.id);
      await mkdir(`${teamDir}/roles`, { recursive: true });
      for (const role of team.roles as Array<{ id: string }>) {
        await mkdir(`${teamDir}/roles/${role.id}`, { recursive: true });
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
    private readonly runtimeMap = new Map<string, {
      teamId: string;
      roleId: string;
      roleName: string;
      status: 'stopped' | 'starting' | 'idle' | 'busy' | 'error';
      lastError?: string;
    }>();

    async startRole(input: { teamId: string; role: { id: string; name: string } }) {
      const key = `${input.teamId}:${input.role.id}`;
      const runtime = {
        teamId: input.teamId,
        roleId: input.role.id,
        roleName: input.role.name,
        status: 'idle' as const,
      };
      this.runtimeMap.set(key, runtime);
      this.emit('runtime-status', { ...runtime });
      return { ...runtime };
    }

    async dispatchTask(teamId: string, roleId: string, taskId: string, input: string) {
      const key = `${teamId}:${roleId}`;
      const runtime = this.runtimeMap.get(key);
      if (!runtime) {
        throw new Error(`missing runtime: ${key}`);
      }

      runtime.status = 'busy';
      this.emit('runtime-status', { ...runtime });

      const shouldBlockForIntervention = (
        roleId === 'inventory-scout'
        && input.includes('INTERVENTION_REQUIRED')
        && !input.includes('User intervention')
      );

      setTimeout(() => {
        runtime.status = 'idle';
        this.emit('runtime-status', { ...runtime });
        this.emit('task-result', {
          teamId,
          roleId,
          taskId,
          output: shouldBlockForIntervention
            ? [
              `[${roleId}] processed: ${input.slice(0, 80)}`,
              'Status: blocked',
              'Missing information: traveler date is required',
            ].join('\n')
            : `[${roleId}] processed: ${input.slice(0, 80)}\nStatus: ready`,
        });
      }, 10);
    }

    async stopTeam(teamId: string) {
      for (const runtime of this.runtimeMap.values()) {
        if (runtime.teamId !== teamId) continue;
        runtime.status = 'stopped';
        this.emit('runtime-status', { ...runtime });
      }
    }

    async stopAll() {
      for (const runtime of this.runtimeMap.values()) {
        runtime.status = 'stopped';
        this.emit('runtime-status', { ...runtime });
      }
    }

    getTeamSnapshots(teamId: string) {
      return [...this.runtimeMap.values()]
        .filter((runtime) => runtime.teamId === teamId)
        .map((runtime) => ({ ...runtime }));
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

function buildRoles(): TeamRoleDefinition[] {
  return [
    {
      id: 'trip-coordinator',
      name: 'Trip Coordinator',
      personality: 'Goal-first',
      responsibilities: ['Coordinate'],
      boundaries: ['No payment'],
      keywords: ['trip'],
      enabled: true,
    },
    {
      id: 'inventory-scout',
      name: 'Inventory Scout',
      personality: 'Fast',
      responsibilities: ['Collect options'],
      boundaries: ['No assumption'],
      keywords: ['flight'],
      enabled: true,
    },
    {
      id: 'price-analyst',
      name: 'Price Analyst',
      personality: 'Numeric',
      responsibilities: ['Compare cost'],
      boundaries: ['No guess'],
      keywords: ['price'],
      enabled: true,
    },
  ];
}

async function waitForTerminalTask(orchestrator: TeamOrchestrator, taskId: string, timeoutMs = 4000): Promise<TeamTask> {
  const existing = orchestrator
    .getRuntimeOverview()
    .flatMap((runtime) => orchestrator.getTasks(runtime.teamId, 200))
    .find((task) => task.id === taskId);

  if (existing && (existing.status === 'completed' || existing.status === 'failed')) {
    return existing;
  }

  return new Promise<TeamTask>((resolve, reject) => {
    const onChanged = (task: TeamTask) => {
      if (task.id !== taskId) return;
      if (task.status !== 'completed' && task.status !== 'failed') return;
      clearTimeout(timeout);
      orchestrator.off('task-changed', onChanged);
      resolve(task);
    };

    const timeout = setTimeout(() => {
      orchestrator.off('task-changed', onChanged);
      reject(new Error(`timeout waiting for task ${taskId}`));
    }, timeoutMs);

    orchestrator.on('task-changed', onChanged);
  });
}

async function waitForTaskIntervention(
  orchestrator: TeamOrchestrator,
  taskId: string,
  timeoutMs = 4000,
): Promise<TeamTask> {
  const existing = orchestrator
    .getRuntimeOverview()
    .flatMap((runtime) => orchestrator.getTasks(runtime.teamId, 200))
    .find((task) => task.id === taskId);

  if (existing?.collaboration?.awaitingIntervention) {
    return existing;
  }

  return new Promise<TeamTask>((resolve, reject) => {
    const onChanged = (task: TeamTask) => {
      if (task.id !== taskId) return;
      if (!task.collaboration?.awaitingIntervention) return;
      clearTimeout(timeout);
      orchestrator.off('task-changed', onChanged);
      resolve(task);
    };

    const timeout = setTimeout(() => {
      orchestrator.off('task-changed', onChanged);
      reject(new Error(`timeout waiting for intervention on task ${taskId}`));
    }, timeoutMs);

    orchestrator.on('task-changed', onChanged);
  });
}

describe('team orchestrator collaborative dispatch', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'monoclaw-team-collab-'));
    hoisted.tempRoot = tempRoot;
    hoisted.teams = [];
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('runs multi-role collaborative goal and writes workspace artifacts', async () => {
    const orchestrator = new TeamOrchestrator();
    const team = await orchestrator.createTeam({
      name: 'Flight Team',
      domain: 'travel',
      description: 'Flight booking research',
      roles: buildRoles(),
    });

    await orchestrator.startTeam(team.id);

    const rootTask = await orchestrator.dispatchTask(team.id, {
      input: 'Find Shenzhen -> Tokyo flights under 2500 CNY and prepare booking recommendation.',
      collaborative: true,
      requestedRoleId: 'trip-coordinator',
    });

    expect(rootTask.routeMode).toBe('collaborative');
    expect(rootTask.collaboration?.isRoot).toBe(true);
    expect(rootTask.collaboration?.protocol).toBe('native');

    const finishedRoot = await waitForTerminalTask(orchestrator, rootTask.id, 8000);
    expect(finishedRoot.status).toBe('completed');
    expect(finishedRoot.result).toContain('Collaborative goal completed successfully');

    const allTasks = orchestrator.getTasks(team.id, 200);
    const children = allTasks.filter((task) => task.collaboration?.parentTaskId === rootTask.id);

    expect(children).toHaveLength(4);
    expect(children.every((task) => task.status === 'completed')).toBe(true);
    expect(children.map((task) => task.collaboration?.step)).toEqual([1, 2, 3, 4]);

    const workspacePath = finishedRoot.collaboration?.workspacePath;
    expect(workspacePath).toBeTruthy();

    const goalContent = await readFile(join(workspacePath!, 'GOAL.md'), 'utf-8');
    const resultContent = await readFile(join(workspacePath!, 'RESULT.md'), 'utf-8');
    const stepFiles = await readdir(join(workspacePath!, 'steps'));

    expect(goalContent).toContain('Goal Input');
    expect(resultContent).toContain('Final Synthesis');
    expect(stepFiles.length).toBe(4);
  });

  it('supports adapter protocol variants with protocol-specific interaction plan', async () => {
    const orchestrator = new TeamOrchestrator();
    const team = await orchestrator.createTeam({
      name: 'Flight Team - CrewAI',
      domain: 'travel',
      description: 'Flight booking crewai protocol',
      roles: buildRoles(),
    });

    await orchestrator.startTeam(team.id);

    const rootTask = await orchestrator.dispatchTask(team.id, {
      input: 'Search flights and prepare final booking packet.',
      collaborative: true,
      collaborationProtocol: 'crewai',
      requestedRoleId: 'trip-coordinator',
    });

    const finishedRoot = await waitForTerminalTask(orchestrator, rootTask.id, 8000);
    expect(finishedRoot.status).toBe('completed');
    expect(finishedRoot.collaboration?.protocol).toBe('crewai');

    const allTasks = orchestrator.getTasks(team.id, 300);
    const children = allTasks.filter((task) => task.collaboration?.parentTaskId === rootTask.id);

    expect(children).toHaveLength(6);
    expect(children.filter((task) => task.collaboration?.intent === 'review')).toHaveLength(2);
    expect(children.every((task) => task.collaboration?.protocol === 'crewai')).toBe(true);

    const workspacePath = finishedRoot.collaboration?.workspacePath;
    expect(workspacePath).toBeTruthy();

    const goalContent = await readFile(join(workspacePath!, 'GOAL.md'), 'utf-8');
    expect(goalContent).toContain('Protocol: crewai');
  });

  it('uses the team default protocol unless a task explicitly overrides it', async () => {
    const orchestrator = new TeamOrchestrator();
    const team = await orchestrator.createTeam({
      name: 'Flight Team - Default Protocol',
      domain: 'travel',
      description: 'Flight booking default protocol',
      defaultCollaborationProtocol: 'langgraph',
      roles: buildRoles(),
    });

    await orchestrator.startTeam(team.id);

    const defaultTask = await orchestrator.dispatchTask(team.id, {
      input: 'Search flights and prepare the default collaborative run.',
      collaborative: true,
      requestedRoleId: 'trip-coordinator',
    });
    const finishedDefaultTask = await waitForTerminalTask(orchestrator, defaultTask.id, 8000);
    expect(finishedDefaultTask.collaboration?.protocol).toBe('langgraph');

    const overrideTask = await orchestrator.dispatchTask(team.id, {
      input: 'Search flights and prepare a one-off override run.',
      collaborative: true,
      collaborationProtocol: 'crewai',
      requestedRoleId: 'trip-coordinator',
    });
    const finishedOverrideTask = await waitForTerminalTask(orchestrator, overrideTask.id, 8000);
    expect(finishedOverrideTask.collaboration?.protocol).toBe('crewai');
  });

  it('accepts user intervention and resumes blocked native-v2 collaborative goal', async () => {
    const orchestrator = new TeamOrchestrator();
    const team = await orchestrator.createTeam({
      name: 'Flight Team - Intervention',
      domain: 'travel',
      description: 'Native-v2 intervention test',
      roles: buildRoles(),
    });

    await orchestrator.startTeam(team.id);

    const rootTask = await orchestrator.dispatchTask(team.id, {
      input: 'INTERVENTION_REQUIRED: Prepare travel recommendation and wait for missing traveler date.',
      collaborative: true,
      requestedRoleId: 'trip-coordinator',
    });

    const blockedTask = await waitForTaskIntervention(orchestrator, rootTask.id, 8000);
    expect(blockedTask.status).toBe('running');
    expect(blockedTask.collaboration?.interventionRequired).toBe(true);
    expect(blockedTask.collaboration?.awaitingIntervention).toBe(true);

    await orchestrator.interveneTask(team.id, {
      rootTaskId: rootTask.id,
      note: 'Traveler date is 2026-03-20.',
    });

    const finishedRoot = await waitForTerminalTask(orchestrator, rootTask.id, 8000);
    expect(finishedRoot.status).toBe('completed');
    expect(finishedRoot.collaboration?.interventionCount).toBe(1);
    expect(finishedRoot.result).toContain('Collaborative goal completed successfully');
  });
});
