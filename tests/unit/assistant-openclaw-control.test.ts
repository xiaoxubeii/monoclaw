import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

import {
  ensureAssistantDataLayout,
  getAssistantDataLayout,
} from '@electron/utils/assistant-data-paths';
import {
  applyManagedOpenClawConfig,
  checkManagedOpenClawDrift,
} from '@electron/utils/assistant-openclaw-control';

let tempRoot = '';

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'monoclaw-openclaw-control-'));
  process.env.MONOCLAW_ASSISTANT_DATA_ROOT = tempRoot;
  await ensureAssistantDataLayout();
});

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
  delete process.env.MONOCLAW_ASSISTANT_DATA_ROOT;
});

describe('assistant-openclaw-control', () => {
  it('writes managed fields and clears drift', async () => {
    const layout = getAssistantDataLayout();

    const applyResult = await applyManagedOpenClawConfig('gateway-token-123');
    expect(applyResult.changed).toBe(true);
    expect(applyResult.changedFields.length).toBeGreaterThan(0);
    expect(applyResult.configPath).toBe(layout.openclawConfigPath);

    const config = JSON.parse(await readFile(layout.openclawConfigPath, 'utf-8')) as {
      agents?: { defaults?: { workspace?: string } };
      memory?: { backend?: string; qmd?: { paths?: Array<{ path: string }> } };
      plugins?: {
        entries?: {
          ['memory-lancedb']?: unknown;
        };
      };
      gateway?: { auth?: { mode?: string; token?: string } };
    };

    expect(config.agents?.defaults?.workspace).toBe(layout.workspaceDir);
    expect(config.memory?.backend).toBe('qmd');
    expect(config.memory?.qmd?.paths?.map((item) => item.path).sort()).toEqual(
      [layout.habitsPrefsDir, layout.knowledgeBaseDir, layout.userCorrectionsDir].sort(),
    );
    expect(config.plugins?.entries?.['memory-lancedb']).toBeUndefined();
    expect(config.gateway?.auth?.mode).toBe('token');
    expect(config.gateway?.auth?.token).toBe('gateway-token-123');

    const engineConfig = JSON.parse(await readFile(layout.openclawEngineConfigPath, 'utf-8')) as {
      workspace?: string;
      memory?: { backend?: string; qmdPaths?: string[] };
    };
    expect(engineConfig.workspace).toBe(layout.workspaceDir);
    expect(engineConfig.memory?.backend).toBe('qmd');
    expect((engineConfig.memory?.qmdPaths ?? []).sort()).toEqual(
      [layout.habitsPrefsDir, layout.knowledgeBaseDir, layout.userCorrectionsDir].sort(),
    );

    const drift = await checkManagedOpenClawDrift();
    expect(drift.driftDetected).toBe(false);
    expect(drift.engineConfigPath).toBe(layout.openclawEngineConfigPath);
  });

  it('detects drift and auto-repairs managed fields', async () => {
    const layout = getAssistantDataLayout();

    const driftedConfig = {
      agents: {
        defaults: {
          workspace: '/tmp/wrong-workspace',
        },
      },
      memory: {
        backend: 'json',
        qmd: {
          paths: [{ path: '/tmp/wrong-memory', name: 'wrong', pattern: '**/*.md' }],
        },
      },
      plugins: {
        entries: {
          'memory-lancedb': {
            enabled: false,
            config: { dbPath: '/tmp/wrong-lancedb' },
          },
        },
      },
    };
    await writeFile(layout.openclawConfigPath, JSON.stringify(driftedConfig, null, 2), 'utf-8');

    const before = await checkManagedOpenClawDrift();
    expect(before.driftDetected).toBe(true);

    const applyResult = await applyManagedOpenClawConfig();
    expect(applyResult.driftDetected).toBe(true);
    expect(applyResult.changed).toBe(true);
    expect(applyResult.changedFields).toContain('agents.defaults.workspace');
    expect(applyResult.changedFields).toContain('memory.backend');
    expect(applyResult.changedFields).toContain('memory.qmd.paths');
    expect(applyResult.changedFields).toContain('plugins.entries.memory-lancedb');

    const after = await checkManagedOpenClawDrift();
    expect(after.driftDetected).toBe(false);
  });
});
