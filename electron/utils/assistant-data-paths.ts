import { app } from 'electron';
import { access, cp, mkdir, readdir, writeFile } from 'fs/promises';
import { constants } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export interface AssistantDataLayout {
  root: string;
  controlRoot: string;
  runtimeConfigPath: string;
  enginesRootDir: string;
  openclawEngineRootDir: string;
  openclawEngineConfigPath: string;
  openclawEngineStateDir: string;
  openclawEngineLogsDir: string;
  openclawStateDir: string;
  openclawConfigPath: string;
  monoclawUserDataDir: string;
  monoclawConfigDir: string;
  vaultDir: string;
  memoryRootDir: string;
  knowledgeBaseDir: string;
  habitsPrefsDir: string;
  userCorrectionsDir: string;
  interactionHistoryDir: string;
  vectorStoreRootDir: string;
  vectorStoreLanceDbDir: string;
  actionAssetsRootDir: string;
  uiAnchorsDir: string;
  workflowsDir: string;
  appBlueprintsDir: string;
  workspaceRootDir: string;
  workspaceDir: string;
  activeSessionsDir: string;
  inboxOutboxDir: string;
  screenshotsDir: string;
  taskLogsDir: string;
  clipboardDir: string;
}

export interface AssistantDataHealth {
  root: string;
  writable: boolean;
  missingDirs: string[];
}

const MONOCLAW_ROOT_ENV = 'MONOCLAW_DATA_ROOT';
const LEGACY_ASSISTANT_ROOT_ENV = 'MONOCLAW_ASSISTANT_DATA_ROOT';

function isNonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function resolveRootPath(): string {
  const monoclawRoot = process.env[MONOCLAW_ROOT_ENV]?.trim();
  if (isNonEmpty(monoclawRoot)) {
    return monoclawRoot;
  }

  const legacyRoot = process.env[LEGACY_ASSISTANT_ROOT_ENV]?.trim();
  if (isNonEmpty(legacyRoot)) {
    return legacyRoot;
  }

  return join(homedir(), 'monoclaw_data');
}

function requiredDirs(layout: AssistantDataLayout): string[] {
  return [
    layout.root,
    layout.controlRoot,
    layout.enginesRootDir,
    layout.openclawEngineRootDir,
    layout.openclawEngineStateDir,
    layout.openclawEngineLogsDir,
    layout.openclawStateDir,
    layout.monoclawUserDataDir,
    layout.monoclawConfigDir,
    layout.vaultDir,
    layout.memoryRootDir,
    layout.knowledgeBaseDir,
    layout.habitsPrefsDir,
    layout.userCorrectionsDir,
    layout.interactionHistoryDir,
    layout.vectorStoreRootDir,
    layout.vectorStoreLanceDbDir,
    layout.actionAssetsRootDir,
    layout.uiAnchorsDir,
    layout.workflowsDir,
    layout.appBlueprintsDir,
    layout.workspaceRootDir,
    layout.workspaceDir,
    layout.activeSessionsDir,
    layout.inboxOutboxDir,
    layout.screenshotsDir,
    layout.taskLogsDir,
    layout.clipboardDir,
  ];
}

function getExpectedManagedQmdPaths(layout: AssistantDataLayout): string[] {
  return [
    layout.knowledgeBaseDir,
    layout.habitsPrefsDir,
    layout.userCorrectionsDir,
  ];
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function ensureJsonFile(path: string, data: Record<string, unknown>): Promise<void> {
  if (await pathExists(path)) {
    return;
  }
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

async function migrateLegacyOpenClawState(layout: AssistantDataLayout): Promise<void> {
  const legacyOpenClawStateDir = join(layout.controlRoot, 'openclaw_state');
  if (legacyOpenClawStateDir === layout.openclawStateDir) {
    return;
  }

  if (!(await pathExists(legacyOpenClawStateDir))) {
    return;
  }

  await mkdir(layout.openclawStateDir, { recursive: true });
  const entries = await readdir(legacyOpenClawStateDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = join(legacyOpenClawStateDir, entry.name);
    const targetPath = join(layout.openclawStateDir, entry.name);
    if (await pathExists(targetPath)) {
      continue;
    }
    await cp(sourcePath, targetPath, {
      recursive: true,
      errorOnExist: false,
      force: false,
    });
  }
}

async function ensureManagedControlPlaneConfigs(layout: AssistantDataLayout): Promise<void> {
  await ensureJsonFile(layout.runtimeConfigPath, {
    version: 1,
    defaultEngine: 'openclaw',
    engines: {
      openclaw: {
        enabled: true,
        configPath: layout.openclawEngineConfigPath,
        stateDir: layout.openclawEngineStateDir,
        logsDir: layout.openclawEngineLogsDir,
      },
    },
  });

  await ensureJsonFile(layout.openclawEngineConfigPath, {
    version: 1,
    engine: 'openclaw',
    workspace: layout.workspaceDir,
    memory: {
      backend: 'qmd',
      qmdPaths: getExpectedManagedQmdPaths(layout),
    },
  });
}

export function getAssistantDataLayout(): AssistantDataLayout {
  const root = resolveRootPath();
  const controlRoot = join(root, '00_control');
  const runtimeConfigPath = join(controlRoot, 'runtime.json');
  const enginesRootDir = join(controlRoot, 'engines');
  const openclawEngineRootDir = join(enginesRootDir, 'openclaw');
  const openclawEngineStateDir = join(openclawEngineRootDir, 'state');
  const openclawEngineLogsDir = join(openclawEngineRootDir, 'logs');
  const openclawEngineConfigPath = join(openclawEngineRootDir, 'config.json');
  const openclawStateDir = openclawEngineStateDir;
  const monoclawUserDataDir = join(controlRoot, 'monoclaw_user_data');
  const monoclawConfigDir = join(controlRoot, 'monoclaw_config');
  const memoryRootDir = join(root, '02_memory');
  const workspaceRootDir = join(root, '04_workspace');

  return {
    root,
    controlRoot,
    runtimeConfigPath,
    enginesRootDir,
    openclawEngineRootDir,
    openclawEngineConfigPath,
    openclawEngineStateDir,
    openclawEngineLogsDir,
    openclawStateDir,
    openclawConfigPath: join(openclawStateDir, 'openclaw.json'),
    monoclawUserDataDir,
    monoclawConfigDir,
    vaultDir: join(root, '01_vault'),
    memoryRootDir,
    knowledgeBaseDir: join(memoryRootDir, 'knowledge_base'),
    habitsPrefsDir: join(memoryRootDir, 'habits_prefs'),
    userCorrectionsDir: join(memoryRootDir, 'user_corrections'),
    interactionHistoryDir: join(memoryRootDir, 'interaction_history'),
    vectorStoreRootDir: join(memoryRootDir, 'vector_store'),
    vectorStoreLanceDbDir: join(memoryRootDir, 'vector_store', 'lancedb'),
    actionAssetsRootDir: join(root, '03_action_assets'),
    uiAnchorsDir: join(root, '03_action_assets', 'ui_anchors'),
    workflowsDir: join(root, '03_action_assets', 'workflows'),
    appBlueprintsDir: join(root, '03_action_assets', 'app_blueprints'),
    workspaceRootDir,
    workspaceDir: join(workspaceRootDir, 'workspace'),
    activeSessionsDir: join(workspaceRootDir, 'active_sessions'),
    inboxOutboxDir: join(workspaceRootDir, 'inbox_outbox'),
    screenshotsDir: join(workspaceRootDir, 'screenshots'),
    taskLogsDir: join(workspaceRootDir, 'task_logs'),
    clipboardDir: join(workspaceRootDir, 'clipboard'),
  };
}

export async function ensureAssistantDataLayout(): Promise<AssistantDataLayout> {
  const layout = getAssistantDataLayout();
  const dirs = requiredDirs(layout);
  for (const dir of dirs) {
    await mkdir(dir, { recursive: true });
  }
  await migrateLegacyOpenClawState(layout);
  await ensureManagedControlPlaneConfigs(layout);
  return layout;
}

export async function getAssistantDataHealth(): Promise<AssistantDataHealth> {
  const layout = getAssistantDataLayout();
  const dirs = requiredDirs(layout);
  const missingDirs: string[] = [];

  for (const dir of dirs) {
    try {
      await access(dir, constants.F_OK);
    } catch {
      missingDirs.push(dir);
    }
  }

  let writable = true;
  try {
    await access(layout.root, constants.W_OK);
  } catch {
    writable = false;
  }

  return {
    root: layout.root,
    writable,
    missingDirs,
  };
}

export async function configureAssistantDataEnvironment(): Promise<AssistantDataLayout> {
  const layout = await ensureAssistantDataLayout();

  process.env.OPENCLAW_HOME = layout.openclawEngineRootDir;
  process.env.OPENCLAW_STATE_DIR = layout.openclawStateDir;
  process.env.OPENCLAW_CONFIG_PATH = layout.openclawConfigPath;
  process.env.MONOCLAW_RUNTIME_CONFIG_PATH = layout.runtimeConfigPath;
  process.env.MONOCLAW_OPENCLAW_ENGINE_CONFIG_PATH = layout.openclawEngineConfigPath;

  app.setPath('userData', layout.monoclawUserDataDir);

  return layout;
}
