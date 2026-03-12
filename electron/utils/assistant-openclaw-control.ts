import { access, mkdir, readFile, writeFile } from 'fs/promises';
import { constants } from 'fs';
import { dirname, join } from 'path';
import { getAssistantDataLayout } from './assistant-data-paths';
import { getOpenClawConfigDir } from './paths';

export interface ManagedOpenClawPatchResult {
  changed: boolean;
  driftDetected: boolean;
  configPath: string;
  changedFields: string[];
}

export interface ManagedOpenClawDriftStatus {
  driftDetected: boolean;
  configPath: string;
  engineConfigPath: string;
  expected: {
    workspace: string;
    qmdPaths: string[];
  };
  current: {
    workspace?: string;
    qmdPaths: string[];
  };
}

function normalizePathList(paths: string[]): string[] {
  return [...new Set(paths.map((item) => item.trim()).filter(Boolean))].sort();
}

function getExpectedQmdPaths(): string[] {
  const layout = getAssistantDataLayout();
  return normalizePathList([
    layout.knowledgeBaseDir,
    layout.habitsPrefsDir,
    layout.userCorrectionsDir,
  ]);
}

interface ManagedOpenClawEngineConfig {
  version: number;
  engine: 'openclaw';
  workspace: string;
  memory: {
    backend: 'qmd';
    qmdPaths: string[];
    qmdCommand?: string;
  };
}

function getConfigPath(): string {
  return join(getOpenClawConfigDir(), 'openclaw.json');
}

function getEngineConfigPath(): string {
  return getAssistantDataLayout().openclawEngineConfigPath;
}

function getDefaultEngineConfig(): ManagedOpenClawEngineConfig {
  const layout = getAssistantDataLayout();
  return {
    version: 1,
    engine: 'openclaw',
    workspace: layout.workspaceDir,
    memory: {
      backend: 'qmd',
      qmdPaths: getExpectedQmdPaths(),
    },
  };
}

function normalizeEngineConfig(raw: Record<string, unknown>): ManagedOpenClawEngineConfig {
  const defaults = getDefaultEngineConfig();
  const memory = raw.memory as Record<string, unknown> | undefined;
  const qmdPaths = normalizePathList(
    Array.isArray(memory?.qmdPaths)
      ? memory!.qmdPaths.filter((item): item is string => typeof item === 'string')
      : defaults.memory.qmdPaths,
  );
  const qmdCommand = typeof memory?.qmdCommand === 'string' && memory.qmdCommand.trim()
    ? memory.qmdCommand.trim()
    : undefined;

  return {
    version: 1,
    engine: 'openclaw',
    workspace: typeof raw.workspace === 'string' && raw.workspace.trim()
      ? raw.workspace
      : defaults.workspace,
    memory: {
      backend: 'qmd',
      qmdPaths: qmdPaths.length > 0 ? qmdPaths : defaults.memory.qmdPaths,
      ...(qmdCommand ? { qmdCommand } : {}),
    },
  };
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readConfig(): Promise<Record<string, unknown>> {
  const configPath = getConfigPath();
  if (!(await fileExists(configPath))) {
    return {};
  }

  try {
    const raw = await readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

async function readEngineConfig(): Promise<ManagedOpenClawEngineConfig> {
  const configPath = getEngineConfigPath();
  if (!(await fileExists(configPath))) {
    return getDefaultEngineConfig();
  }

  try {
    const raw = await readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return normalizeEngineConfig(parsed as Record<string, unknown>);
    }
    return getDefaultEngineConfig();
  } catch {
    return getDefaultEngineConfig();
  }
}

async function writeConfig(config: Record<string, unknown>): Promise<void> {
  const configPath = getConfigPath();
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
}

async function writeEngineConfig(config: ManagedOpenClawEngineConfig): Promise<void> {
  const configPath = getEngineConfigPath();
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
}

function ensureObject(
  parent: Record<string, unknown>,
  key: string
): Record<string, unknown> {
  const existing = parent[key];
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    return existing as Record<string, unknown>;
  }
  const created: Record<string, unknown> = {};
  parent[key] = created;
  return created;
}

function getCurrentManagedState(config: Record<string, unknown>): {
  workspace?: string;
  qmdPaths: string[];
} {
  const agents = config.agents as Record<string, unknown> | undefined;
  const defaults = agents?.defaults as Record<string, unknown> | undefined;

  const memory = config.memory as Record<string, unknown> | undefined;
  const qmd = memory?.qmd as Record<string, unknown> | undefined;
  const rawPaths = Array.isArray(qmd?.paths)
    ? (qmd?.paths as Array<Record<string, unknown>>)
    : [];
  const qmdPaths = normalizePathList(
    rawPaths
      .map((item) => item?.path)
      .filter((item): item is string => typeof item === 'string')
  );

  return {
    workspace: typeof defaults?.workspace === 'string' ? defaults.workspace : undefined,
    qmdPaths,
  };
}

function isDrift(
  current: ReturnType<typeof getCurrentManagedState>,
  expected: { workspace: string; qmdPaths: string[] },
): boolean {
  if (current.workspace !== expected.workspace) return true;

  const currentPaths = normalizePathList(current.qmdPaths);
  const expectedPaths = normalizePathList(expected.qmdPaths);
  if (currentPaths.length !== expectedPaths.length) return true;
  for (let i = 0; i < expectedPaths.length; i++) {
    if (expectedPaths[i] !== currentPaths[i]) return true;
  }

  return false;
}

export async function checkManagedOpenClawDrift(): Promise<ManagedOpenClawDriftStatus> {
  const config = await readConfig();
  const current = getCurrentManagedState(config);
  const engineConfig = await readEngineConfig();
  const expected = {
    workspace: engineConfig.workspace,
    qmdPaths: normalizePathList(engineConfig.memory.qmdPaths),
  };

  return {
    driftDetected: isDrift(current, expected),
    configPath: getConfigPath(),
    engineConfigPath: getEngineConfigPath(),
    expected,
    current,
  };
}

export async function applyManagedOpenClawConfig(
  gatewayToken?: string
): Promise<ManagedOpenClawPatchResult> {
  const config = await readConfig();
  const layout = getAssistantDataLayout();
  const changedFields: string[] = [];
  let openclawChanged = false;
  let engineConfigChanged = false;

  const engineConfig = await readEngineConfig();
  const expectedQmdPaths = getExpectedQmdPaths();
  if (engineConfig.workspace !== layout.workspaceDir) {
    engineConfig.workspace = layout.workspaceDir;
    changedFields.push('engine.workspace');
    engineConfigChanged = true;
  }
  if (engineConfig.memory.backend !== 'qmd') {
    engineConfig.memory.backend = 'qmd';
    changedFields.push('engine.memory.backend');
    engineConfigChanged = true;
  }
  if (JSON.stringify(normalizePathList(engineConfig.memory.qmdPaths)) !== JSON.stringify(expectedQmdPaths)) {
    engineConfig.memory.qmdPaths = expectedQmdPaths;
    changedFields.push('engine.memory.qmdPaths');
    engineConfigChanged = true;
  }

  const current = getCurrentManagedState(config);
  const driftDetected = isDrift(current, {
    workspace: engineConfig.workspace,
    qmdPaths: engineConfig.memory.qmdPaths,
  });

  const agents = ensureObject(config, 'agents');
  const defaults = ensureObject(agents, 'defaults');
  if (defaults.workspace !== engineConfig.workspace) {
    defaults.workspace = engineConfig.workspace;
    changedFields.push('agents.defaults.workspace');
    openclawChanged = true;
  }

  const memory = ensureObject(config, 'memory');
  if (memory.backend !== 'qmd') {
    memory.backend = 'qmd';
    changedFields.push('memory.backend');
    openclawChanged = true;
  }
  const qmd = ensureObject(memory, 'qmd');
  const expectedPathEntries = engineConfig.memory.qmdPaths.map((path) => ({
    path,
    name: path.split('/').at(-1) || 'memory',
    pattern: '**/*.md',
  }));

  const currentQmdPaths = normalizePathList(
    (Array.isArray(qmd.paths) ? qmd.paths : [])
      .map((item) => (item && typeof item === 'object' ? (item as Record<string, unknown>).path : undefined))
      .filter((item): item is string => typeof item === 'string')
  );
  if (JSON.stringify(currentQmdPaths) !== JSON.stringify(normalizePathList(engineConfig.memory.qmdPaths))) {
    qmd.paths = expectedPathEntries;
    changedFields.push('memory.qmd.paths');
    openclawChanged = true;
  }

  const currentQmdCommand = typeof qmd.command === 'string' && qmd.command.trim()
    ? qmd.command.trim()
    : undefined;
  if (!engineConfig.memory.qmdCommand && currentQmdCommand) {
    engineConfig.memory.qmdCommand = currentQmdCommand;
    changedFields.push('engine.memory.qmdCommand');
    engineConfigChanged = true;
  }
  if (engineConfig.memory.qmdCommand && qmd.command !== engineConfig.memory.qmdCommand) {
    qmd.command = engineConfig.memory.qmdCommand;
    changedFields.push('memory.qmd.command');
    openclawChanged = true;
  }

  const plugins = ensureObject(config, 'plugins');
  const entries = ensureObject(plugins, 'entries');
  if (Object.prototype.hasOwnProperty.call(entries, 'memory-lancedb')) {
    delete entries['memory-lancedb'];
    changedFields.push('plugins.entries.memory-lancedb');
    openclawChanged = true;
  }

  if (gatewayToken && gatewayToken.trim()) {
    const gateway = ensureObject(config, 'gateway');
    const auth = ensureObject(gateway, 'auth');
    if (auth.mode !== 'token') {
      auth.mode = 'token';
      changedFields.push('gateway.auth.mode');
      openclawChanged = true;
    }
    if (auth.token !== gatewayToken) {
      auth.token = gatewayToken;
      changedFields.push('gateway.auth.token');
      openclawChanged = true;
    }
  }

  if (engineConfigChanged) {
    await writeEngineConfig(engineConfig);
  }
  if (openclawChanged) {
    await writeConfig(config);
  }

  const changed = engineConfigChanged || openclawChanged;
  return {
    changed,
    driftDetected,
    configPath: getConfigPath(),
    changedFields,
  };
}
