/**
 * Settings Page
 * Application configuration
 */
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  controlHeroAuraClass,
  controlHeroCardClass,
  controlPanelClass,
} from '@/pages/control/styles';
import { SUPPORTED_LANGUAGES } from '@/i18n';
import { useGatewayStore } from '@/stores/gateway';
import { useSettingsStore } from '@/stores/settings';
import { useUpdateStore } from '@/stores/update';
import type {
  LocalModelEnableResult,
  LocalModelOperationResult,
  LocalModelPresetId,
  LocalModelPullProgress,
  LocalModelStatus,
} from '@/types/local-model';
import {
  AboutCard,
  AdvancedSettingsCard,
  AiProvidersCard,
  AppearanceSettingsCard,
  DeveloperSettingsCard,
  GatewaySettingsCard,
  LocalModelSettingsCard,
  UpdatesSettingsCard,
} from './sections';

type ControlUiInfo = {
  url: string;
  token: string;
  port: number;
};

const LOCAL_MODEL_PRESET_FALLBACK: Array<{
  id: LocalModelPresetId;
  model: string;
  minRamGb: number;
  recommendedRamGb: number;
}> = [
  { id: 'speed', model: 'qwen2.5:0.5b', minRamGb: 4, recommendedRamGb: 8 },
  { id: 'balanced', model: 'qwen2.5:3b', minRamGb: 8, recommendedRamGb: 16 },
  { id: 'quality', model: 'qwen2.5:7b', minRamGb: 12, recommendedRamGb: 24 },
];

export function Settings() {
  const { t } = useTranslation('settings');
  const {
    theme,
    setTheme,
    language,
    setLanguage,
    gatewayAutoStart,
    setGatewayAutoStart,
    proxyEnabled,
    proxyServer,
    proxyHttpServer,
    proxyHttpsServer,
    proxyAllServer,
    proxyBypassRules,
    setProxyEnabled,
    setProxyServer,
    setProxyHttpServer,
    setProxyHttpsServer,
    setProxyAllServer,
    setProxyBypassRules,
    autoCheckUpdate,
    setAutoCheckUpdate,
    autoDownloadUpdate,
    setAutoDownloadUpdate,
    devModeUnlocked,
    setDevModeUnlocked,
  } = useSettingsStore();

  const { status: gatewayStatus, restart: restartGateway } = useGatewayStore();
  const currentVersion = useUpdateStore((state) => state.currentVersion);
  const updateSetAutoDownload = useUpdateStore((state) => state.setAutoDownload);
  const [controlUiInfo, setControlUiInfo] = useState<ControlUiInfo | null>(null);
  const [openclawCliCommand, setOpenclawCliCommand] = useState('');
  const [openclawCliError, setOpenclawCliError] = useState<string | null>(null);
  const [proxyServerDraft, setProxyServerDraft] = useState('');
  const [proxyHttpServerDraft, setProxyHttpServerDraft] = useState('');
  const [proxyHttpsServerDraft, setProxyHttpsServerDraft] = useState('');
  const [proxyAllServerDraft, setProxyAllServerDraft] = useState('');
  const [proxyBypassRulesDraft, setProxyBypassRulesDraft] = useState('');
  const [proxyEnabledDraft, setProxyEnabledDraft] = useState(false);
  const [savingProxy, setSavingProxy] = useState(false);
  const [localModelStatus, setLocalModelStatus] = useState<LocalModelStatus | null>(null);
  const [loadingLocalModelStatus, setLoadingLocalModelStatus] = useState(false);
  const [localModelAction, setLocalModelAction] = useState<'idle' | 'install' | 'enable:speed' | 'enable:balanced' | 'enable:quality'>('idle');
  const [localModelLogs, setLocalModelLogs] = useState<string[]>([]);

  const toEnableAction = (presetId: LocalModelPresetId): 'enable:speed' | 'enable:balanced' | 'enable:quality' => {
    switch (presetId) {
      case 'speed':
        return 'enable:speed';
      case 'balanced':
        return 'enable:balanced';
      case 'quality':
      default:
        return 'enable:quality';
    }
  };

  const isWindows = window.electron.platform === 'win32';
  const showCliTools = true;
  const [showLogs, setShowLogs] = useState(false);
  const [logContent, setLogContent] = useState('');

  const handleShowLogs = async () => {
    try {
      const logs = await window.electron.ipcRenderer.invoke('log:readFile', 100) as string;
      setLogContent(logs);
      setShowLogs(true);
    } catch {
      setLogContent('(Failed to load logs)');
      setShowLogs(true);
    }
  };

  const handleOpenLogDir = async () => {
    try {
      const logDir = await window.electron.ipcRenderer.invoke('log:getDir') as string;
      if (logDir) {
        await window.electron.ipcRenderer.invoke('shell:showItemInFolder', logDir);
      }
    } catch {
      // ignore
    }
  };

  const appendLocalModelLog = (line: string) => {
    setLocalModelLogs((prev) => {
      const next = [...prev, line];
      return next.slice(-240);
    });
  };

  const refreshLocalModelStatus = async () => {
    setLoadingLocalModelStatus(true);
    try {
      const result = await window.electron.ipcRenderer.invoke('localModel:status') as LocalModelOperationResult<LocalModelStatus>;
      if (result.success && result.data) {
        setLocalModelStatus(result.data);
      } else {
        throw new Error(result.error || 'Failed to load local model status');
      }
    } catch (error) {
      toast.error(`${t('localModel.toast.statusFailed')}: ${String(error)}`);
    } finally {
      setLoadingLocalModelStatus(false);
    }
  };

  const handleInstallLocalModelRuntime = async () => {
    setLocalModelAction('install');
    setLocalModelLogs([]);
    try {
      const result = await window.electron.ipcRenderer.invoke('localModel:installRuntime') as LocalModelOperationResult<LocalModelStatus>;
      if (result.output) {
        appendLocalModelLog(result.output);
      }
      if (result.success) {
        if (result.data) {
          setLocalModelStatus(result.data);
        } else {
          await refreshLocalModelStatus();
        }
        toast.success(t('localModel.toast.installSuccess'));
      } else {
        throw new Error(result.error || t('localModel.toast.installFailed'));
      }
    } catch (error) {
      toast.error(`${t('localModel.toast.installFailed')}: ${String(error)}`);
    } finally {
      setLocalModelAction('idle');
    }
  };

  const handleEnableLocalModelPreset = async (presetId: LocalModelPresetId) => {
    setLocalModelAction(toEnableAction(presetId));
    setLocalModelLogs([]);
    try {
      const result = await window.electron.ipcRenderer.invoke('localModel:enablePreset', { presetId }) as LocalModelOperationResult<LocalModelEnableResult>;

      if (result.output) {
        appendLocalModelLog(result.output);
      }

      if (!result.success || !result.data) {
        throw new Error(result.error || t('localModel.toast.enableFailed'));
      }

      setLocalModelStatus(result.data.status);
      toast.success(t('localModel.toast.enableSuccess', { model: result.data.model }));
    } catch (error) {
      toast.error(`${t('localModel.toast.enableFailed')}: ${String(error)}`);
    } finally {
      setLocalModelAction('idle');
    }
  };

  const openDevConsole = async () => {
    try {
      const result = await window.electron.ipcRenderer.invoke('gateway:getControlUiUrl') as {
        success: boolean;
        url?: string;
        token?: string;
        port?: number;
        error?: string;
      };
      if (result.success && result.url && result.token && typeof result.port === 'number') {
        setControlUiInfo({ url: result.url, token: result.token, port: result.port });
        window.electron.openExternal(result.url);
      } else {
        console.error('Failed to get Dev Console URL:', result.error);
      }
    } catch (err) {
      console.error('Error opening Dev Console:', err);
    }
  };

  const refreshControlUiInfo = async () => {
    try {
      const result = await window.electron.ipcRenderer.invoke('gateway:getControlUiUrl') as {
        success: boolean;
        url?: string;
        token?: string;
        port?: number;
      };
      if (result.success && result.url && result.token && typeof result.port === 'number') {
        setControlUiInfo({ url: result.url, token: result.token, port: result.port });
      }
    } catch {
      // Ignore refresh errors
    }
  };

  const handleCopyGatewayToken = async () => {
    if (!controlUiInfo?.token) return;
    try {
      await navigator.clipboard.writeText(controlUiInfo.token);
      toast.success(t('developer.tokenCopied'));
    } catch (error) {
      toast.error(`Failed to copy token: ${String(error)}`);
    }
  };

  useEffect(() => {
    void refreshLocalModelStatus();
  }, []);

  useEffect(() => {
    const unsubscribe = window.electron.ipcRenderer.on('localModel:pullProgress', (...args: unknown[]) => {
      const payload = args[0] as LocalModelPullProgress | undefined;
      if (!payload?.message) return;
      const timestamp = new Date(payload.ts || Date.now()).toLocaleTimeString();
      appendLocalModelLog('[' + timestamp + '] ' + payload.message);
    });

    return () => {
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!showCliTools) return;
    let cancelled = false;

    (async () => {
      try {
        const result = await window.electron.ipcRenderer.invoke('openclaw:getCliCommand') as {
          success: boolean;
          command?: string;
          error?: string;
        };
        if (cancelled) return;
        if (result.success && result.command) {
          setOpenclawCliCommand(result.command);
          setOpenclawCliError(null);
        } else {
          setOpenclawCliCommand('');
          setOpenclawCliError(result.error || 'OpenClaw CLI unavailable');
        }
      } catch (error) {
        if (cancelled) return;
        setOpenclawCliCommand('');
        setOpenclawCliError(String(error));
      }
    })();

    return () => { cancelled = true; };
  }, [devModeUnlocked, showCliTools]);

  const handleCopyCliCommand = async () => {
    if (!openclawCliCommand) return;
    try {
      await navigator.clipboard.writeText(openclawCliCommand);
      toast.success(t('developer.cmdCopied'));
    } catch (error) {
      toast.error(`Failed to copy command: ${String(error)}`);
    }
  };

  useEffect(() => {
    const unsubscribe = window.electron.ipcRenderer.on('openclaw:cli-installed', (...args: unknown[]) => {
      const installedPath = typeof args[0] === 'string' ? args[0] : '';
      toast.success(`openclaw CLI installed at ${installedPath}`);
    });
    return () => { unsubscribe?.(); };
  }, []);

  useEffect(() => {
    setProxyEnabledDraft(proxyEnabled);
  }, [proxyEnabled]);

  useEffect(() => {
    setProxyServerDraft(proxyServer);
  }, [proxyServer]);

  useEffect(() => {
    setProxyHttpServerDraft(proxyHttpServer);
  }, [proxyHttpServer]);

  useEffect(() => {
    setProxyHttpsServerDraft(proxyHttpsServer);
  }, [proxyHttpsServer]);

  useEffect(() => {
    setProxyAllServerDraft(proxyAllServer);
  }, [proxyAllServer]);

  useEffect(() => {
    setProxyBypassRulesDraft(proxyBypassRules);
  }, [proxyBypassRules]);

  const handleSaveProxySettings = async () => {
    setSavingProxy(true);
    try {
      const normalizedProxyServer = proxyServerDraft.trim();
      const normalizedHttpServer = proxyHttpServerDraft.trim();
      const normalizedHttpsServer = proxyHttpsServerDraft.trim();
      const normalizedAllServer = proxyAllServerDraft.trim();
      const normalizedBypassRules = proxyBypassRulesDraft.trim();
      await window.electron.ipcRenderer.invoke('settings:setMany', {
        proxyEnabled: proxyEnabledDraft,
        proxyServer: normalizedProxyServer,
        proxyHttpServer: normalizedHttpServer,
        proxyHttpsServer: normalizedHttpsServer,
        proxyAllServer: normalizedAllServer,
        proxyBypassRules: normalizedBypassRules,
      });

      setProxyServer(normalizedProxyServer);
      setProxyHttpServer(normalizedHttpServer);
      setProxyHttpsServer(normalizedHttpsServer);
      setProxyAllServer(normalizedAllServer);
      setProxyBypassRules(normalizedBypassRules);
      setProxyEnabled(proxyEnabledDraft);

      toast.success(t('gateway.proxySaved'));
    } catch (error) {
      toast.error(`${t('gateway.proxySaveFailed')}: ${String(error)}`);
    } finally {
      setSavingProxy(false);
    }
  };

  const presets = localModelStatus?.presets ?? LOCAL_MODEL_PRESET_FALLBACK;
  const selectedLanguageLabel = SUPPORTED_LANGUAGES.find((lang) => lang.code === language)?.label ?? language;
  const selectedThemeLabel = theme === 'light'
    ? t('appearance.light')
    : theme === 'dark'
      ? t('appearance.dark')
      : t('appearance.system');
  const localModelReady = Boolean(localModelStatus?.runtimeInstalled && localModelStatus?.serviceRunning);

  return (
    <div className="space-y-6">
      <Card className={controlHeroCardClass}>
        <div className={controlHeroAuraClass} />
        <CardContent className="relative flex flex-col gap-5 p-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
              <p className="text-muted-foreground">{t('subtitle')}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className={cn(controlPanelClass, 'flex h-[116px] flex-col justify-between p-4 text-left')}>
                <p className="text-sm font-medium text-foreground/88">{t('appearance.title')}</p>
                <p className="text-xs text-muted-foreground">{selectedThemeLabel}</p>
                <p className="text-xs text-muted-foreground">{selectedLanguageLabel}</p>
              </div>

              <div className={cn(controlPanelClass, 'flex h-[116px] flex-col justify-between p-4 text-left')}>
                <p className="text-sm font-medium text-foreground/88">{t('aiProviders.title')}</p>
                <p className="text-xs text-muted-foreground">
                  {localModelStatus?.defaultModel || t('localModel.status.runtimeVersionUnknown')}
                </p>
                <Badge variant={localModelReady ? 'success' : 'secondary'}>
                  {localModelReady ? t('localModel.status.runtimeReady') : t('localModel.status.runtimeMissing')}
                </Badge>
              </div>

              <div className={cn(controlPanelClass, 'flex h-[116px] flex-col justify-between p-4 text-left')}>
                <p className="text-sm font-medium text-foreground/88">{t('gateway.title')}</p>
                <p className="text-xs text-muted-foreground">{t('gateway.port')}: {gatewayStatus.port}</p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={gatewayAutoStart ? 'success' : 'secondary'}>{t('gateway.autoStart')}</Badge>
                  <Badge variant={proxyEnabledDraft ? 'warning' : 'secondary'}>{t('gateway.proxyTitle')}</Badge>
                </div>
              </div>

              <div className={cn(controlPanelClass, 'flex h-[116px] flex-col justify-between p-4 text-left')}>
                <p className="text-sm font-medium text-foreground/88">{t('updates.title')}</p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={autoCheckUpdate ? 'success' : 'secondary'}>{t('updates.autoCheck')}</Badge>
                  <Badge variant={autoDownloadUpdate ? 'success' : 'secondary'}>{t('updates.autoDownload')}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{t('about.version', { version: currentVersion })}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="appearance" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-5">
          <TabsTrigger value="appearance">{t('appearance.title')}</TabsTrigger>
          <TabsTrigger value="ai">{t('aiProviders.title')}</TabsTrigger>
          <TabsTrigger value="gateway">{t('gateway.title')}</TabsTrigger>
          <TabsTrigger value="updates">{t('updates.title')}</TabsTrigger>
          <TabsTrigger value="developer">{t('developer.title')}</TabsTrigger>
        </TabsList>

        <TabsContent value="appearance" className="mt-0 space-y-4">
          <AppearanceSettingsCard
            theme={theme}
            language={language}
            languages={SUPPORTED_LANGUAGES}
            onThemeChange={setTheme}
            onLanguageChange={setLanguage}
          />
        </TabsContent>

        <TabsContent value="ai" className="mt-0 space-y-4">
          <AiProvidersCard />
          <LocalModelSettingsCard
            localModelStatus={localModelStatus}
            presets={presets}
            loadingLocalModelStatus={loadingLocalModelStatus}
            localModelAction={localModelAction}
            localModelLogs={localModelLogs}
            toEnableAction={toEnableAction}
            onRefresh={() => { void refreshLocalModelStatus(); }}
            onInstallRuntime={() => { void handleInstallLocalModelRuntime(); }}
            onEnablePreset={(presetId) => { void handleEnableLocalModelPreset(presetId); }}
          />
        </TabsContent>

        <TabsContent value="gateway" className="mt-0 space-y-4">
          <GatewaySettingsCard
            gatewayState={gatewayStatus.state}
            gatewayPort={gatewayStatus.port}
            gatewayAutoStart={gatewayAutoStart}
            proxyEnabledDraft={proxyEnabledDraft}
            proxyServerDraft={proxyServerDraft}
            proxyHttpServerDraft={proxyHttpServerDraft}
            proxyHttpsServerDraft={proxyHttpsServerDraft}
            proxyAllServerDraft={proxyAllServerDraft}
            proxyBypassRulesDraft={proxyBypassRulesDraft}
            savingProxy={savingProxy}
            devModeUnlocked={devModeUnlocked}
            showLogs={showLogs}
            logContent={logContent}
            onRestartGateway={() => { void restartGateway(); }}
            onShowLogs={() => { void handleShowLogs(); }}
            onCloseLogs={() => setShowLogs(false)}
            onOpenLogDir={() => { void handleOpenLogDir(); }}
            onGatewayAutoStartChange={setGatewayAutoStart}
            onProxyEnabledChange={setProxyEnabledDraft}
            onProxyServerChange={setProxyServerDraft}
            onProxyHttpServerChange={setProxyHttpServerDraft}
            onProxyHttpsServerChange={setProxyHttpsServerDraft}
            onProxyAllServerChange={setProxyAllServerDraft}
            onProxyBypassRulesChange={setProxyBypassRulesDraft}
            onSaveProxySettings={() => { void handleSaveProxySettings(); }}
          />
        </TabsContent>

        <TabsContent value="updates" className="mt-0 space-y-4">
          <UpdatesSettingsCard
            autoCheckUpdate={autoCheckUpdate}
            autoDownloadUpdate={autoDownloadUpdate}
            onAutoCheckChange={setAutoCheckUpdate}
            onAutoDownloadChange={(value) => {
              setAutoDownloadUpdate(value);
              updateSetAutoDownload(value);
            }}
          />
        </TabsContent>

        <TabsContent value="developer" className="mt-0 space-y-4">
          <AdvancedSettingsCard devModeUnlocked={devModeUnlocked} onDevModeChange={setDevModeUnlocked} />

          <DeveloperSettingsCard
            devModeUnlocked={devModeUnlocked}
            showCliTools={showCliTools}
            isWindows={isWindows}
            controlUiInfo={controlUiInfo}
            openclawCliCommand={openclawCliCommand}
            openclawCliError={openclawCliError}
            onOpenDevConsole={() => { void openDevConsole(); }}
            onRefreshControlUiInfo={() => { void refreshControlUiInfo(); }}
            onCopyGatewayToken={() => { void handleCopyGatewayToken(); }}
            onCopyCliCommand={() => { void handleCopyCliCommand(); }}
          />

          <AboutCard currentVersion={currentVersion} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default Settings;
