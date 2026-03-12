import { afterEach, describe, expect, it } from 'vitest';
import {
  LocalModelManager,
  type LocalModelRuntimeStatus,
} from '@electron/utils/local-model-manager';

function buildStatus(partial?: Partial<LocalModelRuntimeStatus>): LocalModelRuntimeStatus {
  return {
    runtimeInstalled: partial?.runtimeInstalled ?? true,
    runtimeVersion: partial?.runtimeVersion ?? '0.17.7',
    serviceRunning: partial?.serviceRunning ?? true,
    installedModels: partial?.installedModels ?? ['qwen2.5:3b'],
    ollamaBinaryPath: partial?.ollamaBinaryPath ?? '/usr/bin/ollama',
    presets: partial?.presets ?? [],
  };
}

class FakeLocalModelManager extends LocalModelManager {
  private readonly snapshots: LocalModelRuntimeStatus[];

  private cursor = 0;

  ensureCalls = 0;

  constructor(snapshots: LocalModelRuntimeStatus[]) {
    super();
    this.snapshots = snapshots;
  }

  override async getStatus(): Promise<LocalModelRuntimeStatus> {
    const index = Math.min(this.cursor, this.snapshots.length - 1);
    const snapshot = this.snapshots[index];
    this.cursor += 1;
    return JSON.parse(JSON.stringify(snapshot)) as LocalModelRuntimeStatus;
  }

  override async ensureServiceRunning(): Promise<void> {
    this.ensureCalls += 1;
  }
}

const originalEnv = {
  HOME: process.env.HOME,
  PATH: process.env.PATH,
  CONDA_PREFIX: process.env.CONDA_PREFIX,
  MAMBA_ROOT_PREFIX: process.env.MAMBA_ROOT_PREFIX,
};

afterEach(() => {
  process.env.HOME = originalEnv.HOME;
  process.env.PATH = originalEnv.PATH;
  process.env.CONDA_PREFIX = originalEnv.CONDA_PREFIX;
  process.env.MAMBA_ROOT_PREFIX = originalEnv.MAMBA_ROOT_PREFIX;
});

describe('local-model-manager', () => {
  it('starts Ollama before chat readiness validation when service is down', async () => {
    const manager = new FakeLocalModelManager([
      buildStatus({ serviceRunning: false, installedModels: [] }),
      buildStatus({ serviceRunning: true, installedModels: ['qwen2.5:3b'] }),
    ]);

    await expect(manager.ensureChatModelReady('qwen2.5:3b')).resolves.toBeUndefined();
    expect(manager.ensureCalls).toBe(1);
  });

  it('fails fast when the configured Ollama model is not installed', async () => {
    const manager = new FakeLocalModelManager([
      buildStatus({ serviceRunning: true, installedModels: ['qwen2.5:3b'] }),
    ]);

    await expect(manager.ensureChatModelReady('qwen2.5:7b')).rejects.toThrow(
      'Ollama model "qwen2.5:7b" is not installed. Installed models: qwen2.5:3b'
    );
    expect(manager.ensureCalls).toBe(0);
  });

  it('searches common conda and PATH locations for the Ollama binary', () => {
    process.env.HOME = '/home/tester';
    process.env.PATH = '/custom/bin:/another/bin';
    process.env.CONDA_PREFIX = '/opt/conda';
    process.env.MAMBA_ROOT_PREFIX = '/opt/mamba';

    const manager = new LocalModelManager();
    const candidates = (manager as any).getKnownBinaryCandidates() as string[];

    expect(candidates).toContain('/custom/bin/ollama');
    expect(candidates).toContain('/opt/conda/bin/ollama');
    expect(candidates).toContain('/opt/mamba/bin/ollama');
    expect(candidates).toContain('/home/tester/miniforge3/bin/ollama');
    expect(candidates).toContain('/home/tester/anaconda3/bin/ollama');
  });
});
