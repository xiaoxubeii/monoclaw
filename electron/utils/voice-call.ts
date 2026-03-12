import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';
import { getAssistantDataLayout } from './assistant-data-paths';

function resolveDefaultOpenClawConfigPath(): string {
  const explicitConfig = process.env.OPENCLAW_CONFIG_PATH?.trim();
  if (explicitConfig) return explicitConfig;

  const stateDir = process.env.OPENCLAW_STATE_DIR?.trim();
  if (stateDir) return join(stateDir, 'openclaw.json');

  return getAssistantDataLayout().openclawConfigPath;
}

const DEFAULT_OPENCLAW_CONFIG_PATH = resolveDefaultOpenClawConfigPath();
const PRIMARY_PLUGIN_KEY = 'voice-call';
const LEGACY_PLUGIN_KEY = 'voicecall';

type JsonObject = Record<string, unknown>;

export type VoiceCallProvider = 'mock' | 'twilio' | 'telnyx' | 'plivo';

export interface VoiceCallPluginConfig {
  provider: VoiceCallProvider | string;
  fromNumber?: string;
  toNumber?: string;
  outbound?: {
    defaultMode?: 'notify' | 'conversation';
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface VoiceCallPluginState {
  exists: boolean;
  enabled: boolean;
  pluginKey: typeof PRIMARY_PLUGIN_KEY | typeof LEGACY_PLUGIN_KEY;
  config: VoiceCallPluginConfig;
}

export interface VoiceCallPluginInput {
  enabled?: boolean;
  config?: Partial<VoiceCallPluginConfig>;
}

export interface VoiceCallConfigPathOptions {
  configPath?: string;
}

function isRecord(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function buildDefaultVoiceCallConfig(): VoiceCallPluginConfig {
  return {
    provider: 'mock',
    fromNumber: '+15550001234',
    toNumber: '+15550005678',
    outbound: {
      defaultMode: 'notify',
    },
  };
}

export function normalizeVoiceCallConfig(input?: Partial<VoiceCallPluginConfig>): VoiceCallPluginConfig {
  const base: JsonObject = isRecord(input) ? { ...input } : {};

  const providerRaw = typeof base.provider === 'string' ? base.provider.trim().toLowerCase() : '';
  if (!providerRaw || !['mock', 'twilio', 'telnyx', 'plivo'].includes(providerRaw)) {
    base.provider = 'mock';
  } else {
    base.provider = providerRaw;
  }

  if (typeof base.fromNumber === 'string') {
    const trimmed = base.fromNumber.trim();
    if (trimmed) {
      base.fromNumber = trimmed;
    } else {
      delete base.fromNumber;
    }
  }

  if (typeof base.toNumber === 'string') {
    const trimmed = base.toNumber.trim();
    if (trimmed) {
      base.toNumber = trimmed;
    } else {
      delete base.toNumber;
    }
  }

  const outbound = isRecord(base.outbound) ? { ...base.outbound } : {};
  const defaultModeRaw = typeof outbound.defaultMode === 'string' ? outbound.defaultMode.trim() : '';
  if (defaultModeRaw !== 'notify' && defaultModeRaw !== 'conversation') {
    outbound.defaultMode = 'notify';
  }
  base.outbound = outbound;

  return {
    ...buildDefaultVoiceCallConfig(),
    ...base,
    outbound: {
      ...buildDefaultVoiceCallConfig().outbound,
      ...(isRecord(base.outbound) ? base.outbound : {}),
    },
  } as VoiceCallPluginConfig;
}

export function extractVoiceCallId(result: unknown): string | null {
  if (!isRecord(result)) return null;

  const direct = typeof result.callId === 'string' ? result.callId : null;
  if (direct) return direct;

  const data = isRecord(result.data) ? result.data : null;
  if (data && typeof data.callId === 'string') {
    return data.callId;
  }

  const value = isRecord(result.result) ? result.result : null;
  if (value && typeof value.callId === 'string') {
    return value.callId;
  }

  return null;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function ensureConfigDir(configPath: string): Promise<void> {
  const parent = dirname(configPath);
  if (!(await fileExists(parent))) {
    await mkdir(parent, { recursive: true });
  }
}

async function readOpenClawConfig(configPath: string): Promise<JsonObject> {
  await ensureConfigDir(configPath);

  if (!(await fileExists(configPath))) {
    return {};
  }

  try {
    const content = await readFile(configPath, 'utf-8');
    const parsed = JSON.parse(content) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function writeOpenClawConfig(configPath: string, config: JsonObject): Promise<void> {
  await ensureConfigDir(configPath);
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

function readVoiceCallEntry(config: JsonObject): {
  exists: boolean;
  pluginKey: typeof PRIMARY_PLUGIN_KEY | typeof LEGACY_PLUGIN_KEY;
  enabled: boolean;
  config: VoiceCallPluginConfig;
} {
  const plugins = isRecord(config.plugins) ? config.plugins : {};
  const entries = isRecord(plugins.entries) ? plugins.entries : {};

  const directEntry = isRecord(entries[PRIMARY_PLUGIN_KEY]) ? entries[PRIMARY_PLUGIN_KEY] : null;
  const legacyEntry = isRecord(entries[LEGACY_PLUGIN_KEY]) ? entries[LEGACY_PLUGIN_KEY] : null;

  const chosen = directEntry ?? legacyEntry;
  if (!chosen) {
    return {
      exists: false,
      pluginKey: PRIMARY_PLUGIN_KEY,
      enabled: false,
      config: buildDefaultVoiceCallConfig(),
    };
  }

  const pluginKey = directEntry ? PRIMARY_PLUGIN_KEY : LEGACY_PLUGIN_KEY;
  const enabled = chosen.enabled !== false;
  const cfgRaw = isRecord(chosen.config) ? chosen.config : {};

  return {
    exists: true,
    pluginKey,
    enabled,
    config: normalizeVoiceCallConfig(cfgRaw as Partial<VoiceCallPluginConfig>),
  };
}

export async function getVoiceCallPluginState(
  options: VoiceCallConfigPathOptions = {},
): Promise<VoiceCallPluginState> {
  const configPath = options.configPath || DEFAULT_OPENCLAW_CONFIG_PATH;
  const config = await readOpenClawConfig(configPath);
  return readVoiceCallEntry(config);
}

export async function saveVoiceCallPluginConfig(
  input: VoiceCallPluginInput,
  options: VoiceCallConfigPathOptions = {},
): Promise<VoiceCallPluginState> {
  const configPath = options.configPath || DEFAULT_OPENCLAW_CONFIG_PATH;
  const openclawConfig = await readOpenClawConfig(configPath);

  if (!isRecord(openclawConfig.plugins)) {
    openclawConfig.plugins = {};
  }

  const plugins = openclawConfig.plugins as JsonObject;
  if (!isRecord(plugins.entries)) {
    plugins.entries = {};
  }

  const entries = plugins.entries as JsonObject;
  const existingState = readVoiceCallEntry(openclawConfig);
  const existingEntry = existingState.pluginKey === LEGACY_PLUGIN_KEY
    ? (isRecord(entries[LEGACY_PLUGIN_KEY]) ? entries[LEGACY_PLUGIN_KEY] : {})
    : (isRecord(entries[PRIMARY_PLUGIN_KEY]) ? entries[PRIMARY_PLUGIN_KEY] : {});
  const existingConfig = isRecord(existingState.config) ? existingState.config : {};

  const merged = {
    ...existingConfig,
    ...(isRecord(input.config) ? input.config : {}),
  } as Partial<VoiceCallPluginConfig>;

  entries[PRIMARY_PLUGIN_KEY] = {
    ...existingEntry,
    enabled: input.enabled ?? existingState.enabled,
    config: normalizeVoiceCallConfig(merged),
  };

  if (entries[LEGACY_PLUGIN_KEY]) {
    delete entries[LEGACY_PLUGIN_KEY];
  }

  await writeOpenClawConfig(configPath, openclawConfig);

  return getVoiceCallPluginState(options);
}
