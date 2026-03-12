import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  extractVoiceCallId,
  getVoiceCallPluginState,
  normalizeVoiceCallConfig,
  saveVoiceCallPluginConfig,
} from '@electron/utils/voice-call';

let tempDir = '';
let configPath = '';

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'monoclaw-voicecall-'));
  configPath = join(tempDir, '.openclaw', 'openclaw.json');
});

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

describe('voice-call plugin config helpers', () => {
  it('normalizes invalid input to mock defaults', () => {
    const normalized = normalizeVoiceCallConfig({
      provider: '  UnknownProvider  ',
      fromNumber: '   ',
      toNumber: '  +8613800138000  ',
      outbound: {
        defaultMode: 'invalid-mode',
      },
    });

    expect(normalized.provider).toBe('mock');
    expect(normalized.fromNumber).toBe('+15550001234');
    expect(normalized.toNumber).toBe('+8613800138000');
    expect(normalized.outbound?.defaultMode).toBe('notify');
  });

  it('saves and reads config under plugins.entries.voice-call', async () => {
    const saved = await saveVoiceCallPluginConfig(
      {
        enabled: true,
        config: {
          provider: 'mock',
          fromNumber: '+15551112222',
          toNumber: '+15553334444',
          outbound: {
            defaultMode: 'conversation',
          },
        },
      },
      { configPath },
    );

    expect(saved.exists).toBe(true);
    expect(saved.pluginKey).toBe('voice-call');
    expect(saved.enabled).toBe(true);
    expect(saved.config.provider).toBe('mock');
    expect(saved.config.outbound?.defaultMode).toBe('conversation');

    const raw = JSON.parse(await readFile(configPath, 'utf-8')) as {
      plugins?: {
        entries?: Record<string, unknown>;
      };
    };
    expect(raw.plugins?.entries?.['voice-call']).toBeDefined();

    const loaded = await getVoiceCallPluginState({ configPath });
    expect(loaded.exists).toBe(true);
    expect(loaded.pluginKey).toBe('voice-call');
    expect(loaded.config.fromNumber).toBe('+15551112222');
    expect(loaded.config.toNumber).toBe('+15553334444');
  });

  it('reads legacy voicecall key and migrates to voice-call on save', async () => {
    await mkdir(join(tempDir, '.openclaw'), { recursive: true });
    await writeFile(
      configPath,
      JSON.stringify(
        {
          plugins: {
            entries: {
              voicecall: {
                enabled: false,
                config: {
                  provider: 'telnyx',
                  fromNumber: '+8613800138000',
                  toNumber: '+8613911139111',
                  outbound: {
                    defaultMode: 'conversation',
                  },
                },
              },
            },
          },
        },
        null,
        2,
      ),
      'utf-8',
    );

    const legacy = await getVoiceCallPluginState({ configPath });
    expect(legacy.exists).toBe(true);
    expect(legacy.pluginKey).toBe('voicecall');
    expect(legacy.enabled).toBe(false);
    expect(legacy.config.provider).toBe('telnyx');

    const migrated = await saveVoiceCallPluginConfig(
      {
        enabled: true,
        config: {
          provider: 'mock',
        },
      },
      { configPath },
    );

    expect(migrated.pluginKey).toBe('voice-call');
    expect(migrated.enabled).toBe(true);
    expect(migrated.config.provider).toBe('mock');
    expect(migrated.config.fromNumber).toBe('+8613800138000');

    const raw = JSON.parse(await readFile(configPath, 'utf-8')) as {
      plugins?: {
        entries?: Record<string, unknown>;
      };
    };
    expect(raw.plugins?.entries?.['voice-call']).toBeDefined();
    expect(raw.plugins?.entries?.voicecall).toBeUndefined();
  });

  it('extracts callId from known response shapes', () => {
    expect(extractVoiceCallId({ callId: 'direct-1' })).toBe('direct-1');
    expect(extractVoiceCallId({ data: { callId: 'data-1' } })).toBe('data-1');
    expect(extractVoiceCallId({ result: { callId: 'result-1' } })).toBe('result-1');
    expect(extractVoiceCallId({})).toBeNull();
    expect(extractVoiceCallId(null)).toBeNull();
  });
});
