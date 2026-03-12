import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { SummaryTile } from '@/components/control/SummaryTile';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { OpsActionRecord, OpsEvent, OpsIpcResponse, OpsOverviewPayload, OpsStatusPayload } from '@/types/ops';
import {
  OpsActionsList,
  OpsEventsList,
  OpsSubsystemGrid,
  formatOpsTime,
} from './sections';

export function Ops() {
  const { t } = useTranslation('settings');
  const [opsStatus, setOpsStatus] = useState<OpsStatusPayload | null>(null);
  const [opsEvents, setOpsEvents] = useState<OpsEvent[]>([]);
  const [opsActions, setOpsActions] = useState<OpsActionRecord[]>([]);

  const refreshOpsOverview = async () => {
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
    }
  };

  useEffect(() => {
    void refreshOpsOverview();
  }, []);

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
      <Card className="relative overflow-hidden border-border/70 bg-background/80 shadow-[0_24px_80px_-42px_rgba(16,185,129,0.45)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.18),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(52,211,153,0.12),transparent_28%)]" />
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
                className="bg-background/60 backdrop-blur-sm"
              />
              <SummaryTile
                title={t('ops.summary.incidents')}
                value={opsStatus?.snapshot.activeIncidents ?? 0}
                description={autoRemediationEnabled ? t('ops.labels.autoRemediationActive') : t('ops.labels.autoRemediationPaused')}
                className="bg-background/60 backdrop-blur-sm"
              />
              <SummaryTile
                title={t('ops.summary.subsystems')}
                value={subsystemsCount}
                description={t('ops.labels.lastCheckAt', { time: formatOpsTime(opsStatus?.snapshot.lastCheckAt, fallbackTime) })}
                className="bg-background/60 backdrop-blur-sm"
              />
            </div>
          </div>
        </CardContent>
      </Card>

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
