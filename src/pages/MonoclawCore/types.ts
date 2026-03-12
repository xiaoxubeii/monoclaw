export interface AssistantDataLayout {
  root: string;
  controlRoot: string;
  runtimeConfigPath: string;
  enginesRootDir: string;
  openclawEngineRootDir: string;
  openclawEngineConfigPath: string;
  openclawEngineStateDir?: string;
  openclawEngineLogsDir: string;
  openclawStateDir: string;
  openclawConfigPath?: string;
  monoclawUserDataDir?: string;
  monoclawConfigDir?: string;
  vaultDir: string;
  memoryRootDir: string;
  knowledgeBaseDir?: string;
  habitsPrefsDir?: string;
  userCorrectionsDir?: string;
  interactionHistoryDir?: string;
  vectorStoreRootDir?: string;
  workspaceRootDir: string;
  workspaceDir?: string;
  activeSessionsDir?: string;
  inboxOutboxDir?: string;
  screenshotsDir?: string;
  taskLogsDir?: string;
  clipboardDir?: string;
  actionAssetsRootDir?: string;
  uiAnchorsDir?: string;
  workflowsDir?: string;
  appBlueprintsDir?: string;
  vectorStoreLanceDbDir: string;
}

export interface AssistantDataHealth {
  root: string;
  writable: boolean;
  missingDirs: string[];
}

export interface ManagedOpenClawDrift {
  driftDetected: boolean;
}

export interface AssistantDataStatusPayload {
  layout: AssistantDataLayout;
  health: AssistantDataHealth;
  drift: ManagedOpenClawDrift;
}

export interface AssistantDataStatusResponse {
  success: boolean;
  data?: AssistantDataStatusPayload;
  error?: string;
}
