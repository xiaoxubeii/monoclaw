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
import {
  MonoclawCoreMemoryCard,
  MonoclawCoreStatusCard,
  MonoclawCoreWorkspaceCard,
} from './sections';
import type { AssistantDataStatusPayload, AssistantDataStatusResponse } from './types';

export function MonoclawCore() {
  const { t } = useTranslation('settings');
  const [assistantDataChecking, setAssistantDataChecking] = useState(false);
  const [assistantDataStatus, setAssistantDataStatus] = useState<AssistantDataStatusPayload | null>(null);

  const handleOpenPath = async (targetPath: string) => {
    if (!targetPath) return;
    try {
      await window.electron.ipcRenderer.invoke('shell:showItemInFolder', targetPath);
    } catch (error) {
      toast.error(`${t('monoclawCore.openPathFailed')}: ${String(error)}`);
    }
  };

  const handleCopyPath = async (targetPath: string) => {
    if (!targetPath) return;
    try {
      await navigator.clipboard.writeText(targetPath);
      toast.success(t('monoclawCore.pathCopied'));
    } catch (error) {
      toast.error(`${t('monoclawCore.copyPathFailed')}: ${String(error)}`);
    }
  };

  const refreshAssistantDataStatus = async () => {
    try {
      const response = await window.electron.ipcRenderer.invoke('assistantData:getStatus') as AssistantDataStatusResponse;
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to load monoclaw_data status');
      }
      setAssistantDataStatus(response.data);
    } catch (error) {
      toast.error(`${t('monoclawCore.loadFailed')}: ${String(error)}`);
    }
  };

  const runAssistantDataHealthCheck = async () => {
    setAssistantDataChecking(true);
    try {
      const response = await window.electron.ipcRenderer.invoke('assistantData:runHealthCheck') as AssistantDataStatusResponse;
      if (!response.success || !response.data) {
        throw new Error(response.error || 'monoclaw_data health check failed');
      }
      setAssistantDataStatus(response.data);
      toast.success(t('monoclawCore.healthSuccess'));
    } catch (error) {
      toast.error(`${t('monoclawCore.healthFailed')}: ${String(error)}`);
    } finally {
      setAssistantDataChecking(false);
    }
  };

  useEffect(() => {
    void refreshAssistantDataStatus();
  }, []);

  const missingDirCount = assistantDataStatus?.health.missingDirs.length ?? 0;
  const healthy = Boolean(
    assistantDataStatus
    && assistantDataStatus.health.writable
    && missingDirCount === 0
    && !assistantDataStatus.drift.driftDetected
  );

  return (
    <div className="space-y-6">
      <Card className={controlHeroCardClass}>
        <div className={controlHeroAuraClass} />
        <CardContent className="relative space-y-5 p-6">
          <div className="space-y-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{t('monoclawCore.title')}</h1>
              <p className="text-muted-foreground">{t('monoclawCore.description')}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className={cn(controlPanelClass, 'flex h-[116px] flex-col justify-between p-4 text-left')}>
                <p className="text-sm font-medium text-foreground/88">{t('monoclawCore.statusTitle')}</p>
                <Badge variant={healthy ? 'success' : 'destructive'}>
                  {healthy ? t('monoclawCore.healthy') : t('monoclawCore.attention')}
                </Badge>
              </div>
              <div className={cn(controlPanelClass, 'flex h-[116px] flex-col justify-between p-4 text-left')}>
                <p className="text-sm font-medium text-foreground/88">{t('monoclawCore.permissionsTitle')}</p>
                <Badge variant={assistantDataStatus?.health.writable ? 'success' : 'destructive'}>
                  {assistantDataStatus?.health.writable ? t('monoclawCore.writable') : t('monoclawCore.readonly')}
                </Badge>
              </div>
              <div className={cn(controlPanelClass, 'flex h-[116px] flex-col justify-between p-4 text-left')}>
                <p className="text-sm font-medium text-foreground/88">{t('monoclawCore.missingTitle')}</p>
                <Badge variant={missingDirCount === 0 ? 'success' : 'destructive'}>
                  {t('monoclawCore.missing', { count: missingDirCount })}
                </Badge>
              </div>
              <div className={cn(controlPanelClass, 'flex h-[116px] flex-col justify-between p-4 text-left')}>
                <p className="text-sm font-medium text-foreground/88">{t('monoclawCore.layoutTitle')}</p>
                <Badge variant={assistantDataStatus?.drift.driftDetected ? 'destructive' : 'success'}>
                  {assistantDataStatus?.drift.driftDetected ? t('monoclawCore.driftDetected') : t('monoclawCore.driftClean')}
                </Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="storage" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="storage">{t('monoclawCore.storageSectionTitle')}</TabsTrigger>
          <TabsTrigger value="memory">{t('monoclawCore.memorySectionTitle')}</TabsTrigger>
          <TabsTrigger value="workspace">{t('monoclawCore.workspaceSectionTitle')}</TabsTrigger>
        </TabsList>

        <TabsContent value="storage" className="mt-0">
          <MonoclawCoreStatusCard
            status={assistantDataStatus}
            healthy={healthy}
            missingDirCount={missingDirCount}
            assistantDataChecking={assistantDataChecking}
            onRunHealthCheck={() => { void runAssistantDataHealthCheck(); }}
            onOpenPath={(path) => { void handleOpenPath(path); }}
            onCopyPath={(path) => { void handleCopyPath(path); }}
          />
        </TabsContent>

        <TabsContent value="memory" className="mt-0">
          <MonoclawCoreMemoryCard
            status={assistantDataStatus}
            onOpenPath={(path) => { void handleOpenPath(path); }}
            onCopyPath={(path) => { void handleCopyPath(path); }}
          />
        </TabsContent>

        <TabsContent value="workspace" className="mt-0">
          <MonoclawCoreWorkspaceCard
            status={assistantDataStatus}
            onOpenPath={(path) => { void handleOpenPath(path); }}
            onCopyPath={(path) => { void handleCopyPath(path); }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default MonoclawCore;
