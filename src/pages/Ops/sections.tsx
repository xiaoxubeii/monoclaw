import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { OpsActionRecord, OpsEvent, OpsStatusPayload, OpsSubsystem } from '@/types/ops';

const opsPanelClass =
  'rounded-xl border border-border/60 bg-gradient-to-br from-background/80 via-background/70 to-emerald-500/[0.05] backdrop-blur-sm shadow-[0_20px_60px_-36px_rgba(16,185,129,0.3)]';

export const OPS_SUBSYSTEM_KEYS: OpsSubsystem[] = [
  'gateway',
  'openclaw',
  'localModel',
  'teams',
  'scheduler',
  'copilot',
];

export function getOpsStatusVariant(
  status: 'healthy' | 'degraded' | 'critical',
): 'success' | 'warning' | 'destructive' {
  if (status === 'healthy') return 'success';
  if (status === 'critical') return 'destructive';
  return 'warning';
}

export function getOpsSeverityVariant(
  severity: OpsEvent['severity'],
): 'secondary' | 'warning' | 'destructive' {
  if (severity === 'error') return 'destructive';
  if (severity === 'warn') return 'warning';
  return 'secondary';
}

export function getOpsActionStatusVariant(
  status: OpsActionRecord['status'],
): 'secondary' | 'success' | 'warning' | 'destructive' {
  if (status === 'success') return 'success';
  if (status === 'failed') return 'destructive';
  if (status === 'blocked') return 'warning';
  return 'secondary';
}

export function formatOpsTime(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleString();
}

export function getOpsActionLabel(actionType: OpsActionRecord['actionType'], t: (key: string) => string): string {
  switch (actionType) {
    case 'gateway.start':
      return t('ops.actions.gatewayStart');
    case 'gateway.restart':
      return t('ops.actions.gatewayRestart');
    case 'openclaw.doctor.fix':
      return t('ops.actions.doctorFix');
    case 'localModel.service.start':
      return t('ops.actions.localModelServiceStart');
    case 'teams.restartErrored':
      return t('ops.actions.teamsRestartErrored');
    default:
      return actionType;
  }
}

interface OpsSummaryPanelProps {
  opsStatus: OpsStatusPayload | null;
  loadingOps: boolean;
  runningOpsCheck: boolean;
  autoRemediationEnabled: boolean;
  overallOpsStatus: 'healthy' | 'degraded' | 'critical';
  onToggleAutoRemediation: (checked: boolean) => void;
  onRunCheck: () => void;
}

export function OpsSummaryPanel({
  opsStatus,
  loadingOps,
  runningOpsCheck,
  autoRemediationEnabled,
  overallOpsStatus,
  onToggleAutoRemediation,
  onRunCheck,
}: OpsSummaryPanelProps) {
  const { t } = useTranslation('settings');
  const fallback = t('ops.common.notAvailable');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={getOpsStatusVariant(overallOpsStatus)}>{t('ops.status.' + overallOpsStatus)}</Badge>
        <Badge variant="secondary">{t('ops.labels.healthScore', { score: opsStatus?.snapshot.score ?? 0 })}</Badge>
        <Badge variant={(opsStatus?.snapshot.activeIncidents ?? 0) > 0 ? 'warning' : 'success'}>
          {t('ops.labels.activeIncidents', { count: opsStatus?.snapshot.activeIncidents ?? 0 })}
        </Badge>
        <Badge variant={autoRemediationEnabled ? 'success' : 'warning'}>
          {autoRemediationEnabled ? t('ops.labels.autoRemediationActive') : t('ops.labels.autoRemediationPaused')}
        </Badge>
        {opsStatus?.lastDoctorAt && (
          <Badge variant={opsStatus.lastDoctorOk ? 'success' : 'destructive'}>
            {opsStatus.lastDoctorOk ? t('ops.labels.doctorOk') : t('ops.labels.doctorFailed')}
          </Badge>
        )}
      </div>

      <div className={cn(opsPanelClass, 'space-y-3 p-4')}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Label>{t('ops.controls.autoRemediation')}</Label>
            <p className="mt-1 text-xs text-muted-foreground">{t('ops.controls.autoRemediationDesc')}</p>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={autoRemediationEnabled} onCheckedChange={onToggleAutoRemediation} disabled={!opsStatus || loadingOps} />
            <Button variant="outline" size="sm" onClick={onRunCheck} disabled={runningOpsCheck || loadingOps}>
              <RefreshCw className={'mr-2 h-4 w-4' + (runningOpsCheck || loadingOps ? ' animate-spin' : '')} />
              {runningOpsCheck ? t('ops.controls.checking') : (loadingOps ? t('ops.controls.loading') : t('ops.controls.runCheck'))}
            </Button>
          </div>
        </div>
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>{t('ops.labels.lastCheckAt', { time: formatOpsTime(opsStatus?.snapshot.lastCheckAt, fallback) })}</p>
          <p>{t('ops.labels.lastDoctorAt', { time: formatOpsTime(opsStatus?.lastDoctorAt, fallback) })}</p>
        </div>
      </div>
    </div>
  );
}

interface OpsSubsystemGridProps {
  opsStatus: OpsStatusPayload | null;
}

export function OpsSubsystemGrid({ opsStatus }: OpsSubsystemGridProps) {
  const { t } = useTranslation('settings');
  const fallback = t('ops.common.notAvailable');

  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      {OPS_SUBSYSTEM_KEYS.map((subsystemKey) => {
        const subsystemHealth = opsStatus?.snapshot.subsystems[subsystemKey];
        if (!subsystemHealth) {
          return (
            <div key={subsystemKey} className={cn(opsPanelClass, 'p-3')}>
              <p className="text-sm font-medium">{t('ops.subsystems.' + subsystemKey)}</p>
              <p className="mt-2 text-xs text-muted-foreground">{fallback}</p>
            </div>
          );
        }

        return (
          <div key={subsystemKey} className={cn(opsPanelClass, 'space-y-2 p-3')}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">{t('ops.subsystems.' + subsystemKey)}</p>
              <Badge variant={getOpsStatusVariant(subsystemHealth.status)}>{t('ops.status.' + subsystemHealth.status)}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">{subsystemHealth.message}</p>
            <p className="text-[11px] text-muted-foreground">
              {t('ops.labels.updatedAt', { time: formatOpsTime(subsystemHealth.updatedAt, fallback) })}
            </p>
          </div>
        );
      })}
    </div>
  );
}

interface OpsEventsListProps {
  events: OpsEvent[];
}

export function OpsEventsList({ events }: OpsEventsListProps) {
  const { t } = useTranslation('settings');
  const fallback = t('ops.common.notAvailable');

  return (
    <div className={cn(opsPanelClass, 'space-y-3 p-3')}>
      <p className="text-sm font-medium">{t('ops.lists.recentEvents')}</p>
      {events.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('ops.empty.events')}</p>
      ) : (
        <div className="space-y-2">
          {events.map((event) => (
            <div key={event.id} className="space-y-1 rounded-xl border border-border/50 bg-background/60 p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={getOpsSeverityVariant(event.severity)}>{t('ops.severity.' + event.severity)}</Badge>
                <Badge variant="outline">{t('ops.subsystems.' + event.subsystem)}</Badge>
                <span className="text-[11px] text-muted-foreground">{formatOpsTime(event.ts, fallback)}</span>
              </div>
              <p className="text-xs font-medium">{event.summary}</p>
              {event.copilotSummary && <p className="text-xs text-muted-foreground">{t('ops.labels.copilot')} {event.copilotSummary}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface OpsActionsListProps {
  actions: OpsActionRecord[];
}

export function OpsActionsList({ actions }: OpsActionsListProps) {
  const { t } = useTranslation('settings');
  const fallback = t('ops.common.notAvailable');

  return (
    <div className={cn(opsPanelClass, 'space-y-3 p-3')}>
      <p className="text-sm font-medium">{t('ops.lists.recentActions')}</p>
      {actions.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('ops.empty.actions')}</p>
      ) : (
        <div className="space-y-2">
          {actions.map((action) => (
            <div key={action.id} className="space-y-1 rounded-xl border border-border/50 bg-background/60 p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={getOpsActionStatusVariant(action.status)}>{t('ops.actionStatus.' + action.status)}</Badge>
                <span className="text-[11px] text-muted-foreground">{formatOpsTime(action.startedAt, fallback)}</span>
              </div>
              <p className="text-xs font-medium">{getOpsActionLabel(action.actionType, t)}</p>
              {action.verifyResult && <p className="text-xs text-muted-foreground">{action.verifyResult}</p>}
              {action.error && <p className="text-xs text-destructive">{action.error}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
