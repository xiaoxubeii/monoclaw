export interface OpenClawStatusInfo {
  packageExists: boolean;
  isBuilt: boolean;
  entryPath: string;
  dir: string;
  version?: string;
}

export interface OpenClawDoctorResult {
  success: boolean;
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  output: string;
  durationMs: number;
  command: string;
  timedOut?: boolean;
}

export interface VoiceCallPluginState {
  exists: boolean;
  enabled: boolean;
  pluginKey: 'voice-call' | 'voicecall';
  config: {
    provider?: string;
    fromNumber?: string;
    toNumber?: string;
    outbound?: {
      defaultMode?: string;
    };
  };
}

export type VoiceCallDefaultMode = 'notify' | 'conversation';
