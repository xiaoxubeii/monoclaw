import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CollaborationProtocol } from './types';
import type { RoleCollaborationFlow, RoleCollaborationFlowNode } from './collaboration-protocol';

export const NATIVE_V2_STATE_FILE = 'NATIVE_V2_STATE.json';
export const NATIVE_V2_EVENTS_FILE = 'NATIVE_V2_EVENTS.jsonl';

export type NativeV2ExecutionStatus = 'running' | 'completed' | 'failed' | 'blocked';
export type NativeV2NodeStatus = 'queued' | 'running' | 'completed' | 'failed' | 'blocked';

export interface NativeV2NodeRuntimeState {
  node: RoleCollaborationFlowNode;
  status: NativeV2NodeStatus;
  attempts: number;
  taskId?: string;
  output?: string;
  error?: string;
  blockedReason?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface NativeV2Intervention {
  id: string;
  note: string;
  createdAt: string;
  resumedNodeIds: string[];
}

export interface NativeV2ExecutionState {
  version: 1;
  goalId: string;
  rootTaskId: string;
  teamId: string;
  protocol: CollaborationProtocol;
  status: NativeV2ExecutionStatus;
  createdAt: string;
  updatedAt: string;
  blockedReason?: string;
  interventions: NativeV2Intervention[];
  flow: RoleCollaborationFlow;
  nodes: Record<string, NativeV2NodeRuntimeState>;
}

export interface NativeV2Event {
  ts: string;
  type: string;
  nodeId?: string;
  taskId?: string;
  details?: Record<string, unknown>;
}

interface CreateNativeV2ExecutionStateInput {
  goalId: string;
  rootTaskId: string;
  teamId: string;
  protocol: CollaborationProtocol;
  flow: RoleCollaborationFlow;
  now?: string;
}

function isNodeTerminal(status: NativeV2NodeStatus): boolean {
  return status === 'completed' || status === 'failed';
}

function cloneFlow(flow: RoleCollaborationFlow): RoleCollaborationFlow {
  return JSON.parse(JSON.stringify(flow)) as RoleCollaborationFlow;
}

function cloneState(state: NativeV2ExecutionState): NativeV2ExecutionState {
  return JSON.parse(JSON.stringify(state)) as NativeV2ExecutionState;
}

export function createNativeV2ExecutionState(input: CreateNativeV2ExecutionStateInput): NativeV2ExecutionState {
  const now = input.now || new Date().toISOString();
  const flow = cloneFlow(input.flow);
  const nodes: Record<string, NativeV2NodeRuntimeState> = {};

  for (const node of flow.nodes) {
    nodes[node.id] = {
      node,
      status: 'queued',
      attempts: 0,
    };
  }

  return {
    version: 1,
    goalId: input.goalId,
    rootTaskId: input.rootTaskId,
    teamId: input.teamId,
    protocol: input.protocol,
    status: 'running',
    createdAt: now,
    updatedAt: now,
    interventions: [],
    flow,
    nodes,
  };
}

export function recoverNativeV2ExecutionState(
  state: NativeV2ExecutionState,
  fallbackFlow?: RoleCollaborationFlow,
): NativeV2ExecutionState {
  const recovered = cloneState(state);
  const flow = fallbackFlow ? cloneFlow(fallbackFlow) : recovered.flow;
  recovered.flow = flow;
  recovered.interventions = Array.isArray(recovered.interventions) ? recovered.interventions : [];

  const nextNodes: Record<string, NativeV2NodeRuntimeState> = {};
  for (const node of flow.nodes) {
    const existing = recovered.nodes[node.id];
    if (!existing) {
      nextNodes[node.id] = {
        node,
        status: 'queued',
        attempts: 0,
      };
      continue;
    }

    const normalized: NativeV2NodeRuntimeState = {
      ...existing,
      node,
    };
    if (normalized.status === 'running') {
      normalized.status = 'queued';
      normalized.taskId = undefined;
      normalized.blockedReason = undefined;
    }
    nextNodes[node.id] = normalized;
  }

  recovered.nodes = nextNodes;
  recovered.updatedAt = new Date().toISOString();

  if (Object.values(recovered.nodes).every((entry) => entry.status === 'completed')) {
    recovered.status = 'completed';
    recovered.blockedReason = undefined;
  } else if (Object.values(recovered.nodes).some((entry) => entry.status === 'failed')) {
    recovered.status = 'failed';
    recovered.blockedReason = undefined;
  } else if (Object.values(recovered.nodes).some((entry) => entry.status === 'blocked')) {
    recovered.status = 'blocked';
  } else {
    recovered.status = 'running';
    recovered.blockedReason = undefined;
  }

  return recovered;
}

export function listNativeV2ReadyNodes(state: NativeV2ExecutionState): RoleCollaborationFlowNode[] {
  const ready: RoleCollaborationFlowNode[] = [];
  for (const node of state.flow.nodes) {
    const runtime = state.nodes[node.id];
    if (!runtime || runtime.status !== 'queued') continue;

    const dependencyReady = node.dependsOn.every((depId) => state.nodes[depId]?.status === 'completed');
    if (dependencyReady) {
      ready.push(node);
    }
  }
  return ready;
}

export function pickNativeV2DispatchBatch(
  state: NativeV2ExecutionState,
  maxParallelism: number,
  roleBusySet?: Set<string>,
): RoleCollaborationFlowNode[] {
  const busyRoles = new Set(roleBusySet ?? []);
  const ready = listNativeV2ReadyNodes(state)
    .sort((a, b) => a.step - b.step);
  const batch: RoleCollaborationFlowNode[] = [];

  for (const node of ready) {
    if (batch.length >= maxParallelism) break;
    if (busyRoles.has(node.executorRoleId)) continue;
    busyRoles.add(node.executorRoleId);
    batch.push(node);
  }

  return batch;
}

export function markNativeV2NodeRunning(
  state: NativeV2ExecutionState,
  nodeId: string,
  taskId: string,
): NativeV2ExecutionState {
  const next = cloneState(state);
  const runtime = next.nodes[nodeId];
  if (!runtime) {
    throw new Error(`Unknown flow node: ${nodeId}`);
  }
  runtime.status = 'running';
  runtime.attempts += 1;
  runtime.taskId = taskId;
  runtime.error = undefined;
  runtime.startedAt = new Date().toISOString();
  runtime.completedAt = undefined;
  next.status = 'running';
  next.updatedAt = new Date().toISOString();
  return next;
}

export function markNativeV2NodeCompleted(
  state: NativeV2ExecutionState,
  nodeId: string,
  output: string,
): NativeV2ExecutionState {
  const next = cloneState(state);
  const runtime = next.nodes[nodeId];
  if (!runtime) {
    throw new Error(`Unknown flow node: ${nodeId}`);
  }
  runtime.status = 'completed';
  runtime.output = output;
  runtime.error = undefined;
  runtime.blockedReason = undefined;
  runtime.completedAt = new Date().toISOString();
  next.updatedAt = new Date().toISOString();
  if (Object.values(next.nodes).every((entry) => entry.status === 'completed')) {
    next.status = 'completed';
    next.blockedReason = undefined;
  }
  return next;
}

export function markNativeV2NodeFailed(
  state: NativeV2ExecutionState,
  nodeId: string,
  error: string,
): NativeV2ExecutionState {
  const next = cloneState(state);
  const runtime = next.nodes[nodeId];
  if (!runtime) {
    throw new Error(`Unknown flow node: ${nodeId}`);
  }
  runtime.status = 'failed';
  runtime.error = error;
  runtime.blockedReason = undefined;
  runtime.completedAt = new Date().toISOString();
  next.status = 'failed';
  next.blockedReason = undefined;
  next.updatedAt = new Date().toISOString();
  return next;
}

export function markNativeV2NodeBlocked(
  state: NativeV2ExecutionState,
  nodeId: string,
  reason: string,
  output?: string,
): NativeV2ExecutionState {
  const next = cloneState(state);
  const runtime = next.nodes[nodeId];
  if (!runtime) {
    throw new Error(`Unknown flow node: ${nodeId}`);
  }
  runtime.status = 'blocked';
  runtime.error = undefined;
  runtime.blockedReason = reason;
  runtime.output = output || runtime.output;
  runtime.completedAt = new Date().toISOString();
  next.status = 'blocked';
  next.blockedReason = reason;
  next.updatedAt = new Date().toISOString();
  return next;
}

export function applyNativeV2Intervention(
  state: NativeV2ExecutionState,
  note: string,
  now?: string,
): NativeV2ExecutionState {
  const trimmed = note.trim();
  if (!trimmed) {
    throw new Error('Intervention note is required');
  }

  const next = cloneState(state);
  const resumedNodeIds = Object.values(next.nodes)
    .filter((entry) => entry.status === 'blocked')
    .map((entry) => entry.node.id);

  if (resumedNodeIds.length === 0) {
    throw new Error('No blocked nodes waiting for intervention');
  }

  for (const nodeId of resumedNodeIds) {
    const entry = next.nodes[nodeId];
    entry.status = 'queued';
    entry.taskId = undefined;
    entry.error = undefined;
    entry.blockedReason = undefined;
    entry.completedAt = undefined;
    entry.output = [
      entry.output || '',
      '',
      '[User intervention]',
      trimmed,
    ].join('\n').trim();
  }

  const createdAt = now || new Date().toISOString();
  next.interventions.push({
    id: `${createdAt}:${next.interventions.length + 1}`,
    note: trimmed,
    createdAt,
    resumedNodeIds,
  });
  next.status = 'running';
  next.blockedReason = undefined;
  next.updatedAt = createdAt;
  return next;
}

export function hasNativeV2RunningNodes(state: NativeV2ExecutionState): boolean {
  return Object.values(state.nodes).some((entry) => entry.status === 'running');
}

export function isNativeV2ExecutionTerminal(state: NativeV2ExecutionState): boolean {
  if (state.status === 'completed' || state.status === 'failed') return true;
  return Object.values(state.nodes).every((entry) => isNodeTerminal(entry.status));
}

export function getNativeV2FinalOutput(state: NativeV2ExecutionState): string {
  const finalNode = [...state.flow.nodes]
    .sort((a, b) => b.step - a.step)
    .find((node) => node.intent === 'complete');
  if (finalNode) {
    return state.nodes[finalNode.id]?.output?.trim() || '';
  }
  const latestCompleted = [...state.flow.nodes]
    .sort((a, b) => b.step - a.step)
    .find((node) => state.nodes[node.id]?.status === 'completed');
  return latestCompleted ? state.nodes[latestCompleted.id]?.output?.trim() || '' : '';
}

export function listNativeV2CompletedNodeStates(state: NativeV2ExecutionState): NativeV2NodeRuntimeState[] {
  return [...state.flow.nodes]
    .sort((a, b) => a.step - b.step)
    .map((node) => state.nodes[node.id])
    .filter((entry): entry is NativeV2NodeRuntimeState => Boolean(entry) && entry.status === 'completed');
}

export async function loadNativeV2ExecutionState(workspacePath: string): Promise<NativeV2ExecutionState | null> {
  const statePath = join(workspacePath, NATIVE_V2_STATE_FILE);
  try {
    const content = await readFile(statePath, 'utf-8');
    return JSON.parse(content) as NativeV2ExecutionState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function persistNativeV2ExecutionState(
  workspacePath: string,
  state: NativeV2ExecutionState,
): Promise<void> {
  await mkdir(workspacePath, { recursive: true, mode: 0o700 });
  const statePath = join(workspacePath, NATIVE_V2_STATE_FILE);
  const tempPath = `${statePath}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
  await rename(tempPath, statePath);
}

export async function appendNativeV2Event(
  workspacePath: string,
  event: NativeV2Event,
): Promise<void> {
  await mkdir(workspacePath, { recursive: true, mode: 0o700 });
  const eventPath = join(workspacePath, NATIVE_V2_EVENTS_FILE);
  await appendFile(eventPath, `${JSON.stringify(event)}\n`, { encoding: 'utf-8' });
}
