import { useState } from 'react';
import { ChevronDown, Copy, FolderOpen, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import type { AssistantDataStatusPayload } from './types';

const monoclawCoreCardClass =
  'border-border/70 bg-gradient-to-br from-background via-background to-cyan-500/[0.05] shadow-[0_20px_60px_-36px_rgba(34,211,238,0.35)]';
const monoclawCorePanelClass =
  'rounded-xl border border-border/60 bg-background/60 p-3 backdrop-blur-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]';

interface PathEntry {
  label: string;
  value?: string;
}

interface PathRowProps extends PathEntry {
  onOpenPath: (path: string) => void;
  onCopyPath: (path: string) => void;
}

function PathRow({
  label,
  value,
  onOpenPath,
  onCopyPath,
}: PathRowProps) {
  const { t } = useTranslation(['settings', 'common']);
  const resolvedPath = value || '';

  return (
    <div className={cn(monoclawCorePanelClass, 'flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between')}>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-sm font-medium">{label}</p>
        <div
          className={cn(
            'rounded-lg border border-border/60 bg-background/75 px-3 py-2 font-mono text-xs leading-relaxed',
            resolvedPath ? 'break-all text-foreground/80' : 'text-muted-foreground'
          )}
        >
          {resolvedPath || t('settings:monoclawCore.pathUnavailable')}
        </div>
      </div>

      <div className="flex shrink-0 gap-2 self-start lg:self-center">
        <Button type="button" variant="outline" size="sm" onClick={() => onOpenPath(resolvedPath)} disabled={!resolvedPath}>
          <FolderOpen className="mr-2 h-4 w-4" />
          {t('settings:monoclawCore.openFolder')}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => onCopyPath(resolvedPath)} disabled={!resolvedPath}>
          <Copy className="mr-2 h-4 w-4" />
          {t('common:actions.copy')}
        </Button>
      </div>
    </div>
  );
}

interface PathSectionProps {
  title: string;
  entries: PathEntry[];
  onOpenPath: (path: string) => void;
  onCopyPath: (path: string) => void;
}

function PathSection({ title, entries, onOpenPath, onCopyPath }: PathSectionProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">{title}</p>
        <Badge variant="outline">{entries.length}</Badge>
      </div>
      <div className="space-y-3">
        {entries.map((entry) => (
          <PathRow
            key={entry.label}
            label={entry.label}
            value={entry.value}
            onOpenPath={onOpenPath}
            onCopyPath={onCopyPath}
          />
        ))}
      </div>
    </div>
  );
}

function AdvancedPathsSection({ title, entries, onOpenPath, onCopyPath }: PathSectionProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-3">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 px-0 text-sm font-medium hover:bg-transparent"
        onClick={() => setOpen((current) => !current)}
      >
        <ChevronDown className={cn('mr-2 h-4 w-4 transition-transform', open && 'rotate-180')} />
        {title}
        <Badge variant="outline" className="ml-2">
          {entries.length}
        </Badge>
      </Button>
      {open ? (
        <div className="space-y-3">
          {entries.map((entry) => (
            <PathRow
              key={entry.label}
              label={entry.label}
              value={entry.value}
              onOpenPath={onOpenPath}
              onCopyPath={onCopyPath}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface MonoclawCoreStatusCardProps {
  status: AssistantDataStatusPayload | null;
  healthy: boolean;
  missingDirCount: number;
  assistantDataChecking: boolean;
  onRunHealthCheck: () => void;
  onOpenPath: (path: string) => void;
  onCopyPath: (path: string) => void;
}

export function MonoclawCoreStatusCard({
  status,
  healthy,
  missingDirCount,
  assistantDataChecking,
  onRunHealthCheck,
  onOpenPath,
  onCopyPath,
}: MonoclawCoreStatusCardProps) {
  const { t } = useTranslation('settings');

  return (
    <Card className={monoclawCoreCardClass}>
      <CardHeader>
        <CardTitle>{t('monoclawCore.storageSectionTitle')}</CardTitle>
        <CardDescription>{t('monoclawCore.storageSectionDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Label>{t('monoclawCore.statusTitle')}</Label>
            <p className="text-sm text-muted-foreground">{t('monoclawCore.statusDescription')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={healthy ? 'success' : 'destructive'}>
              {healthy ? t('monoclawCore.healthy') : t('monoclawCore.attention')}
            </Badge>
            <Button type="button" variant="outline" size="sm" onClick={onRunHealthCheck} disabled={assistantDataChecking}>
              <RefreshCw className={`mr-2 h-4 w-4${assistantDataChecking ? ' animate-spin' : ''}`} />
              {t('monoclawCore.healthCheck')}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant={status?.health.writable ? 'success' : 'destructive'}>
            {status?.health.writable ? t('monoclawCore.writable') : t('monoclawCore.readonly')}
          </Badge>
          <Badge variant={missingDirCount === 0 ? 'success' : 'destructive'}>
            {t('monoclawCore.missing', { count: missingDirCount })}
          </Badge>
          <Badge variant={status?.drift.driftDetected ? 'destructive' : 'success'}>
            {status?.drift.driftDetected ? t('monoclawCore.driftDetected') : t('monoclawCore.driftClean')}
          </Badge>
        </div>

        <PathSection
          title={t('monoclawCore.corePaths')}
          entries={[
            { label: t('monoclawCore.root'), value: status?.layout.root },
            { label: t('monoclawCore.vault'), value: status?.layout.vaultDir },
            { label: t('monoclawCore.memoryRoot'), value: status?.layout.memoryRootDir },
            { label: t('monoclawCore.workspaceRoot'), value: status?.layout.workspaceRootDir },
          ]}
          onOpenPath={onOpenPath}
          onCopyPath={onCopyPath}
        />
      </CardContent>
    </Card>
  );
}

interface MonoclawCoreMemoryCardProps {
  status: AssistantDataStatusPayload | null;
  onOpenPath: (path: string) => void;
  onCopyPath: (path: string) => void;
}

export function MonoclawCoreMemoryCard({ status, onOpenPath, onCopyPath }: MonoclawCoreMemoryCardProps) {
  const { t } = useTranslation('settings');

  return (
    <Card className={monoclawCoreCardClass}>
      <CardHeader>
        <CardTitle>{t('monoclawCore.memorySectionTitle')}</CardTitle>
        <CardDescription>{t('monoclawCore.memorySectionDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <PathSection
          title={t('monoclawCore.corePaths')}
          entries={[
            { label: t('monoclawCore.memoryRoot'), value: status?.layout.memoryRootDir },
            { label: t('monoclawCore.knowledgeBase'), value: status?.layout.knowledgeBaseDir },
            { label: t('monoclawCore.vectorStoreRoot'), value: status?.layout.vectorStoreRootDir },
          ]}
          onOpenPath={onOpenPath}
          onCopyPath={onCopyPath}
        />

        <AdvancedPathsSection
          title={t('monoclawCore.advancedPaths')}
          entries={[
            { label: t('monoclawCore.habitsPrefs'), value: status?.layout.habitsPrefsDir },
            { label: t('monoclawCore.userCorrections'), value: status?.layout.userCorrectionsDir },
            { label: t('monoclawCore.interactionHistory'), value: status?.layout.interactionHistoryDir },
            { label: t('monoclawCore.vectorStore'), value: status?.layout.vectorStoreLanceDbDir },
          ]}
          onOpenPath={onOpenPath}
          onCopyPath={onCopyPath}
        />
      </CardContent>
    </Card>
  );
}

interface MonoclawCoreWorkspaceCardProps {
  status: AssistantDataStatusPayload | null;
  onOpenPath: (path: string) => void;
  onCopyPath: (path: string) => void;
}

export function MonoclawCoreWorkspaceCard({ status, onOpenPath, onCopyPath }: MonoclawCoreWorkspaceCardProps) {
  const { t } = useTranslation('settings');

  return (
    <Card className={monoclawCoreCardClass}>
      <CardHeader>
        <CardTitle>{t('monoclawCore.workspaceSectionTitle')}</CardTitle>
        <CardDescription>{t('monoclawCore.workspaceSectionDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <PathSection
          title={t('monoclawCore.corePaths')}
          entries={[
            { label: t('monoclawCore.workspaceRoot'), value: status?.layout.workspaceRootDir },
            { label: t('monoclawCore.workspace'), value: status?.layout.workspaceDir },
            { label: t('monoclawCore.activeSessions'), value: status?.layout.activeSessionsDir },
            { label: t('monoclawCore.taskLogs'), value: status?.layout.taskLogsDir },
          ]}
          onOpenPath={onOpenPath}
          onCopyPath={onCopyPath}
        />

        <AdvancedPathsSection
          title={t('monoclawCore.advancedPaths')}
          entries={[
            { label: t('monoclawCore.inboxOutbox'), value: status?.layout.inboxOutboxDir },
            { label: t('monoclawCore.screenshots'), value: status?.layout.screenshotsDir },
            { label: t('monoclawCore.clipboard'), value: status?.layout.clipboardDir },
            { label: t('monoclawCore.workflows'), value: status?.layout.workflowsDir },
            { label: t('monoclawCore.appBlueprints'), value: status?.layout.appBlueprintsDir },
            { label: t('monoclawCore.uiAnchors'), value: status?.layout.uiAnchorsDir },
            { label: t('monoclawCore.actionAssets'), value: status?.layout.actionAssetsRootDir },
          ]}
          onOpenPath={onOpenPath}
          onCopyPath={onCopyPath}
        />
      </CardContent>
    </Card>
  );
}
