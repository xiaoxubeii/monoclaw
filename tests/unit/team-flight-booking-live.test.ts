import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { TeamTask } from '@electron/team/types';

const LIVE_PROVIDER_STORE_PATH = process.env.TEAM_LIVE_PROVIDER_STORE
  || '/home/cheng/monoclaw_data/00_control/monoclaw_user_data/monoclaw-providers.json';
const runLive = process.env.TEAM_LIVE_PROVIDER === '1' ? describe : describe.skip;

vi.mock('electron', () => ({
  app: {
    setPath: vi.fn(),
    getPath: vi.fn(() => '/tmp/monoclaw-live-user-data'),
    isPackaged: false,
    getAppPath: vi.fn(() => '/tmp/monoclaw-live-app'),
    getVersion: vi.fn(() => '0.0.0-live'),
    getName: vi.fn(() => 'Monoclaw'),
  },
}));

vi.mock('@electron/utils/secure-storage', () => {
  async function readProviderStore() {
    const content = await readFile(
      process.env.TEAM_LIVE_PROVIDER_STORE || LIVE_PROVIDER_STORE_PATH,
      'utf-8',
    );
    return JSON.parse(content) as {
      providers?: Record<string, unknown>;
      apiKeys?: Record<string, string>;
      defaultProvider?: string | null;
    };
  }

  return {
    getDefaultProvider: vi.fn(async () => {
      const store = await readProviderStore();
      return store.defaultProvider || undefined;
    }),
    getProvider: vi.fn(async (providerId: string) => {
      const store = await readProviderStore();
      return store.providers?.[providerId] ?? null;
    }),
    getApiKey: vi.fn(async (providerId: string) => {
      const store = await readProviderStore();
      return store.apiKeys?.[providerId] ?? null;
    }),
  };
});

vi.mock('@electron/utils/provider-registry', () => ({
  getProviderConfig: vi.fn(() => undefined),
}));

async function waitForTerminalTask(
  orchestrator: {
    getTasks: (teamId: string, limit?: number) => TeamTask[];
    on: (event: 'task-changed', listener: (task: TeamTask) => void) => void;
    off: (event: 'task-changed', listener: (task: TeamTask) => void) => void;
    getRuntimeOverview: () => Array<{ teamId: string }>;
  },
  taskId: string,
  timeoutMs = 240000,
): Promise<TeamTask> {
  const existing = orchestrator
    .getRuntimeOverview()
    .flatMap((runtime) => orchestrator.getTasks(runtime.teamId, 300))
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
    timeout.unref();

    orchestrator.on('task-changed', onChanged);
  });
}

function getLiveProtocolTimeout(protocol: string): number {
  return protocol === 'native' ? 240000 : 420000;
}

runLive('flight search & booking crew live provider flow', () => {
  let tempRoot = '';

  beforeAll(async () => {
    await access(LIVE_PROVIDER_STORE_PATH, constants.R_OK);
  });

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'monoclaw-flight-live-'));
    process.env.MONOCLAW_DATA_ROOT = tempRoot;
    process.env.MONOCLAW_ROLE_RUNTIME_LATENCY_FLOOR_MS = '50';
    process.env.MONOCLAW_ROLE_RUNTIME_LATENCY_CAP_MS = '80';
    process.env.TEAM_LIVE_PROVIDER_STORE = LIVE_PROVIDER_STORE_PATH;
    vi.resetModules();
  });

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
    delete process.env.MONOCLAW_DATA_ROOT;
    delete process.env.MONOCLAW_ROLE_RUNTIME_LATENCY_FLOOR_MS;
    delete process.env.MONOCLAW_ROLE_RUNTIME_LATENCY_CAP_MS;
    delete process.env.TEAM_LIVE_PROVIDER_STORE;
    vi.clearAllMocks();
  });

  it.each([
    { protocol: 'native', expectedChildren: 6, expectedReviews: 0 },
    { protocol: 'langgraph', expectedChildren: 10, expectedReviews: 4 },
    { protocol: 'crewai', expectedChildren: 10, expectedReviews: 4 },
    { protocol: 'n8n', expectedChildren: 10, expectedReviews: 4 },
  ])(
    'executes the travel crew over real qwen3.5-plus with %s protocol',
    async ({ protocol, expectedChildren, expectedReviews }) => {
      const { ensureAssistantDataLayout } = await import('@electron/utils/assistant-data-paths');
      const { TeamOrchestrator } = await import('@electron/team/orchestrator');

      await ensureAssistantDataLayout();

      const orchestrator = new TeamOrchestrator();
      const team = await orchestrator.createTeamFromTemplate('travel-flight-search');

      try {
        await orchestrator.startTeam(team.id);

        const rootTask = await orchestrator.dispatchTask(team.id, {
          input: [
            'Prepare a same-day Shanghai to Beijing trip for one adult.',
            'This is a booking-readiness simulation, not a live purchase.',
            'If live inventory is unavailable, use clearly labeled illustrative flight options and still complete the handoff workflow.',
            'Do not submit payment.',
          ].join(' '),
          collaborative: true,
          collaborationProtocol: protocol as 'native' | 'langgraph' | 'crewai' | 'n8n',
          requestedRoleId: 'trip-coordinator',
        });

        const finishedRoot = await waitForTerminalTask(
          orchestrator,
          rootTask.id,
          getLiveProtocolTimeout(protocol),
        );
        expect(finishedRoot.status).toBe('completed');
        expect(finishedRoot.collaboration?.protocol).toBe(protocol);
        expect(String(finishedRoot.result || '').trim().length).toBeGreaterThan(0);
        expect(finishedRoot.result).not.toContain('Execution Mode: mock');

        const allTasks = orchestrator.getTasks(team.id, 300);
        const children = allTasks.filter((task) => task.collaboration?.parentTaskId === rootTask.id);
        expect(children).toHaveLength(expectedChildren);
        expect(children.every((task) => task.status === 'completed')).toBe(true);
        expect(children.filter((task) => task.collaboration?.intent === 'review')).toHaveLength(expectedReviews);
        expect(children.every((task) => !String(task.result || '').includes('Execution Mode: mock'))).toBe(true);
        expect(children.some((task) => /flight|booking|fare|policy|traveler/i.test(String(task.result || '')))).toBe(true);

        const logs = orchestrator.getLogs(team.id, 400);
        expect(logs.some((entry) => /mock runtime fallback/i.test(entry.message))).toBe(false);
        expect(logs.filter((entry) => /binding=openclaw \/ qwen3\.5-plus/i.test(entry.message)).length).toBeGreaterThanOrEqual(1);

        const workspacePath = finishedRoot.collaboration?.workspacePath;
        expect(workspacePath).toBeTruthy();

        const goalContent = await readFile(join(workspacePath!, 'GOAL.md'), 'utf-8');
        const resultContent = await readFile(join(workspacePath!, 'RESULT.md'), 'utf-8');
        const stepFiles = await readdir(join(workspacePath!, 'steps'));

        expect(goalContent).toContain(`Protocol: ${protocol}`);
        expect(resultContent.length).toBeGreaterThan(200);
        expect(resultContent).not.toContain('Execution Mode: mock');
        expect(stepFiles.length).toBe(expectedChildren);
      } finally {
        await orchestrator.shutdownAllTeams();
      }
    },
    480000,
  );
});
