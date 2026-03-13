/**
 * Dashboard Page
 * Main overview page showing system status and usage signals
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { SummaryTile } from '@/components/control/SummaryTile';
import {
  controlHeroAuraClass,
  controlHeroCardClass,
  controlSummaryTileClass,
} from '@/pages/control/styles';
import { useChannelsStore } from '@/stores/channels';
import { useGatewayStore } from '@/stores/gateway';
import { useSkillsStore } from '@/stores/skills';
import {
  DashboardRecentActivity,
  DashboardUsageHistoryCard,
} from './sections';
import type { UsageGroupBy, UsageHistoryEntry, UsageWindow } from './types';
import { filterUsageHistoryByWindow, formatUptime, groupUsageHistory } from './utils';

export function Dashboard() {
  const { t } = useTranslation('dashboard');
  const gatewayStatus = useGatewayStore((state) => state.status);
  const { channels, fetchChannels } = useChannelsStore();
  const { skills, fetchSkills } = useSkillsStore();

  const isGatewayRunning = gatewayStatus.state === 'running';
  const [uptime, setUptime] = useState(0);
  const [usageHistory, setUsageHistory] = useState<UsageHistoryEntry[]>([]);
  const [usageGroupBy, setUsageGroupBy] = useState<UsageGroupBy>('model');
  const [usageWindow, setUsageWindow] = useState<UsageWindow>('7d');
  const [usagePage, setUsagePage] = useState(1);

  useEffect(() => {
    if (!isGatewayRunning) return;

    fetchChannels();
    fetchSkills();
    window.electron.ipcRenderer.invoke('usage:recentTokenHistory')
      .then((entries) => {
        setUsageHistory(Array.isArray(entries) ? (entries as UsageHistoryEntry[]) : []);
        setUsagePage(1);
      })
      .catch(() => {
        setUsageHistory([]);
      });
  }, [fetchChannels, fetchSkills, isGatewayRunning]);

  useEffect(() => {
    const updateUptime = () => {
      if (gatewayStatus.connectedAt) {
        setUptime(Math.floor((Date.now() - gatewayStatus.connectedAt) / 1000));
      } else {
        setUptime(0);
      }
    };

    updateUptime();
    const interval = setInterval(updateUptime, 1000);
    return () => clearInterval(interval);
  }, [gatewayStatus.connectedAt]);

  const connectedChannels = Array.isArray(channels) ? channels.filter((channel) => channel.status === 'connected').length : 0;
  const enabledSkills = Array.isArray(skills) ? skills.filter((skill) => skill.enabled).length : 0;
  const visibleUsageHistory = isGatewayRunning ? usageHistory : [];
  const filteredUsageHistory = filterUsageHistoryByWindow(visibleUsageHistory, usageWindow);
  const usageGroups = groupUsageHistory(filteredUsageHistory, usageGroupBy);
  const usagePageSize = 5;
  const usageTotalPages = Math.max(1, Math.ceil(filteredUsageHistory.length / usagePageSize));
  const safeUsagePage = Math.min(usagePage, usageTotalPages);
  const pagedUsageHistory = filteredUsageHistory.slice((safeUsagePage - 1) * usagePageSize, safeUsagePage * usagePageSize);
  const usageLoading = isGatewayRunning && visibleUsageHistory.length === 0;

  const handleUsageGroupByChange = (value: UsageGroupBy) => {
    setUsageGroupBy(value);
    setUsagePage(1);
  };

  const handleUsageWindowChange = (value: UsageWindow) => {
    setUsageWindow(value);
    setUsagePage(1);
  };

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
              <SummaryTile
                title={t('gateway')}
                value={gatewayStatus.state}
                description={isGatewayRunning ? t('sinceRestart') : t('gatewayNotRunning')}
                className={controlSummaryTileClass}
              />
              <SummaryTile
                title={t('channels')}
                value={`${connectedChannels}/${channels.length}`}
                description={t('connectedOf', { connected: connectedChannels, total: channels.length })}
                className={controlSummaryTileClass}
              />
              <SummaryTile
                title={t('skills')}
                value={`${enabledSkills}/${skills.length}`}
                description={t('enabledOf', { enabled: enabledSkills, total: skills.length })}
                className={controlSummaryTileClass}
              />
              <SummaryTile
                title={t('uptime')}
                value={uptime > 0 ? formatUptime(uptime) : '—'}
                description={isGatewayRunning ? t('sinceRestart') : t('gatewayNotRunning')}
                className={controlSummaryTileClass}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <DashboardUsageHistoryCard
        usageLoading={usageLoading}
        visibleUsageHistoryCount={visibleUsageHistory.length}
        filteredUsageHistory={filteredUsageHistory}
        usageGroups={usageGroups}
        usageGroupBy={usageGroupBy}
        usageWindow={usageWindow}
        pagedUsageHistory={pagedUsageHistory}
        safeUsagePage={safeUsagePage}
        usageTotalPages={usageTotalPages}
        onUsageGroupByChange={handleUsageGroupByChange}
        onUsageWindowChange={handleUsageWindowChange}
        onPrevPage={() => setUsagePage((page) => Math.max(1, page - 1))}
        onNextPage={() => setUsagePage((page) => Math.min(usageTotalPages, page + 1))}
      />

      <DashboardRecentActivity channels={channels} skills={skills} />
    </div>
  );
}

export default Dashboard;
