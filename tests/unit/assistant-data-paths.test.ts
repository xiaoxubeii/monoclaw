import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('electron', () => ({
  app: {
    setPath: vi.fn(),
    getPath: vi.fn(() => '/tmp/monoclaw-user-data'),
    isPackaged: false,
    getAppPath: vi.fn(() => '/tmp/monoclaw-app'),
    getVersion: vi.fn(() => '0.0.0-test'),
  },
}));

import { app } from 'electron';
import {
  configureAssistantDataEnvironment,
  ensureAssistantDataLayout,
  getAssistantDataHealth,
} from '@electron/utils/assistant-data-paths';

let tempRoot = '';

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'monoclaw-assistant-data-'));
  process.env.MONOCLAW_ASSISTANT_DATA_ROOT = tempRoot;
  delete process.env.OPENCLAW_HOME;
  delete process.env.OPENCLAW_STATE_DIR;
  delete process.env.OPENCLAW_CONFIG_PATH;
  delete process.env.MONOCLAW_RUNTIME_CONFIG_PATH;
  delete process.env.MONOCLAW_OPENCLAW_ENGINE_CONFIG_PATH;
});

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
  delete process.env.MONOCLAW_ASSISTANT_DATA_ROOT;
  delete process.env.OPENCLAW_HOME;
  delete process.env.OPENCLAW_STATE_DIR;
  delete process.env.OPENCLAW_CONFIG_PATH;
  delete process.env.MONOCLAW_RUNTIME_CONFIG_PATH;
  delete process.env.MONOCLAW_OPENCLAW_ENGINE_CONFIG_PATH;
  vi.clearAllMocks();
});

describe('assistant-data-paths', () => {
  it('creates the full managed directory layout and reports healthy', async () => {
    const layout = await ensureAssistantDataLayout();

    const expectedDirs = [
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
      layout.vectorStoreLanceDbDir,
      layout.workspaceRootDir,
      layout.workspaceDir,
      layout.activeSessionsDir,
      layout.inboxOutboxDir,
    ];

    for (const dir of expectedDirs) {
      await access(dir, constants.F_OK);
    }
    await access(layout.runtimeConfigPath, constants.F_OK);
    await access(layout.openclawEngineConfigPath, constants.F_OK);

    const health = await getAssistantDataHealth();
    expect(health.root).toBe(layout.root);
    expect(health.writable).toBe(true);
    expect(health.missingDirs).toEqual([]);
  });

  it('configures OPENCLAW env vars and redirects Electron userData', async () => {
    const layout = await configureAssistantDataEnvironment();

    expect(process.env.OPENCLAW_HOME).toBe(layout.openclawEngineRootDir);
    expect(process.env.OPENCLAW_STATE_DIR).toBe(layout.openclawStateDir);
    expect(process.env.OPENCLAW_CONFIG_PATH).toBe(layout.openclawConfigPath);
    expect(process.env.MONOCLAW_RUNTIME_CONFIG_PATH).toBe(layout.runtimeConfigPath);
    expect(process.env.MONOCLAW_OPENCLAW_ENGINE_CONFIG_PATH).toBe(layout.openclawEngineConfigPath);
    expect(app.setPath).toHaveBeenCalledWith('userData', layout.monoclawUserDataDir);
  });
});
