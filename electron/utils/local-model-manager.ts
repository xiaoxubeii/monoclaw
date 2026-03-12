import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { logger } from './logger';

const OLLAMA_HOST = '127.0.0.1:11434';
const OLLAMA_LOCAL_API = `http://${OLLAMA_HOST}`;
const DEFAULT_OLLAMA_READY_TIMEOUT_MS = 90_000;
const DEFAULT_OLLAMA_READY_POLL_INTERVAL_MS = 1000;
const DEFAULT_OLLAMA_PROBE_TIMEOUT_MS = 3000;

export type LocalModelPresetId = 'speed' | 'balanced' | 'quality';

export interface LocalModelPreset {
  id: LocalModelPresetId;
  model: string;
  minRamGb: number;
  recommendedRamGb: number;
}

export interface LocalModelPullProgress {
  phase: 'install' | 'service' | 'pull';
  message: string;
  model?: string;
  presetId?: LocalModelPresetId;
  ts: number;
}

export interface LocalModelRuntimeStatus {
  runtimeInstalled: boolean;
  runtimeVersion: string | null;
  serviceRunning: boolean;
  installedModels: string[];
  ollamaBinaryPath: string | null;
  presets: LocalModelPreset[];
}

interface CommandResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

interface InstallCommand {
  label: string;
  command: string;
}

export const LOCAL_MODEL_PRESETS: LocalModelPreset[] = [
  { id: 'speed', model: 'qwen2.5:0.5b', minRamGb: 4, recommendedRamGb: 8 },
  { id: 'balanced', model: 'qwen2.5:3b', minRamGb: 8, recommendedRamGb: 16 },
  { id: 'quality', model: 'qwen2.5:7b', minRamGb: 12, recommendedRamGb: 24 },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function splitProgressLines(chunk: string): string[] {
  return chunk
    .split(/[\r\n]+/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function resolvePositiveInt(input: string | undefined, fallback: number): number {
  if (!input) return fallback;
  const parsed = Number.parseInt(input, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export class LocalModelManager extends EventEmitter {
  private cachedBinaryPath: string | null = null;

  listPresets(): LocalModelPreset[] {
    return LOCAL_MODEL_PRESETS.map((preset) => ({ ...preset }));
  }

  resolvePreset(presetId: string): LocalModelPreset {
    const preset = LOCAL_MODEL_PRESETS.find((candidate) => candidate.id === presetId);
    if (!preset) {
      throw new Error(`Unsupported local model preset: ${presetId}`);
    }
    return preset;
  }

  findPresetByModel(model: string | null | undefined): LocalModelPreset | undefined {
    if (!model) return undefined;
    const normalized = model.trim();
    if (!normalized) return undefined;
    return LOCAL_MODEL_PRESETS.find((preset) => preset.model === normalized);
  }

  async getStatus(): Promise<LocalModelRuntimeStatus> {
    const binary = await this.findOllamaBinary();
    const runtimeInstalled = !!binary;
    const runtimeVersion = runtimeInstalled ? await this.getRuntimeVersion(binary) : null;
    const serviceRunning = runtimeInstalled ? await this.isServiceRunning() : false;
    const installedModels = runtimeInstalled && serviceRunning
      ? await this.listInstalledModels(binary)
      : [];

    return {
      runtimeInstalled,
      runtimeVersion,
      serviceRunning,
      installedModels,
      ollamaBinaryPath: binary,
      presets: this.listPresets(),
    };
  }

  async installRuntime(): Promise<{ success: boolean; output: string }> {
    if (await this.findOllamaBinary()) {
      return { success: true, output: 'Ollama is already installed.' };
    }

    const commands = this.getInstallCommands();
    if (commands.length === 0) {
      return {
        success: false,
        output: `Unsupported platform for one-click Ollama install: ${process.platform}`,
      };
    }

    let combinedOutput = '';
    for (const entry of commands) {
      this.emitProgress({
        phase: 'install',
        message: `Running installer via ${entry.label}...`,
      });

      const result = await this.runShell(entry.command, 20 * 60_000);
      const commandOutput = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
      combinedOutput = `${combinedOutput}\n# ${entry.label}\n${commandOutput}`.trim();

      if (result.code === 0) {
        this.cachedBinaryPath = null;
        if (await this.findOllamaBinary()) {
          this.emitProgress({
            phase: 'install',
            message: 'Ollama runtime installation completed.',
          });
          return { success: true, output: combinedOutput || 'Installed successfully.' };
        }
      }
    }

    return {
      success: false,
      output: combinedOutput || 'Failed to install Ollama runtime.',
    };
  }

  async ensureRuntimeInstalled(): Promise<void> {
    const binary = await this.findOllamaBinary();
    if (binary) return;

    const installResult = await this.installRuntime();
    if (!installResult.success) {
      throw new Error(
        `Unable to install Ollama runtime automatically.\n${installResult.output}`
      );
    }
  }

  async ensureServiceRunning(): Promise<void> {
    if (await this.isServiceRunning()) return;

    const binary = await this.requireOllamaBinary();
    const readyTimeoutMs = resolvePositiveInt(
      process.env.MONOCLAW_OLLAMA_READY_TIMEOUT_MS,
      DEFAULT_OLLAMA_READY_TIMEOUT_MS
    );
    const pollIntervalMs = resolvePositiveInt(
      process.env.MONOCLAW_OLLAMA_POLL_INTERVAL_MS,
      DEFAULT_OLLAMA_READY_POLL_INTERVAL_MS
    );
    this.emitProgress({
      phase: 'service',
      message: `Starting Ollama service (timeout ${Math.ceil(readyTimeoutMs / 1000)}s)...`,
    });

    let spawnError: unknown = null;
    let exitedBeforeReady = false;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;

    try {
      const child = spawn(binary, ['serve'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: {
          ...process.env,
          OLLAMA_HOST,
        },
      });
      child.once('error', (error) => {
        spawnError = error;
      });
      child.once('exit', (code, signal) => {
        exitedBeforeReady = true;
        exitCode = code;
        exitSignal = signal;
      });
      child.unref();
    } catch (error) {
      throw new Error(`Failed to spawn Ollama service: ${String(error)}`);
    }

    const start = Date.now();
    while ((Date.now() - start) < readyTimeoutMs) {
      if (spawnError) {
        throw new Error(`Failed to spawn Ollama service: ${String(spawnError)}`);
      }
      if (exitedBeforeReady) {
        throw new Error(
          `Ollama service exited before ready (code=${String(exitCode)}, signal=${String(exitSignal)}).`
        );
      }
      if (await this.isServiceRunning()) {
        this.emitProgress({
          phase: 'service',
          message: 'Ollama service is ready.',
        });
        return;
      }
      await sleep(pollIntervalMs);
    }

    throw new Error(
      `Ollama service did not become ready within ${Math.ceil(readyTimeoutMs / 1000)}s.`
    );
  }

  async pullPreset(presetId: LocalModelPresetId): Promise<{ preset: LocalModelPreset; output: string }> {
    const preset = this.resolvePreset(presetId);
    const output = await this.pullModel(preset.model, preset.id);
    return { preset, output };
  }

  async pullModel(model: string, presetId?: LocalModelPresetId): Promise<string> {
    const normalizedModel = model.trim();
    if (!normalizedModel) {
      throw new Error('Model ID is required for pull.');
    }

    await this.ensureRuntimeInstalled();
    await this.ensureServiceRunning();

    const binary = await this.requireOllamaBinary();
    this.emitProgress({
      phase: 'pull',
      model: normalizedModel,
      presetId,
      message: `Pulling model ${normalizedModel}...`,
    });

    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(binary, ['pull', normalizedModel], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      });

      let stdout = '';
      let stderr = '';

      const onChunk = (chunk: Buffer) => {
        const text = chunk.toString();
        for (const line of splitProgressLines(text)) {
          this.emitProgress({
            phase: 'pull',
            model: normalizedModel,
            presetId,
            message: line,
          });
        }
      };

      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        onChunk(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        onChunk(chunk);
      });

      child.once('error', (error) => {
        reject(new Error(`ollama pull failed: ${String(error)}`));
      });

      child.once('close', (code) => {
        const merged = [stdout, stderr].filter(Boolean).join('\n').trim();
        if (code === 0) {
          this.emitProgress({
            phase: 'pull',
            model: normalizedModel,
            presetId,
            message: `Model ${normalizedModel} is ready.`,
          });
          resolve(merged);
          return;
        }
        reject(
          new Error(
            `ollama pull exited with code=${String(code)}${merged ? `\n${merged}` : ''}`
          )
        );
      });
    });

    return output;
  }

  async ensureChatModelReady(model: string | null | undefined): Promise<void> {
    const normalizedModel = model?.trim() || '';
    const initialStatus = await this.getStatus();

    if (!initialStatus.runtimeInstalled) {
      throw new Error('Ollama runtime is not installed or its binary could not be found.');
    }

    if (!initialStatus.serviceRunning) {
      await this.ensureServiceRunning();
    }

    const readyStatus = initialStatus.serviceRunning ? initialStatus : await this.getStatus();
    if (!readyStatus.serviceRunning) {
      throw new Error('Ollama service is unavailable.');
    }

    if (!normalizedModel) {
      return;
    }

    if (readyStatus.installedModels.includes(normalizedModel)) {
      return;
    }

    const installedSummary = readyStatus.installedModels.length > 0
      ? readyStatus.installedModels.join(', ')
      : '(none)';
    throw new Error(
      `Ollama model "${normalizedModel}" is not installed. Installed models: ${installedSummary}`
    );
  }

  private emitProgress(progress: Omit<LocalModelPullProgress, 'ts'>): void {
    const payload: LocalModelPullProgress = {
      ...progress,
      ts: Date.now(),
    };
    logger.info(`[LocalModel:${payload.phase}] ${payload.message}`);
    this.emit('pull-progress', payload);
  }

  private async listInstalledModels(binary: string): Promise<string[]> {
    try {
      const result = await this.runCommand(binary, ['list'], 10_000);
      if (result.code !== 0) return [];

      const lines = result.stdout
        .split(/\r?\n/g)
        .map((line) => line.trim())
        .filter(Boolean);

      if (lines.length <= 1) return [];

      return lines
        .slice(1)
        .map((line) => line.split(/\s+/)[0])
        .filter((name) => !!name && name !== 'NAME');
    } catch {
      return [];
    }
  }

  private async getRuntimeVersion(binary: string): Promise<string | null> {
    try {
      const result = await this.runCommand(binary, ['--version'], 8000);
      const output = `${result.stdout}\n${result.stderr}`.trim();
      if (!output) return null;
      return output.split(/\r?\n/g)[0]?.trim() || null;
    } catch {
      return null;
    }
  }

  private async requireOllamaBinary(): Promise<string> {
    const binary = await this.findOllamaBinary();
    if (!binary) {
      throw new Error('Ollama runtime is not installed.');
    }
    return binary;
  }

  private async findOllamaBinary(): Promise<string | null> {
    if (this.cachedBinaryPath && await this.canExecute(this.cachedBinaryPath)) {
      return this.cachedBinaryPath;
    }

    if (await this.canExecute('ollama')) {
      this.cachedBinaryPath = 'ollama';
      return this.cachedBinaryPath;
    }

    for (const candidate of this.getKnownBinaryCandidates()) {
      if (await this.canExecute(candidate)) {
        this.cachedBinaryPath = candidate;
        return this.cachedBinaryPath;
      }
    }

    this.cachedBinaryPath = null;
    return null;
  }

  private getKnownBinaryCandidates(): string[] {
    const candidates = new Set<string>();

    if (process.platform === 'win32') {
      const localAppData = process.env.LOCALAPPDATA || '';
      const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
      const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
      if (localAppData) {
        candidates.add(join(localAppData, 'Programs', 'Ollama', 'ollama.exe'));
      }
      candidates.add(join(programFiles, 'Ollama', 'ollama.exe'));
      candidates.add(join(programFilesX86, 'Ollama', 'ollama.exe'));
    } else {
      const pathEntries = (process.env.PATH || '')
        .split(':')
        .map((entry) => entry.trim())
        .filter(Boolean);
      for (const entry of pathEntries) {
        candidates.add(join(entry, 'ollama'));
      }

      const condaPrefix = process.env.CONDA_PREFIX?.trim();
      if (condaPrefix) {
        candidates.add(join(condaPrefix, 'bin', 'ollama'));
      }
      const mambaRoot = process.env.MAMBA_ROOT_PREFIX?.trim();
      if (mambaRoot) {
        candidates.add(join(mambaRoot, 'bin', 'ollama'));
      }

      candidates.add('/usr/local/bin/ollama');
      candidates.add('/opt/homebrew/bin/ollama');
      candidates.add('/usr/bin/ollama');
      candidates.add(join(homedir(), '.ollama', 'bin', 'ollama'));
      candidates.add(join(homedir(), 'miniforge3', 'bin', 'ollama'));
      candidates.add(join(homedir(), 'mambaforge', 'bin', 'ollama'));
      candidates.add(join(homedir(), 'miniconda3', 'bin', 'ollama'));
      candidates.add(join(homedir(), 'anaconda3', 'bin', 'ollama'));
      candidates.add(join(homedir(), 'bin', 'ollama'));
    }

    return Array.from(candidates);
  }

  private async canExecute(binary: string): Promise<boolean> {
    if (!binary) return false;

    if (binary.includes('/') || binary.includes('\\')) {
      try {
        await access(binary, constants.F_OK);
      } catch {
        return false;
      }
    }

    try {
      const result = await this.runCommand(binary, ['--version'], 8000);
      return result.code === 0;
    } catch {
      return false;
    }
  }

  private async isServiceRunning(): Promise<boolean> {
    const probeTimeoutMs = resolvePositiveInt(
      process.env.MONOCLAW_OLLAMA_PROBE_TIMEOUT_MS,
      DEFAULT_OLLAMA_PROBE_TIMEOUT_MS
    );
    if (await this.pingEndpoint('/api/version', probeTimeoutMs)) {
      return true;
    }
    return await this.pingEndpoint('/api/tags', probeTimeoutMs);
  }

  private async pingEndpoint(path: string, timeoutMs: number): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    timeout.unref();

    try {
      const response = await fetch(`${OLLAMA_LOCAL_API}${path}`, {
        method: 'GET',
        signal: controller.signal,
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  private getInstallCommands(): InstallCommand[] {
    if (process.platform === 'win32') {
      return [
        {
          label: 'winget',
          command: 'winget install --id Ollama.Ollama -e --accept-package-agreements --accept-source-agreements',
        },
      ];
    }

    if (process.platform === 'darwin') {
      return [
        {
          label: 'homebrew',
          command: 'brew install --cask ollama',
        },
        {
          label: 'official-script',
          command: 'curl -fsSL https://ollama.com/install.sh | sh',
        },
      ];
    }

    if (process.platform === 'linux') {
      return [
        {
          label: 'official-script',
          command: 'curl -fsSL https://ollama.com/install.sh | sh',
        },
      ];
    }

    return [];
  }

  private async runShell(command: string, timeoutMs: number): Promise<CommandResult> {
    if (process.platform === 'win32') {
      return this.runCommand(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
        timeoutMs
      );
    }
    return this.runCommand('/bin/sh', ['-lc', command], timeoutMs);
  }

  private async runCommand(
    command: string,
    args: string[],
    timeoutMs: number
  ): Promise<CommandResult> {
    return await new Promise<CommandResult>((resolve, reject) => {
      const child = spawn(command, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 1200).unref();
      }, timeoutMs);
      timeout.unref();

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      child.once('close', (code, signal) => {
        clearTimeout(timeout);
        resolve({
          code,
          signal,
          stdout,
          stderr,
          timedOut,
        });
      });
    });
  }
}
