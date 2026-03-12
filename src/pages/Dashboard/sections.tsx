import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Clock,
  Coins,
  Puzzle,
  Radio,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { APP_ROUTES } from '@/lib/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/common/StatusBadge';
import type { Status } from '@/components/common/StatusBadge';
import type { Channel } from '@/types/channel';
import type { Skill } from '@/types/skill';
import type { UsageGroupBy, UsageHistoryEntry, UsageHistoryGroup, UsageWindow } from './types';
import { formatTokenCount, formatUsageTimestamp, formatUptime } from './utils';

const dashboardCardClass =
  'border-border/70 bg-gradient-to-br from-background via-background to-sky-500/[0.05] shadow-[0_20px_60px_-36px_rgba(56,189,248,0.45)]';
const dashboardPanelClass =
  'rounded-xl border border-border/60 bg-background/60 backdrop-blur-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]';

interface DashboardStatusCardsProps {
  gatewayState: Status;
  gatewayPort?: number;
  gatewayPid?: number;
  connectedChannels: number;
  totalChannels: number;
  enabledSkills: number;
  totalSkills: number;
  uptime: number;
  isGatewayRunning: boolean;
}

export function DashboardStatusCards({
  gatewayState,
  gatewayPort,
  gatewayPid,
  connectedChannels,
  totalChannels,
  enabledSkills,
  totalSkills,
  uptime,
  isGatewayRunning,
}: DashboardStatusCardsProps) {
  const { t } = useTranslation('dashboard');

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card className={dashboardCardClass}>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium">{t('gateway')}</CardTitle>
          <Activity className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent className="flex h-[116px] flex-col justify-between">
          <div className="flex items-center gap-2">
            <StatusBadge status={gatewayState} />
          </div>
          {gatewayState === 'running' && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t('port', { port: gatewayPort })} | {t('pid', { pid: gatewayPid || 'N/A' })}
            </p>
          )}
        </CardContent>
      </Card>

      <Card className={dashboardCardClass}>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium">{t('channels')}</CardTitle>
          <Radio className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent className="flex h-[116px] flex-col justify-between">
          <div className="text-2xl font-bold">{connectedChannels}</div>
          <p className="text-xs text-muted-foreground">
            {t('connectedOf', { connected: connectedChannels, total: totalChannels })}
          </p>
        </CardContent>
      </Card>

      <Card className={dashboardCardClass}>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium">{t('skills')}</CardTitle>
          <Puzzle className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent className="flex h-[116px] flex-col justify-between">
          <div className="text-2xl font-bold">{enabledSkills}</div>
          <p className="text-xs text-muted-foreground">
            {t('enabledOf', { enabled: enabledSkills, total: totalSkills })}
          </p>
        </CardContent>
      </Card>

      <Card className={dashboardCardClass}>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium">{t('uptime')}</CardTitle>
          <Clock className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent className="flex h-[116px] flex-col justify-between">
          <div className="text-2xl font-bold">{uptime > 0 ? formatUptime(uptime) : '—'}</div>
          <p className="text-xs text-muted-foreground">
            {isGatewayRunning ? t('sinceRestart') : t('gatewayNotRunning')}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

interface DashboardRecentActivityProps {
  channels: Channel[];
  skills: Skill[];
}

export function DashboardRecentActivity({ channels, skills }: DashboardRecentActivityProps) {
  const { t } = useTranslation('dashboard');
  const enabledSkills = skills.filter((skill) => skill.enabled);

  return (
    <div className="space-y-4">
      <Card className={dashboardCardClass}>
        <CardHeader>
          <CardTitle className="text-lg">{t('connectedChannels')}</CardTitle>
        </CardHeader>
        <CardContent>
          {channels.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <Radio className="mx-auto mb-2 h-8 w-8 opacity-50" />
              <p>{t('noChannels')}</p>
              <Button variant="link" asChild className="mt-2">
                <Link to={APP_ROUTES.control.channels}>{t('addFirst')}</Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {channels.slice(0, 5).map((channel) => (
                <div key={channel.id} className={cn(dashboardPanelClass, 'flex items-center justify-between p-3')}>
                  <div className="flex items-center gap-3">
                    <span className="text-lg">
                      {channel.type === 'whatsapp' && '📱'}
                      {channel.type === 'telegram' && '✈️'}
                      {channel.type === 'discord' && '🎮'}
                    </span>
                    <div>
                      <p className="font-medium">{channel.name}</p>
                      <p className="text-xs capitalize text-muted-foreground">{channel.type}</p>
                    </div>
                  </div>
                  <StatusBadge status={channel.status} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className={dashboardCardClass}>
        <CardHeader>
          <CardTitle className="text-lg">{t('activeSkills')}</CardTitle>
        </CardHeader>
        <CardContent>
          {enabledSkills.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <Puzzle className="mx-auto mb-2 h-8 w-8 opacity-50" />
              <p>{t('noSkills')}</p>
              <Button variant="link" asChild className="mt-2">
                <Link to={APP_ROUTES.workspace.skills}>{t('enableSome')}</Link>
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {enabledSkills.slice(0, 12).map((skill) => (
                <Badge key={skill.id} variant="secondary">
                  {skill.icon && <span className="mr-1">{skill.icon}</span>}
                  {skill.name}
                </Badge>
              ))}
              {enabledSkills.length > 12 && (
                <Badge variant="outline">
                  {t('more', { count: enabledSkills.length - 12 })}
                </Badge>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface DashboardUsageHistoryCardProps {
  usageLoading: boolean;
  visibleUsageHistoryCount: number;
  filteredUsageHistory: UsageHistoryEntry[];
  usageGroups: UsageHistoryGroup[];
  usageGroupBy: UsageGroupBy;
  usageWindow: UsageWindow;
  pagedUsageHistory: UsageHistoryEntry[];
  safeUsagePage: number;
  usageTotalPages: number;
  onUsageGroupByChange: (value: UsageGroupBy) => void;
  onUsageWindowChange: (value: UsageWindow) => void;
  onPrevPage: () => void;
  onNextPage: () => void;
}

export function DashboardUsageHistoryCard({
  usageLoading,
  visibleUsageHistoryCount,
  filteredUsageHistory,
  usageGroups,
  usageGroupBy,
  usageWindow,
  pagedUsageHistory,
  safeUsagePage,
  usageTotalPages,
  onUsageGroupByChange,
  onUsageWindowChange,
  onPrevPage,
  onNextPage,
}: DashboardUsageHistoryCardProps) {
  const { t } = useTranslation('dashboard');

  return (
    <Card className={dashboardCardClass}>
      <CardHeader>
        <CardTitle className="text-lg">{t('recentTokenHistory.title')}</CardTitle>
        <CardDescription>{t('recentTokenHistory.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {usageLoading ? (
          <div className="py-8 text-center text-muted-foreground">{t('recentTokenHistory.loading')}</div>
        ) : visibleUsageHistoryCount === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            <Coins className="mx-auto mb-2 h-8 w-8 opacity-50" />
            <p>{t('recentTokenHistory.empty')}</p>
          </div>
        ) : filteredUsageHistory.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            <Coins className="mx-auto mb-2 h-8 w-8 opacity-50" />
            <p>{t('recentTokenHistory.emptyForWindow')}</p>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex rounded-lg border p-1">
                  <Button variant={usageGroupBy === 'model' ? 'secondary' : 'ghost'} size="sm" onClick={() => onUsageGroupByChange('model')}>
                    {t('recentTokenHistory.groupByModel')}
                  </Button>
                  <Button variant={usageGroupBy === 'day' ? 'secondary' : 'ghost'} size="sm" onClick={() => onUsageGroupByChange('day')}>
                    {t('recentTokenHistory.groupByTime')}
                  </Button>
                </div>
                <div className="flex rounded-lg border p-1">
                  <Button variant={usageWindow === '7d' ? 'secondary' : 'ghost'} size="sm" onClick={() => onUsageWindowChange('7d')}>
                    {t('recentTokenHistory.last7Days')}
                  </Button>
                  <Button variant={usageWindow === '30d' ? 'secondary' : 'ghost'} size="sm" onClick={() => onUsageWindowChange('30d')}>
                    {t('recentTokenHistory.last30Days')}
                  </Button>
                  <Button variant={usageWindow === 'all' ? 'secondary' : 'ghost'} size="sm" onClick={() => onUsageWindowChange('all')}>
                    {t('recentTokenHistory.allTime')}
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('recentTokenHistory.showingLast', { count: filteredUsageHistory.length })}
              </p>
            </div>

            <UsageBarChart
              groups={usageGroups}
              emptyLabel={t('recentTokenHistory.empty')}
              totalLabel={t('recentTokenHistory.totalTokens')}
              inputLabel={t('recentTokenHistory.inputShort')}
              outputLabel={t('recentTokenHistory.outputShort')}
              cacheLabel={t('recentTokenHistory.cacheShort')}
            />

            <div className="space-y-3">
              {pagedUsageHistory.map((entry) => (
                <div key={`${entry.sessionId}-${entry.timestamp}`} className={cn(dashboardPanelClass, 'p-3')}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {entry.model || t('recentTokenHistory.unknownModel')}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[entry.provider, entry.agentId, entry.sessionId].filter(Boolean).join(' • ')}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-semibold">{formatTokenCount(entry.totalTokens)}</p>
                      <p className="text-xs text-muted-foreground">{formatUsageTimestamp(entry.timestamp)}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>{t('recentTokenHistory.input', { value: formatTokenCount(entry.inputTokens) })}</span>
                    <span>{t('recentTokenHistory.output', { value: formatTokenCount(entry.outputTokens) })}</span>
                    {entry.cacheReadTokens > 0 && (
                      <span>{t('recentTokenHistory.cacheRead', { value: formatTokenCount(entry.cacheReadTokens) })}</span>
                    )}
                    {entry.cacheWriteTokens > 0 && (
                      <span>{t('recentTokenHistory.cacheWrite', { value: formatTokenCount(entry.cacheWriteTokens) })}</span>
                    )}
                    {typeof entry.costUsd === 'number' && Number.isFinite(entry.costUsd) && (
                      <span>{t('recentTokenHistory.cost', { amount: entry.costUsd.toFixed(4) })}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between gap-3 border-t pt-3">
              <p className="text-xs text-muted-foreground">
                {t('recentTokenHistory.page', { current: safeUsagePage, total: usageTotalPages })}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={onPrevPage} disabled={safeUsagePage <= 1}>
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  {t('recentTokenHistory.prev')}
                </Button>
                <Button variant="outline" size="sm" onClick={onNextPage} disabled={safeUsagePage >= usageTotalPages}>
                  {t('recentTokenHistory.next')}
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function UsageBarChart({
  groups,
  emptyLabel,
  totalLabel,
  inputLabel,
  outputLabel,
  cacheLabel,
}: {
  groups: Array<{
    label: string;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    cacheTokens: number;
  }>;
  emptyLabel: string;
  totalLabel: string;
  inputLabel: string;
  outputLabel: string;
  cacheLabel: string;
}) {
  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }

  const maxTokens = Math.max(...groups.map((group) => group.totalTokens), 1);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-sky-500" />
          {inputLabel}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-violet-500" />
          {outputLabel}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
          {cacheLabel}
        </span>
      </div>
      {groups.map((group) => (
        <div key={group.label} className="space-y-1">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate font-medium">{group.label}</span>
            <span className="text-muted-foreground">
              {totalLabel}: {formatTokenCount(group.totalTokens)}
            </span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-muted/80 ring-1 ring-border/50">
            <div
              className="flex h-full overflow-hidden rounded-full"
              style={{ width: `${Math.max((group.totalTokens / maxTokens) * 100, 6)}%` }}
            >
              {group.inputTokens > 0 && (
                <div className="h-full bg-sky-500" style={{ width: `${(group.inputTokens / group.totalTokens) * 100}%` }} />
              )}
              {group.outputTokens > 0 && (
                <div className="h-full bg-violet-500" style={{ width: `${(group.outputTokens / group.totalTokens) * 100}%` }} />
              )}
              {group.cacheTokens > 0 && (
                <div className="h-full bg-amber-500" style={{ width: `${(group.cacheTokens / group.totalTokens) * 100}%` }} />
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
