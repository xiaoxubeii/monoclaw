import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RoleCollaborationFlow, RoleCollaborationFlowNode } from '@electron/team/collaboration-protocol';
import {
  NATIVE_V2_EVENTS_FILE,
  NATIVE_V2_STATE_FILE,
  applyNativeV2Intervention,
  appendNativeV2Event,
  createNativeV2ExecutionState,
  listNativeV2ReadyNodes,
  loadNativeV2ExecutionState,
  markNativeV2NodeBlocked,
  markNativeV2NodeCompleted,
  markNativeV2NodeRunning,
  persistNativeV2ExecutionState,
  pickNativeV2DispatchBatch,
  recoverNativeV2ExecutionState,
} from '@electron/team/native-v2';

function buildNode(
  id: string,
  step: number,
  intent: 'clarify' | 'handoff' | 'review' | 'complete',
  executorRoleId: string,
  dependsOn: string[],
): RoleCollaborationFlowNode {
  return {
    id,
    step,
    protocol: 'native',
    intent,
    executorRoleId,
    fromRoleId: intent === 'clarify' ? executorRoleId : 'trip-coordinator',
    toRoleId: intent === 'complete' ? 'trip-coordinator' : executorRoleId,
    title: `${intent}-${id}`,
    expectedOutput: `${intent} output`,
    dependsOn,
  };
}

function buildFlow(): RoleCollaborationFlow {
  return {
    protocol: 'native',
    nodes: [
      buildNode('n1', 1, 'clarify', 'trip-coordinator', []),
      buildNode('n2', 2, 'handoff', 'inventory-scout', ['n1']),
      buildNode('n3', 3, 'handoff', 'price-analyst', ['n1']),
      buildNode('n4', 4, 'complete', 'trip-coordinator', ['n2', 'n3']),
    ],
  };
}

describe('native-v2 execution state', () => {
  let tempRoot = '';

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = '';
    }
  });

  it('builds ready queue and dispatch batch for branch flow', () => {
    const flow = buildFlow();
    let state = createNativeV2ExecutionState({
      goalId: 'goal-1',
      rootTaskId: 'root-1',
      teamId: 'team-1',
      protocol: 'native',
      flow,
      now: '2026-03-13T00:00:00.000Z',
    });

    expect(listNativeV2ReadyNodes(state).map((item) => item.id)).toEqual(['n1']);

    state = markNativeV2NodeCompleted(state, 'n1', 'clarified');
    expect(listNativeV2ReadyNodes(state).map((item) => item.id).sort()).toEqual(['n2', 'n3']);

    const batch = pickNativeV2DispatchBatch(state, 2);
    expect(batch.map((item) => item.id).sort()).toEqual(['n2', 'n3']);
  });

  it('persists and recovers running state for resume', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'monoclaw-native-v2-'));
    const flow = buildFlow();
    let state = createNativeV2ExecutionState({
      goalId: 'goal-2',
      rootTaskId: 'root-2',
      teamId: 'team-2',
      protocol: 'native',
      flow,
    });
    state = markNativeV2NodeRunning(state, 'n1', 'child-task-1');

    await persistNativeV2ExecutionState(tempRoot, state);
    await appendNativeV2Event(tempRoot, {
      ts: '2026-03-13T00:00:01.000Z',
      type: 'node-running',
      nodeId: 'n1',
      taskId: 'child-task-1',
    });

    const loaded = await loadNativeV2ExecutionState(tempRoot);
    expect(loaded).toBeTruthy();

    const recovered = recoverNativeV2ExecutionState(loaded!, flow);
    expect(recovered.nodes.n1.status).toBe('queued');
    expect(recovered.nodes.n1.taskId).toBeUndefined();
    expect(recovered.status).toBe('running');

    const statePath = join(tempRoot, NATIVE_V2_STATE_FILE);
    const eventsPath = join(tempRoot, NATIVE_V2_EVENTS_FILE);
    const stateContent = await readFile(statePath, 'utf-8');
    const eventsContent = await readFile(eventsPath, 'utf-8');

    expect(stateContent).toContain('"goalId": "goal-2"');
    expect(eventsContent).toContain('"type":"node-running"');
  });

  it('applies user intervention to blocked nodes and resumes scheduler state', () => {
    const flow = buildFlow();
    let state = createNativeV2ExecutionState({
      goalId: 'goal-3',
      rootTaskId: 'root-3',
      teamId: 'team-3',
      protocol: 'native',
      flow,
    });

    state = markNativeV2NodeCompleted(state, 'n1', 'clarified');
    state = markNativeV2NodeBlocked(state, 'n2', 'Need travel date');
    expect(state.status).toBe('blocked');

    const resumed = applyNativeV2Intervention(state, 'Travel date is 2026-03-20', '2026-03-13T10:00:00.000Z');
    expect(resumed.status).toBe('running');
    expect(resumed.nodes.n2.status).toBe('queued');
    expect(resumed.interventions).toHaveLength(1);
    expect(resumed.interventions[0]?.note).toContain('2026-03-20');
    expect(listNativeV2ReadyNodes(resumed).map((item) => item.id)).toContain('n2');
  });
});
