import {
  Copy,
  FolderOpen,
  PhoneCall,
  Play,
  RefreshCw,
  Square,
  Stethoscope,
  Wrench,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { controlPanelClass, controlSurfaceCardClass } from '@/pages/control/styles';
import type { OpenClawDoctorResult, OpenClawStatusInfo, VoiceCallDefaultMode } from './types';

const runtimeCardClass = controlSurfaceCardClass;
const runtimePanelClass = controlPanelClass;

interface RuntimePathFieldProps {
  label: string;
  value: string;
  placeholder: string;
  onOpen: () => void;
  onCopy: () => void;
}

function RuntimePathField({ label, value, placeholder, onOpen, onCopy }: RuntimePathFieldProps) {
  const { t } = useTranslation(['settings', 'common']);

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input readOnly value={value} placeholder={placeholder} className="font-mono bg-background/60" />
        <Button type="button" variant="outline" onClick={onOpen} disabled={!value}>
          <FolderOpen className="mr-2 h-4 w-4" />
          {t('settings:openclawManager.openFolder')}
        </Button>
        <Button type="button" variant="outline" onClick={onCopy} disabled={!value}>
          <Copy className="mr-2 h-4 w-4" />
          {t('common:actions.copy')}
        </Button>
      </div>
    </div>
  );
}

interface OpenClawPackageCardProps {
  openclawStatus: OpenClawStatusInfo | null;
  openclawConfigDir: string;
  openclawSkillsDir: string;
  loadingOpenclawMeta: boolean;
  onRefresh: () => void;
  onOpenPath: (targetPath: string) => void;
  onCopyPath: (targetPath: string) => void;
}

export function OpenClawPackageCard({
  openclawStatus,
  openclawConfigDir,
  openclawSkillsDir,
  loadingOpenclawMeta,
  onRefresh,
  onOpenPath,
  onCopyPath,
}: OpenClawPackageCardProps) {
  const { t } = useTranslation('settings');

  return (
    <Card className={runtimeCardClass}>
      <CardHeader>
        <CardTitle>{t('openclawManager.openclawSectionTitle')}</CardTitle>
        <CardDescription>{t('openclawManager.openclawSectionDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label>{t('openclawManager.packageStatus')}</Label>
            <p className="text-sm text-muted-foreground">
              {openclawStatus?.version
                ? t('openclawManager.version', { version: openclawStatus.version })
                : t('openclawManager.versionUnknown')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={openclawStatus?.packageExists && openclawStatus?.isBuilt ? 'success' : 'destructive'}>
              {openclawStatus?.packageExists
                ? (openclawStatus?.isBuilt
                  ? t('openclawManager.packageReady')
                  : t('openclawManager.packageBroken'))
                : t('openclawManager.packageMissing')}
            </Badge>
            <Button variant="outline" size="sm" onClick={onRefresh} disabled={loadingOpenclawMeta}>
              <RefreshCw className={`mr-2 h-4 w-4${loadingOpenclawMeta ? ' animate-spin' : ''}`} />
              {t('common:actions.refresh')}
            </Button>
          </div>
        </div>

        <RuntimePathField
          label={t('openclawManager.packageDir')}
          value={openclawStatus?.dir || ''}
          placeholder={t('openclawManager.pathUnavailable')}
          onOpen={() => onOpenPath(openclawStatus?.dir || '')}
          onCopy={() => onCopyPath(openclawStatus?.dir || '')}
        />

        <RuntimePathField
          label={t('openclawManager.configDir')}
          value={openclawConfigDir}
          placeholder={t('openclawManager.pathUnavailable')}
          onOpen={() => onOpenPath(openclawConfigDir)}
          onCopy={() => onCopyPath(openclawConfigDir)}
        />

        <RuntimePathField
          label={t('openclawManager.skillsDir')}
          value={openclawSkillsDir}
          placeholder={t('openclawManager.pathUnavailable')}
          onOpen={() => onOpenPath(openclawSkillsDir)}
          onCopy={() => onCopyPath(openclawSkillsDir)}
        />
      </CardContent>
    </Card>
  );
}

interface GatewayRuntimeControlsCardProps {
  gatewayState: string;
  gatewayLastError: string | null;
  onStartGateway: () => void;
  onStopGateway: () => void;
  onRestartGateway: () => void;
}

export function GatewayRuntimeControlsCard({
  gatewayState,
  gatewayLastError,
  onStartGateway,
  onStopGateway,
  onRestartGateway,
}: GatewayRuntimeControlsCardProps) {
  const { t } = useTranslation('settings');

  return (
    <div className="space-y-2">
      <Label>{t('openclawManager.gatewayControl')}</Label>
      <p className="text-sm text-muted-foreground">{t('openclawManager.gatewayControlDesc')}</p>
      <div className={cn(runtimePanelClass, 'flex flex-wrap items-center gap-2 p-3')}>
        <Badge variant={gatewayState === 'running' ? 'success' : gatewayState === 'error' ? 'destructive' : 'secondary'}>
          {gatewayState}
        </Badge>
        <Button type="button" variant="outline" size="sm" onClick={onStartGateway} disabled={gatewayState === 'running' || gatewayState === 'starting'}>
          <Play className="mr-2 h-4 w-4" />
          {t('openclawManager.startGateway')}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onStopGateway} disabled={gatewayState === 'stopped'}>
          <Square className="mr-2 h-4 w-4" />
          {t('openclawManager.stopGateway')}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onRestartGateway} disabled={gatewayState === 'starting'}>
          <RefreshCw className="mr-2 h-4 w-4" />
          {t('openclawManager.restartGateway')}
        </Button>
      </div>
      {gatewayLastError && <p className="text-xs text-destructive">{gatewayLastError}</p>}
    </div>
  );
}

interface VoiceCallSettingsCardProps {
  voiceCallLoading: boolean;
  voiceCallSaving: boolean;
  voiceCallTesting: boolean;
  voiceCallEnabled: boolean;
  voiceCallProvider: string;
  voiceCallFromNumber: string;
  voiceCallToNumber: string;
  voiceCallDefaultMode: VoiceCallDefaultMode;
  voiceCallResult: unknown | null;
  onVoiceCallEnabledChange: (checked: boolean) => void;
  onVoiceCallProviderChange: (value: string) => void;
  onVoiceCallFromNumberChange: (value: string) => void;
  onVoiceCallToNumberChange: (value: string) => void;
  onVoiceCallDefaultModeChange: (value: VoiceCallDefaultMode) => void;
  onSave: () => void;
  onMockTest: () => void;
}

export function VoiceCallSettingsCard({
  voiceCallLoading,
  voiceCallSaving,
  voiceCallTesting,
  voiceCallEnabled,
  voiceCallProvider,
  voiceCallFromNumber,
  voiceCallToNumber,
  voiceCallDefaultMode,
  voiceCallResult,
  onVoiceCallEnabledChange,
  onVoiceCallProviderChange,
  onVoiceCallFromNumberChange,
  onVoiceCallToNumberChange,
  onVoiceCallDefaultModeChange,
  onSave,
  onMockTest,
}: VoiceCallSettingsCardProps) {
  const { t } = useTranslation('settings');
  const disabled = voiceCallLoading || voiceCallSaving || voiceCallTesting;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <PhoneCall className="h-4 w-4" />
        <Label>{t('openclawManager.voiceCallTitle')}</Label>
      </div>
      <p className="text-sm text-muted-foreground">{t('openclawManager.voiceCallDescription')}</p>
      <p className="text-xs text-muted-foreground">{t('openclawManager.voiceCallMockHint')}</p>

      <div className={cn(runtimePanelClass, 'flex items-center justify-between px-3 py-2')}>
        <div>
          <p className="text-sm font-medium">{t('openclawManager.voiceCallEnabled')}</p>
          <p className="text-xs text-muted-foreground">{t('openclawManager.voiceCallResult')}</p>
        </div>
        <Switch checked={voiceCallEnabled} onCheckedChange={onVoiceCallEnabledChange} disabled={disabled} />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <Label>{t('openclawManager.voiceCallProvider')}</Label>
          <Select value={voiceCallProvider} onChange={(event) => onVoiceCallProviderChange(event.target.value)} disabled={disabled}>
            <option value="mock">{t('openclawManager.voiceProviderMock')}</option>
            <option value="twilio">{t('openclawManager.voiceProviderTwilio')}</option>
            <option value="telnyx">{t('openclawManager.voiceProviderTelnyx')}</option>
            <option value="plivo">{t('openclawManager.voiceProviderPlivo')}</option>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>{t('openclawManager.voiceCallMode')}</Label>
          <Select value={voiceCallDefaultMode} onChange={(event) => onVoiceCallDefaultModeChange(event.target.value === 'conversation' ? 'conversation' : 'notify')} disabled={disabled}>
            <option value="notify">notify</option>
            <option value="conversation">conversation</option>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>{t('openclawManager.voiceCallFrom')}</Label>
          <Input value={voiceCallFromNumber} onChange={(event) => onVoiceCallFromNumberChange(event.target.value)} placeholder="+15550001234" disabled={disabled} />
        </div>

        <div className="space-y-2">
          <Label>{t('openclawManager.voiceCallTo')}</Label>
          <Input value={voiceCallToNumber} onChange={(event) => onVoiceCallToNumberChange(event.target.value)} placeholder="+15550005678" disabled={disabled} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onSave} disabled={disabled}>
          {voiceCallSaving ? t('openclawManager.voiceCallSaving') : t('openclawManager.voiceCallSave')}
        </Button>

        <Button type="button" variant="outline" size="sm" onClick={onMockTest} disabled={disabled || voiceCallProvider !== 'mock'}>
          {voiceCallTesting ? t('openclawManager.voiceCallTesting') : t('openclawManager.voiceCallMockTest')}
        </Button>
      </div>

      {voiceCallResult !== null && (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border border-border/60 bg-black/10 p-3 font-mono text-xs text-muted-foreground dark:bg-black/40">
          {JSON.stringify(voiceCallResult, null, 2) ?? ''}
        </pre>
      )}
    </div>
  );
}

interface DoctorCardProps {
  doctorRunning: 'none' | 'check' | 'fix';
  doctorResult: OpenClawDoctorResult | null;
  onRunCheck: () => void;
  onRunFix: () => void;
}

export function DoctorCard({ doctorRunning, doctorResult, onRunCheck, onRunFix }: DoctorCardProps) {
  const { t } = useTranslation('settings');

  return (
    <div className="space-y-2">
      <Label>{t('openclawManager.doctorTitle')}</Label>
      <p className="text-sm text-muted-foreground">{t('openclawManager.doctorDescription')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onRunCheck} disabled={doctorRunning !== 'none'}>
          <Stethoscope className={`mr-2 h-4 w-4${doctorRunning === 'check' ? ' animate-pulse' : ''}`} />
          {doctorRunning === 'check' ? t('openclawManager.doctorChecking') : t('openclawManager.doctorCheck')}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onRunFix} disabled={doctorRunning !== 'none'}>
          <Wrench className={`mr-2 h-4 w-4${doctorRunning === 'fix' ? ' animate-pulse' : ''}`} />
          {doctorRunning === 'fix' ? t('openclawManager.doctorFixing') : t('openclawManager.doctorFix')}
        </Button>
      </div>

      {doctorResult && (
        <div className={cn(runtimePanelClass, 'space-y-2 p-3')}>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant={doctorResult.success ? 'success' : 'destructive'}>
              {doctorResult.success ? t('openclawManager.doctorSuccess') : t('openclawManager.doctorFailed')}
            </Badge>
            <span className="text-muted-foreground">
              {t('openclawManager.doctorMeta', { code: String(doctorResult.code ?? 'null'), durationMs: doctorResult.durationMs })}
            </span>
            {doctorResult.timedOut && <span className="text-amber-500">{t('openclawManager.doctorTimeout')}</span>}
          </div>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-black/10 p-3 font-mono text-xs text-muted-foreground dark:bg-black/40">
            {doctorResult.output}
          </pre>
        </div>
      )}
    </div>
  );
}

interface RuntimeControlsCardProps {
  gatewayState: string;
  gatewayLastError: string | null;
  onStartGateway: () => void;
  onStopGateway: () => void;
  onRestartGateway: () => void;
  voiceCallLoading: boolean;
  voiceCallSaving: boolean;
  voiceCallTesting: boolean;
  voiceCallEnabled: boolean;
  voiceCallProvider: string;
  voiceCallFromNumber: string;
  voiceCallToNumber: string;
  voiceCallDefaultMode: VoiceCallDefaultMode;
  voiceCallResult: unknown | null;
  onVoiceCallEnabledChange: (checked: boolean) => void;
  onVoiceCallProviderChange: (value: string) => void;
  onVoiceCallFromNumberChange: (value: string) => void;
  onVoiceCallToNumberChange: (value: string) => void;
  onVoiceCallDefaultModeChange: (value: VoiceCallDefaultMode) => void;
  onSaveVoiceCall: () => void;
  onRunVoiceCallMockTest: () => void;
  doctorRunning: 'none' | 'check' | 'fix';
  doctorResult: OpenClawDoctorResult | null;
  onRunDoctorCheck: () => void;
  onRunDoctorFix: () => void;
}

export function RuntimeControlsCard(props: RuntimeControlsCardProps) {
  const { t } = useTranslation('settings');

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('openclawManager.runtimeControlsTitle')}</CardTitle>
        <CardDescription>{t('openclawManager.runtimeControlsDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <GatewayRuntimeControlsCard
          gatewayState={props.gatewayState}
          gatewayLastError={props.gatewayLastError}
          onStartGateway={props.onStartGateway}
          onStopGateway={props.onStopGateway}
          onRestartGateway={props.onRestartGateway}
        />

        <Separator />

        <VoiceCallSettingsCard
          voiceCallLoading={props.voiceCallLoading}
          voiceCallSaving={props.voiceCallSaving}
          voiceCallTesting={props.voiceCallTesting}
          voiceCallEnabled={props.voiceCallEnabled}
          voiceCallProvider={props.voiceCallProvider}
          voiceCallFromNumber={props.voiceCallFromNumber}
          voiceCallToNumber={props.voiceCallToNumber}
          voiceCallDefaultMode={props.voiceCallDefaultMode}
          voiceCallResult={props.voiceCallResult}
          onVoiceCallEnabledChange={props.onVoiceCallEnabledChange}
          onVoiceCallProviderChange={props.onVoiceCallProviderChange}
          onVoiceCallFromNumberChange={props.onVoiceCallFromNumberChange}
          onVoiceCallToNumberChange={props.onVoiceCallToNumberChange}
          onVoiceCallDefaultModeChange={props.onVoiceCallDefaultModeChange}
          onSave={props.onSaveVoiceCall}
          onMockTest={props.onRunVoiceCallMockTest}
        />

        <Separator />

        <DoctorCard
          doctorRunning={props.doctorRunning}
          doctorResult={props.doctorResult}
          onRunCheck={props.onRunDoctorCheck}
          onRunFix={props.onRunDoctorFix}
        />
      </CardContent>
    </Card>
  );
}
