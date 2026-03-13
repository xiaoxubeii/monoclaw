import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { SummaryTile } from '@/components/control/SummaryTile';
import {
  controlHeroAuraClass,
  controlHeroCardClass,
  controlSummaryTileClass,
} from '@/pages/control/styles';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { OpsActionRecord, OpsEvent, OpsIpcResponse, OpsOverviewPayload, OpsStatusPayload } from '@/types/ops';
import {
  OpsActionsList,
  OpsEventsList,
  OpsSummaryPanel,
  OpsSubsystemGrid,
  formatOpsTime,
} from './sections';

export function Ops() {
  const { t } = useTranslation('settings');
  const [opsStatus, setOpsStatus] = useState<OpsStatusPayload | null>(null);
  const [opsEvents, setOpsEvents] = useState<OpsEvent[]>([]);
  const [opsActions, setOpsActions] = useState<OpsActionRecord[]>([]);
  const [loadingOps, setLoadingOps] = useState(false);
  const [runningOpsCheck, setRunningOpsCheck] = useState(false);
  const [updatingAutoRemediation, setUpdatingAutoRemediation] = useState(false);

  const refreshOpsOverview = useCallback(async () => {
    setLoadingOps(true);
    try {
      const [statusResp, eventsResp, actionsResp] = await Promise.all([
        window.electron.ipcRenderer.invoke('ops:status') as Promise<OpsIpcResponse<OpsStatusPayload>>,
        window.electron.ipcRenderer.invoke('ops:events:list', 20) as Promise<OpsIpcResponse<OpsEvent[]>>,
        window.electron.ipcRenderer.invoke('ops:actions:list', 20) as Promise<OpsIpcResponse<OpsActionRecord[]>>,
      ]);

      if (!statusResp.success || !statusResp.data) {
        throw new Error(statusResp.error || 'Failed to load ops status');
      }

      setOpsStatus(statusResp.data);
      setOpsEvents(eventsResp.success && eventsResp.data ? eventsResp.data : []);
      setOpsActions(actionsResp.success && actionsResp.data ? actionsResp.data : []);
    } catch (error) {
      toast.error(`${t('ops.toast.statusFailed')}: ${String(error)}`);
    } finally {
      setLoadingOps(false);
    }
  }, [t]);

  const runOpsCheckNow = async () => {
    setRunningOpsCheck(true);
    try {
      const response = await window.electron.ipcRenderer.invoke('ops:runCheckNow') as OpsIpcResponse<OpsOverviewPayload>;
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to run ops health check');
      }

      setOpsStatus(response.data.status);
      setOpsEvents(Array.isArray(response.data.events) ? response.data.events : []);
      setOpsActions(Array.isArray(response.data.actions) ? response.data.actions : []);
      toast.success(t('ops.toast.checkSuccess'));
    } catch (error) {
      toast.error(`${t('ops.toast.checkFailed')}: ${String(error)}`);
    } finally {
      setRunningOpsCheck(false);
    }
  };

  const toggleAutoRemediation = async (checked: boolean) => {
    setUpdatingAutoRemediation(true);
    try {
      const channel = checked ? 'ops:resumeAutoRemediation' : 'ops:pauseAutoRemediation';
      const response = await window.electron.ipcRenderer.invoke(channel) as OpsIpcResponse<OpsStatusPayload>;
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to update auto remediation');
      }

      setOpsStatus(response.data);
      toast.success(checked ? t('ops.toast.resumeSuccess') : t('ops.toast.pauseSuccess'));
    } catch (error) {
      toast.error(`${t('ops.toast.toggleFailed')}: ${String(error)}`);
    } finally {
      setUpdatingAutoRemediation(false);
    }
  };

  useEffect(() => {
    void refreshOpsOverview();
  }, [refreshOpsOverview]);

  useEffect(() => {
    const unsubscribeUpdated = window.electron.ipcRenderer.on('ops:updated', (...args: unknown[]) => {
      const payload = args[0] as OpsOverviewPayload | undefined;
      if (!payload?.status) return;
      setOpsStatus(payload.status);
      setOpsEvents(Array.isArray(payload.events) ? payload.events : []);
      setOpsActions(Array.isArray(payload.actions) ? payload.actions : []);
    });

    const unsubscribeEvent = window.electron.ipcRenderer.on('ops:event', (...args: unknown[]) => {
      const payload = args[0] as OpsEvent | undefined;
      if (!payload?.id) return;
      setOpsEvents((prev) => [payload, ...prev.filter((item) => item.id !== payload.id)].slice(0, 50));
    });

    const unsubscribeAction = window.electron.ipcRenderer.on('ops:action', (...args: unknown[]) => {
      const payload = args[0] as OpsActionRecord | undefined;
      if (!payload?.id) return;
      setOpsActions((prev) => [payload, ...prev.filter((item) => item.id !== payload.id)].slice(0, 50));
    });

    return () => {
      unsubscribeUpdated?.();
      unsubscribeEvent?.();
      unsubscribeAction?.();
    };
  }, []);

  const overallOpsStatus = opsStatus?.snapshot.overall ?? 'degraded';
  const autoRemediationEnabled = opsStatus ? !opsStatus.paused : false;
  const recentOpsEvents = opsEvents.slice(0, 8);
  const recentOpsActions = opsActions.slice(0, 8);
  const subsystemsCount = Object.keys(opsStatus?.snapshot.subsystems ?? {}).length;
  const fallbackTime = t('ops.common.notAvailable');

  return (
    <div className="space-y-6">
      <Card className={controlHeroCardClass}>
        <div className={controlHeroAuraClass} />
        <CardContent className="relative flex flex-col gap-5 p-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{t('ops.title')}</h1>
              <p className="text-muted-foreground">{t('ops.description')}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <SummaryTile
                title={t('ops.summary.health')}
                value={opsStatus?.snapshot.score ?? 0}
                description={t('ops.status.' + overallOpsStatus)}
                className={controlSummaryTileClass}
              />
              <SummaryTile
                title={t('ops.summary.incidents')}
                value={opsStatus?.snapshot.activeIncidents ?? 0}
                description={autoRemediationEnabled ? t('ops.labels.autoRemediationActive') : t('ops.labels.autoRemediationPaused')}
                className={controlSummaryTileClass}
              />
              <SummaryTile
                title={t('ops.summary.subsystems')}
                value={subsystemsCount}
                description={t('ops.labels.lastCheckAt', { time: formatOpsTime(opsStatus?.snapshot.lastCheckAt, fallbackTime) })}
                className={controlSummaryTileClass}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <OpsSummaryPanel
        opsStatus={opsStatus}
        loadingOps={loadingOps || updatingAutoRemediation}
        runningOpsCheck={runningOpsCheck}
        autoRemediationEnabled={autoRemediationEnabled}
        overallOpsStatus={overallOpsStatus}
        onToggleAutoRemediation={(checked) => { void toggleAutoRemediation(checked); }}
        onRunCheck={() => { void runOpsCheckNow(); }}
      />

      <Tabs defaultValue="subsystems" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="subsystems">{t('ops.tabs.subsystems')}</TabsTrigger>
          <TabsTrigger value="events">{t('ops.tabs.events')}</TabsTrigger>
          <TabsTrigger value="actions">{t('ops.tabs.actions')}</TabsTrigger>
        </TabsList>

        <TabsContent value="subsystems" className="mt-0">
          <OpsSubsystemGrid opsStatus={opsStatus} />
        </TabsContent>

        <TabsContent value="events" className="mt-0">
          <OpsEventsList events={recentOpsEvents} />
        </TabsContent>

        <TabsContent value="actions" className="mt-0">
          <OpsActionsList actions={recentOpsActions} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default Ops;
