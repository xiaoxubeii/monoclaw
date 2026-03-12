import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { TeamTask } from '@electron/team/types';

vi.mock('electron', () => ({
  app: {
    setPath: vi.fn(),
    getPath: vi.fn(() => '/tmp/monoclaw-test-user-data'),
    isPackaged: false,
    getAppPath: vi.fn(() => '/tmp/monoclaw-test-app'),
    getVersion: vi.fn(() => '0.0.0-test'),
  },
}));

vi.mock('@electron/utils/secure-storage', () => ({
  getDefaultProvider: vi.fn(async () => undefined),
  getProvider: vi.fn(async () => null),
  getApiKey: vi.fn(async () => null),
}));

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
  timeoutMs = 20000,
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

describe('flight search & booking crew runtime flow', () => {
  let tempRoot = '';

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'monoclaw-flight-runtime-'));
    process.env.MONOCLAW_DATA_ROOT = tempRoot;
    process.env.MONOCLAW_ROLE_RUNTIME_LATENCY_FLOOR_MS = '50';
    process.env.MONOCLAW_ROLE_RUNTIME_LATENCY_CAP_MS = '80';
    vi.resetModules();
  });

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
    delete process.env.MONOCLAW_DATA_ROOT;
    delete process.env.MONOCLAW_ROLE_RUNTIME_LATENCY_FLOOR_MS;
    delete process.env.MONOCLAW_ROLE_RUNTIME_LATENCY_CAP_MS;
    vi.clearAllMocks();
  });

  it.each([
    { protocol: 'native', expectedChildren: 6, expectedReviews: 0 },
    { protocol: 'langgraph', expectedChildren: 10, expectedReviews: 4 },
    { protocol: 'crewai', expectedChildren: 10, expectedReviews: 4 },
    { protocol: 'n8n', expectedChildren: 10, expectedReviews: 4 },
  ])(
    'runs the travel template end-to-end with %s protocol and produces booking-ready artifacts',
    async ({ protocol, expectedChildren, expectedReviews }) => {
      const { ensureAssistantDataLayout } = await import('@electron/utils/assistant-data-paths');
      const { TeamOrchestrator } = await import('@electron/team/orchestrator');

      await ensureAssistantDataLayout();

      const orchestrator = new TeamOrchestrator();
      const team = await orchestrator.createTeamFromTemplate('travel-flight-search');

      try {
        await orchestrator.startTeam(team.id);

        const rootTask = await orchestrator.dispatchTask(team.id, {
          input: 'Book a same-day Shanghai to Beijing trip for one adult. Prefer refundable fares and prepare the booking packet without submitting payment.',
          collaborative: true,
          collaborationProtocol: protocol as 'native' | 'langgraph' | 'crewai' | 'n8n',
          requestedRoleId: 'trip-coordinator',
        });

        const finishedRoot = await waitForTerminalTask(orchestrator, rootTask.id, 20000);
        expect(finishedRoot.status).toBe('completed');
        expect(finishedRoot.collaboration?.protocol).toBe(protocol);
        expect(finishedRoot.result).toContain('Collaborative goal completed successfully');
        expect(finishedRoot.result).toContain(`Protocol: ${protocol}`);
        expect(finishedRoot.result).toContain('Flight Booking Final Recommendation:');

        const allTasks = orchestrator.getTasks(team.id, 300);
        const children = allTasks.filter((task) => task.collaboration?.parentTaskId === rootTask.id);
        expect(children).toHaveLength(expectedChildren);
        expect(children.every((task) => task.status === 'completed')).toBe(true);
        expect(children.filter((task) => task.collaboration?.intent === 'review')).toHaveLength(expectedReviews);

        const bookingTask = children.find((task) => task.assignedRoleId === 'booking-operator');
        const policyTask = children.find((task) => task.assignedRoleId === 'policy-checker');
        const inventoryTask = children.find((task) => task.assignedRoleId === 'inventory-scout');

        expect(inventoryTask?.result).toContain('Flight Search Draft:');
        expect(policyTask?.result).toContain('Flight Policy Validation Note:');
        expect(bookingTask?.result).toContain('Booking Readiness Packet:');

        const workspacePath = finishedRoot.collaboration?.workspacePath;
        expect(workspacePath).toBeTruthy();

        const goalContent = await readFile(join(workspacePath!, 'GOAL.md'), 'utf-8');
        const resultContent = await readFile(join(workspacePath!, 'RESULT.md'), 'utf-8');
        expect(goalContent).toContain(`Protocol: ${protocol}`);
        expect(resultContent).toContain('Flight Search Draft:');
        expect(resultContent).toContain('Flight Policy Validation Note:');
        expect(resultContent).toContain('Booking Readiness Packet:');
      } finally {
        await orchestrator.shutdownAllTeams();
      }
    },
    30000,
  );
});
