import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SummaryTile } from '@/components/control/SummaryTile';
import { cn } from '@/lib/utils';
import {
  controlHeroAuraClass,
  controlHeroCardClass,
  controlPanelClass,
  controlSummaryTileClass,
  controlSurfaceCardClass,
} from '@/pages/control/styles';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useGatewayStore } from '@/stores/gateway';
import {
  DoctorCard,
  GatewayRuntimeControlsCard,
  OpenClawPackageCard,
  VoiceCallSettingsCard,
} from './sections';
import type {
  OpenClawDoctorResult,
  OpenClawStatusInfo,
  VoiceCallDefaultMode,
  VoiceCallPluginState,
} from './types';

export function RuntimeManager() {
  const { t } = useTranslation('settings');
  const {
    status: gatewayStatus,
    start: startGateway,
    stop: stopGateway,
    restart: restartGateway,
    lastError: gatewayLastError,
  } = useGatewayStore();

  const [openclawStatus, setOpenclawStatus] = useState<OpenClawStatusInfo | null>(null);
  const [openclawConfigDir, setOpenclawConfigDir] = useState('');
  const [openclawSkillsDir, setOpenclawSkillsDir] = useState('');
  const [loadingOpenclawMeta, setLoadingOpenclawMeta] = useState(false);
  const [doctorRunning, setDoctorRunning] = useState<'none' | 'check' | 'fix'>('none');
  const [doctorResult, setDoctorResult] = useState<OpenClawDoctorResult | null>(null);

  const [voiceCallLoading, setVoiceCallLoading] = useState(false);
  const [voiceCallSaving, setVoiceCallSaving] = useState(false);
  const [voiceCallTesting, setVoiceCallTesting] = useState(false);
  const [voiceCallEnabled, setVoiceCallEnabled] = useState(true);
  const [voiceCallProvider, setVoiceCallProvider] = useState('mock');
  const [voiceCallFromNumber, setVoiceCallFromNumber] = useState('');
  const [voiceCallToNumber, setVoiceCallToNumber] = useState('');
  const [voiceCallDefaultMode, setVoiceCallDefaultMode] = useState<VoiceCallDefaultMode>('notify');
  const [voiceCallResult, setVoiceCallResult] = useState<unknown | null>(null);

  const handleOpenPath = async (targetPath: string) => {
    if (!targetPath) return;
    try {
      await window.electron.ipcRenderer.invoke('shell:showItemInFolder', targetPath);
    } catch (error) {
      toast.error(`${t('openclawManager.openPathFailed')}: ${String(error)}`);
    }
  };

  const handleCopyPath = async (targetPath: string) => {
    if (!targetPath) return;
    try {
      await navigator.clipboard.writeText(targetPath);
      toast.success(t('openclawManager.pathCopied'));
    } catch (error) {
      toast.error(`${t('openclawManager.copyPathFailed')}: ${String(error)}`);
    }
  };

  const refreshOpenClawMeta = useCallback(async () => {
    setLoadingOpenclawMeta(true);
    setVoiceCallLoading(true);
    try {
      const [openclawStatusInfo, configDirPath, skillsDirPath, voiceCallResp] = await Promise.all([
        window.electron.ipcRenderer.invoke('openclaw:status') as Promise<OpenClawStatusInfo>,
        window.electron.ipcRenderer.invoke('openclaw:getConfigDir') as Promise<string>,
        window.electron.ipcRenderer.invoke('openclaw:getSkillsDir') as Promise<string>,
        window.electron.ipcRenderer.invoke('voicecall:getConfig') as Promise<{
          success: boolean;
          data?: VoiceCallPluginState;
          error?: string;
        }>,
      ]);

      setOpenclawStatus(openclawStatusInfo);
      setOpenclawConfigDir(configDirPath || '');
      setOpenclawSkillsDir(skillsDirPath || '');

      if (voiceCallResp.success && voiceCallResp.data) {
        setVoiceCallEnabled(voiceCallResp.data.enabled);
        setVoiceCallProvider(voiceCallResp.data.config.provider || 'mock');
        setVoiceCallFromNumber(voiceCallResp.data.config.fromNumber || '');
        setVoiceCallToNumber(voiceCallResp.data.config.toNumber || '');
        const mode = voiceCallResp.data.config.outbound?.defaultMode;
        setVoiceCallDefaultMode(mode === 'conversation' ? 'conversation' : 'notify');
      } else if (voiceCallResp.error) {
        toast.error(`${t('openclawManager.voiceCallLoadFailed')}: ${voiceCallResp.error}`);
      }
    } catch (error) {
      toast.error(`${t('openclawManager.loadFailed')}: ${String(error)}`);
    } finally {
      setLoadingOpenclawMeta(false);
      setVoiceCallLoading(false);
    }
  }, [t]);

  const runOpenClawDoctor = async (fix: boolean) => {
    setDoctorRunning(fix ? 'fix' : 'check');
    try {
      const result = await window.electron.ipcRenderer.invoke('openclaw:doctor', {
        fix,
        timeoutMs: 120000,
      }) as OpenClawDoctorResult;

      setDoctorResult(result);
      if (result.success) {
        toast.success(fix ? t('openclawManager.doctorFixSuccess') : t('openclawManager.doctorCheckSuccess'));
      } else {
        toast.error(fix ? t('openclawManager.doctorFixFailed') : t('openclawManager.doctorCheckFailed'));
      }
      await refreshOpenClawMeta();
    } catch (error) {
      toast.error(`${t('openclawManager.doctorInvokeFailed')}: ${String(error)}`);
    } finally {
      setDoctorRunning('none');
    }
  };

  const saveVoiceCallConfig = async () => {
    setVoiceCallSaving(true);
    try {
      const response = await window.electron.ipcRenderer.invoke('voicecall:saveConfig', {
        enabled: voiceCallEnabled,
        config: {
          provider: voiceCallProvider,
          fromNumber: voiceCallFromNumber || undefined,
          toNumber: voiceCallToNumber || undefined,
          outbound: {
            defaultMode: voiceCallDefaultMode,
          },
        },
      }) as { success: boolean; data?: VoiceCallPluginState; error?: string };

      if (!response.success) {
        throw new Error(response.error || 'Failed to save voice call config');
      }

      if (response.data) {
        setVoiceCallEnabled(response.data.enabled);
        setVoiceCallProvider(response.data.config.provider || 'mock');
        setVoiceCallFromNumber(response.data.config.fromNumber || '');
        setVoiceCallToNumber(response.data.config.toNumber || '');
      }

      toast.success(t('openclawManager.voiceCallSaveSuccess'));
    } catch (error) {
      toast.error(`${t('openclawManager.voiceCallSaveFailed')}: ${String(error)}`);
    } finally {
      setVoiceCallSaving(false);
    }
  };

  const runVoiceCallMockTest = async () => {
    setVoiceCallTesting(true);
    try {
      const response = await window.electron.ipcRenderer.invoke('voicecall:mockSmokeTest', {
        to: voiceCallToNumber || undefined,
        mode: voiceCallDefaultMode,
        message: 'Monoclaw voice-call mock smoke test',
      }) as { success: boolean; result?: unknown; error?: string };

      if (!response.success) {
        throw new Error(response.error || 'Voice-call mock smoke test failed');
      }

      setVoiceCallResult(response.result ?? null);
      toast.success(t('openclawManager.voiceCallMockSuccess'));
    } catch (error) {
      toast.error(`${t('openclawManager.voiceCallMockFailed')}: ${String(error)}`);
    } finally {
      setVoiceCallTesting(false);
    }
  };

  useEffect(() => {
    void refreshOpenClawMeta();
  }, [refreshOpenClawMeta]);

  return (
    <div className="space-y-6">
      <Card className={controlHeroCardClass}>
        <div className={controlHeroAuraClass} />
        <CardContent className="relative flex flex-col gap-5 p-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{t('openclawManager.title')}</h1>
              <p className="text-muted-foreground">{t('openclawManager.description')}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <SummaryTile
                title={t('openclawManager.summaryRuntime')}
                value="OpenClaw"
                description={t('openclawManager.runtimeControlsTitle')}
                className={controlSummaryTileClass}
              />
              <SummaryTile
                title={t('openclawManager.summaryGateway')}
                value={gatewayStatus.state}
                description={t('openclawManager.gatewayControl')}
                className={controlSummaryTileClass}
              />
              <SummaryTile
                title={t('openclawManager.summaryVoice')}
                value={voiceCallProvider}
                description={t('openclawManager.voiceCallTitle')}
                className={controlSummaryTileClass}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <OpenClawPackageCard
          openclawStatus={openclawStatus}
          openclawConfigDir={openclawConfigDir}
          openclawSkillsDir={openclawSkillsDir}
          loadingOpenclawMeta={loadingOpenclawMeta}
          onRefresh={() => { void refreshOpenClawMeta(); }}
          onOpenPath={(path) => { void handleOpenPath(path); }}
          onCopyPath={(path) => { void handleCopyPath(path); }}
        />

        <Card className={controlSurfaceCardClass}>
          <CardHeader>
            <CardTitle className="text-lg">{t('openclawManager.runtimeControlsTitle')}</CardTitle>
            <CardDescription>{t('openclawManager.runtimeControlsDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">OpenClaw</Badge>
              <Badge variant={voiceCallEnabled ? 'success' : 'secondary'}>
                {t('openclawManager.voiceCallEnabled')}
              </Badge>
              {doctorResult && (
                <Badge variant={doctorResult.success ? 'success' : 'destructive'}>
                  {doctorResult.success ? t('openclawManager.doctorSuccess') : t('openclawManager.doctorFailed')}
                </Badge>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className={cn(controlPanelClass, 'flex h-[116px] flex-col justify-between p-3 text-left')}>
                <p className="text-sm font-medium">{t('openclawManager.gatewayControl')}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t('openclawManager.gatewayControlDesc')}</p>
              </div>
              <div className={cn(controlPanelClass, 'flex h-[116px] flex-col justify-between p-3 text-left')}>
                <p className="text-sm font-medium">{t('openclawManager.voiceCallTitle')}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t('openclawManager.voiceCallDescription')}</p>
              </div>
              <div className={cn(controlPanelClass, 'flex h-[116px] flex-col justify-between p-3 text-left sm:col-span-2')}>
                <p className="text-sm font-medium">{t('openclawManager.doctorTitle')}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t('openclawManager.doctorDescription')}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="gateway" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="gateway">{t('openclawManager.gatewayControl')}</TabsTrigger>
          <TabsTrigger value="voice">{t('openclawManager.voiceCallTitle')}</TabsTrigger>
          <TabsTrigger value="doctor">{t('openclawManager.doctorTitle')}</TabsTrigger>
        </TabsList>

        <TabsContent value="gateway" className="mt-0">
          <Card className={controlSurfaceCardClass}>
            <CardContent className="pt-6">
              <GatewayRuntimeControlsCard
                gatewayState={gatewayStatus.state}
                gatewayLastError={gatewayLastError}
                onStartGateway={() => { void startGateway(); }}
                onStopGateway={() => { void stopGateway(); }}
                onRestartGateway={() => { void restartGateway(); }}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="voice" className="mt-0">
          <Card className={controlSurfaceCardClass}>
            <CardContent className="pt-6">
              <VoiceCallSettingsCard
                voiceCallLoading={voiceCallLoading}
                voiceCallSaving={voiceCallSaving}
                voiceCallTesting={voiceCallTesting}
                voiceCallEnabled={voiceCallEnabled}
                voiceCallProvider={voiceCallProvider}
                voiceCallFromNumber={voiceCallFromNumber}
                voiceCallToNumber={voiceCallToNumber}
                voiceCallDefaultMode={voiceCallDefaultMode}
                voiceCallResult={voiceCallResult}
                onVoiceCallEnabledChange={setVoiceCallEnabled}
                onVoiceCallProviderChange={setVoiceCallProvider}
                onVoiceCallFromNumberChange={setVoiceCallFromNumber}
                onVoiceCallToNumberChange={setVoiceCallToNumber}
                onVoiceCallDefaultModeChange={setVoiceCallDefaultMode}
                onSave={() => { void saveVoiceCallConfig(); }}
                onMockTest={() => { void runVoiceCallMockTest(); }}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="doctor" className="mt-0">
          <Card className={controlSurfaceCardClass}>
            <CardContent className="pt-6">
              <DoctorCard
                doctorRunning={doctorRunning}
                doctorResult={doctorResult}
                onRunCheck={() => { void runOpenClawDoctor(false); }}
                onRunFix={() => { void runOpenClawDoctor(true); }}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default RuntimeManager;
