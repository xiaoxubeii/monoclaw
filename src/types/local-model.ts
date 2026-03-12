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

export interface LocalModelStatus {
  runtimeInstalled: boolean;
  runtimeVersion: string | null;
  serviceRunning: boolean;
  installedModels: string[];
  ollamaBinaryPath: string | null;
  presets: LocalModelPreset[];
  defaultProviderId: string | null;
  defaultProviderType: string | null;
  defaultModel: string | null;
  defaultPresetId: LocalModelPresetId | null;
}

export interface LocalModelEnableResult {
  presetId: LocalModelPresetId;
  model: string;
  providerId: string;
  gatewayState: string;
  status: LocalModelStatus;
}

export interface LocalModelOperationResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  output?: string;
}
