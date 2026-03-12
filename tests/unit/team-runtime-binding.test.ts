import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { TeamRoleDefinition } from '@electron/team/types';
import { TeamOrchestrator } from '@electron/team/orchestrator';

const hoisted = vi.hoisted(() => ({
  tempRoot: '',
  teams: [] as any[],
  startInputs: [] as any[],
  defaultProviderId: 'custom-runtime',
  providerRecord: {
    id: 'custom-runtime',
    type: 'custom',
    name: 'DashScope Runtime',
    baseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
    model: 'qwen3.5-plus',
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  apiKey: 'sk-test-runtime',
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
    async startRole(input: any) {
      hoisted.startInputs.push(JSON.parse(JSON.stringify(input)));
      const snapshot = {
        teamId: input.teamId,
        roleId: input.role.id,
        roleName: input.role.name,
        status: 'idle' as const,
      };
      this.emit('runtime-status', snapshot);
      return snapshot;
    }

    async stopTeam() {
      return;
    }

    async stopAll() {
      return;
    }

    getTeamSnapshots(teamId: string) {
      return hoisted.startInputs
        .filter((input) => input.teamId === teamId)
        .map((input) => ({
          teamId: input.teamId,
          roleId: input.role.id,
          roleName: input.role.name,
          status: 'idle' as const,
        }));
    }
  }

  return { TeamProcessSupervisor };
});

vi.mock('@electron/utils/secure-storage', () => ({
  getDefaultProvider: vi.fn(async () => hoisted.defaultProviderId || undefined),
  getProvider: vi.fn(async (providerId: string) => (
    providerId === hoisted.providerRecord.id
      ? { ...hoisted.providerRecord }
      : null
  )),
  getApiKey: vi.fn(async (providerId: string) => (
    providerId === hoisted.providerRecord.id
      ? hoisted.apiKey
      : null
  )),
}));

vi.mock('@electron/utils/provider-registry', () => ({
  getProviderConfig: vi.fn(() => undefined),
}));

function buildRole(agent?: Partial<TeamRoleDefinition['agent']>): TeamRoleDefinition {
  return {
    id: 'trip-coordinator',
    name: 'Trip Coordinator',
    personality: 'Goal-first',
    responsibilities: ['Coordinate the mission'],
    boundaries: ['Do not submit payment'],
    keywords: ['trip', 'booking'],
    skills: ['flight.goal.parse'],
    enabled: true,
    agent: {
      provider: 'openclaw',
      model: 'auto',
      systemPrompt: 'Coordinate flight booking outcomes.',
      temperature: 0.3,
      maxTokens: 1536,
      ...agent,
    },
  };
}

describe('team runtime provider binding', () => {
  let tempRoot = '';

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'monoclaw-team-binding-'));
    hoisted.tempRoot = tempRoot;
    hoisted.teams = [];
    hoisted.startInputs = [];
    hoisted.defaultProviderId = 'custom-runtime';
    hoisted.providerRecord = {
      id: 'custom-runtime',
      type: 'custom',
      name: 'DashScope Runtime',
      baseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
      model: 'qwen3.5-plus',
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    hoisted.apiKey = 'sk-test-runtime';
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('resolves the default OpenClaw provider binding for role runtimes', async () => {
    const orchestrator = new TeamOrchestrator();
    const team = await orchestrator.createTeam({
      name: 'Flight Team',
      domain: 'travel',
      description: 'Provider binding validation',
      roles: [buildRole()],
    });

    await orchestrator.startTeam(team.id);

    expect(hoisted.startInputs).toHaveLength(1);
    expect(hoisted.startInputs[0].agentBinding).toMatchObject({
      providerId: 'custom-runtime',
      providerType: 'custom',
      providerLabel: 'openclaw',
      model: 'qwen3.5-plus',
      baseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
      apiKey: 'sk-test-runtime',
      temperature: 0.3,
      maxTokens: 1536,
    });
  });

  it('prefers the role-level model override over the provider default model', async () => {
    const orchestrator = new TeamOrchestrator();
    const team = await orchestrator.createTeam({
      name: 'Flight Team Override',
      domain: 'travel',
      description: 'Provider binding override validation',
      roles: [buildRole({ model: 'qwen3.5-plus-thinking' })],
    });

    await orchestrator.startTeam(team.id);

    expect(hoisted.startInputs[0].agentBinding?.model).toBe('qwen3.5-plus-thinking');
  });

  it('falls back to mock runtime when no provider binding can be resolved', async () => {
    hoisted.defaultProviderId = '';

    const orchestrator = new TeamOrchestrator();
    const team = await orchestrator.createTeam({
      name: 'Flight Team Mock',
      domain: 'travel',
      description: 'Mock fallback validation',
      roles: [buildRole()],
    });

    await orchestrator.startTeam(team.id);

    expect(hoisted.startInputs[0].agentBinding).toBeNull();
  });
});
