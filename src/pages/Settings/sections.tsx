import {
  Copy,
  Cpu,
  Download,
  ExternalLink,
  FileText,
  Key,
  Monitor,
  Moon,
  RefreshCw,
  Sun,
  Terminal,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { ProvidersSettings } from '@/components/settings/ProvidersSettings';
import { UpdateSettings } from '@/components/settings/UpdateSettings';
import type { LocalModelPresetId, LocalModelStatus } from '@/types/local-model';

const settingsCardClass =
  'border-border/70 bg-gradient-to-br from-background via-background to-blue-500/[0.04] shadow-[0_20px_60px_-36px_rgba(59,130,246,0.32)]';
const settingsPanelClass =
  'rounded-xl border border-border/60 bg-background/60 backdrop-blur-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]';

interface LanguageOption {
  code: string;
  label: string;
}

interface ControlUiInfo {
  url: string;
  token: string;
  port: number;
}

interface LocalModelPresetLike {
  id: LocalModelPresetId;
  model: string;
  minRamGb: number;
  recommendedRamGb: number;
}

interface AppearanceSettingsCardProps {
  theme: 'light' | 'dark' | 'system';
  language: string;
  languages: readonly LanguageOption[];
  onThemeChange: (theme: 'light' | 'dark' | 'system') => void;
  onLanguageChange: (language: string) => void;
}

export function AppearanceSettingsCard({
  theme,
  language,
  languages,
  onThemeChange,
  onLanguageChange,
}: AppearanceSettingsCardProps) {
  const { t } = useTranslation('settings');

  return (
    <Card className={settingsCardClass}>
      <CardHeader>
        <CardTitle>{t('appearance.title')}</CardTitle>
        <CardDescription>{t('appearance.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>{t('appearance.theme')}</Label>
          <div className="flex gap-2">
            <Button variant={theme === 'light' ? 'default' : 'outline'} size="sm" onClick={() => onThemeChange('light')}>
              <Sun className="mr-2 h-4 w-4" />
              {t('appearance.light')}
            </Button>
            <Button variant={theme === 'dark' ? 'default' : 'outline'} size="sm" onClick={() => onThemeChange('dark')}>
              <Moon className="mr-2 h-4 w-4" />
              {t('appearance.dark')}
            </Button>
            <Button variant={theme === 'system' ? 'default' : 'outline'} size="sm" onClick={() => onThemeChange('system')}>
              <Monitor className="mr-2 h-4 w-4" />
              {t('appearance.system')}
            </Button>
          </div>
        </div>
        <div className="space-y-2">
          <Label>{t('appearance.language')}</Label>
          <div className="flex gap-2">
            {languages.map((lang) => (
              <Button key={lang.code} variant={language === lang.code ? 'default' : 'outline'} size="sm" onClick={() => onLanguageChange(lang.code)}>
                {lang.label}
              </Button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function AiProvidersCard() {
  const { t } = useTranslation('settings');

  return (
    <Card className={settingsCardClass}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Key className="h-5 w-5" />
          {t('aiProviders.title')}
        </CardTitle>
        <CardDescription>{t('aiProviders.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <ProvidersSettings />
      </CardContent>
    </Card>
  );
}

interface LocalModelSettingsCardProps {
  localModelStatus: LocalModelStatus | null;
  presets: LocalModelPresetLike[];
  loadingLocalModelStatus: boolean;
  localModelAction: 'idle' | 'install' | 'enable:speed' | 'enable:balanced' | 'enable:quality';
  localModelLogs: string[];
  toEnableAction: (presetId: LocalModelPresetId) => 'enable:speed' | 'enable:balanced' | 'enable:quality';
  onRefresh: () => void;
  onInstallRuntime: () => void;
  onEnablePreset: (presetId: LocalModelPresetId) => void;
}

export function LocalModelSettingsCard({
  localModelStatus,
  presets,
  loadingLocalModelStatus,
  localModelAction,
  localModelLogs,
  toEnableAction,
  onRefresh,
  onInstallRuntime,
  onEnablePreset,
}: LocalModelSettingsCardProps) {
  const { t } = useTranslation('settings');

  return (
    <Card className={settingsCardClass}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cpu className="h-5 w-5" />
          {t('localModel.title')}
        </CardTitle>
        <CardDescription>{t('localModel.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={localModelStatus?.runtimeInstalled ? 'success' : 'secondary'}>
            {localModelStatus?.runtimeInstalled ? t('localModel.status.runtimeReady') : t('localModel.status.runtimeMissing')}
          </Badge>
          <Badge variant={localModelStatus?.serviceRunning ? 'success' : 'secondary'}>
            {localModelStatus?.serviceRunning ? t('localModel.status.serviceReady') : t('localModel.status.serviceMissing')}
          </Badge>
          {localModelStatus?.defaultProviderType === 'ollama' && localModelStatus?.defaultModel && (
            <Badge variant="success">{t('localModel.status.defaultModel', { model: localModelStatus.defaultModel })}</Badge>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          {localModelStatus?.runtimeVersion
            ? t('localModel.status.runtimeVersion', { version: localModelStatus.runtimeVersion })
            : t('localModel.status.runtimeVersionUnknown')}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={loadingLocalModelStatus || localModelAction !== 'idle'}>
            <RefreshCw className={`mr-2 h-4 w-4${loadingLocalModelStatus ? ' animate-spin' : ''}`} />
            {t('common:actions.refresh')}
          </Button>
          <Button variant="outline" size="sm" onClick={onInstallRuntime} disabled={localModelAction !== 'idle'}>
            <RefreshCw className={`mr-2 h-4 w-4${localModelAction === 'install' ? ' animate-spin' : ''}`} />
            {localModelAction === 'install' ? t('localModel.actions.installing') : t('localModel.actions.installRuntime')}
          </Button>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {presets.map((preset) => {
            const actionKey = toEnableAction(preset.id);
            const isBusy = localModelAction === actionKey;
            const isInstalled = !!localModelStatus?.installedModels.includes(preset.model);
            const isDefaultPreset = localModelStatus?.defaultProviderType === 'ollama' && localModelStatus?.defaultPresetId === preset.id;

            return (
              <div key={preset.id} className={cn(settingsPanelClass, 'space-y-3 p-3')}>
                <div>
                  <p className="font-medium">{t(`localModel.presets.${preset.id}.title`)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{t(`localModel.presets.${preset.id}.description`)}</p>
                </div>

                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">{t('localModel.labels.model')}</p>
                  <p className="break-all font-mono text-xs">{preset.model}</p>
                </div>

                <p className="text-xs text-muted-foreground">
                  {t('localModel.labels.ram', { min: preset.minRamGb, recommend: preset.recommendedRamGb })}
                </p>

                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={isInstalled ? 'success' : 'secondary'}>
                    {isInstalled ? t('localModel.status.modelReady') : t('localModel.status.modelMissing')}
                  </Badge>
                  {isDefaultPreset && <Badge variant="success">{t('localModel.status.defaultPreset')}</Badge>}
                </div>

                <Button size="sm" className="w-full" onClick={() => onEnablePreset(preset.id)} disabled={localModelAction !== 'idle'}>
                  <RefreshCw className={`mr-2 h-4 w-4${isBusy ? ' animate-spin' : ''}`} />
                  {isBusy ? t('localModel.actions.enabling') : (isDefaultPreset ? t('localModel.actions.enabled') : t('localModel.actions.enable'))}
                </Button>
              </div>
            );
          })}
        </div>

        {localModelLogs.length > 0 && (
          <div className={cn(settingsPanelClass, 'space-y-2 bg-black/10 p-3 dark:bg-black/40')}>
            <p className="text-sm font-medium">{t('localModel.logs.title')}</p>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded bg-background/50 p-3 font-mono text-xs text-muted-foreground">
              {localModelLogs.join('\n')}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface GatewaySettingsCardProps {
  gatewayState: string;
  gatewayPort: number;
  gatewayAutoStart: boolean;
  proxyEnabledDraft: boolean;
  proxyServerDraft: string;
  proxyHttpServerDraft: string;
  proxyHttpsServerDraft: string;
  proxyAllServerDraft: string;
  proxyBypassRulesDraft: string;
  savingProxy: boolean;
  devModeUnlocked: boolean;
  showLogs: boolean;
  logContent: string;
  onRestartGateway: () => void;
  onShowLogs: () => void;
  onCloseLogs: () => void;
  onOpenLogDir: () => void;
  onGatewayAutoStartChange: (value: boolean) => void;
  onProxyEnabledChange: (value: boolean) => void;
  onProxyServerChange: (value: string) => void;
  onProxyHttpServerChange: (value: string) => void;
  onProxyHttpsServerChange: (value: string) => void;
  onProxyAllServerChange: (value: string) => void;
  onProxyBypassRulesChange: (value: string) => void;
  onSaveProxySettings: () => void;
}

export function GatewaySettingsCard(props: GatewaySettingsCardProps) {
  const { t } = useTranslation(['settings', 'chat', 'common']);

  return (
    <Card className={settingsCardClass}>
      <CardHeader>
        <CardTitle>{t('settings:gateway.title')}</CardTitle>
        <CardDescription>{t('settings:gateway.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Label>{t('settings:gateway.status')}</Label>
            <p className="text-sm text-muted-foreground">{t('settings:gateway.port')}: {props.gatewayPort}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={props.gatewayState === 'running' ? 'success' : props.gatewayState === 'error' ? 'destructive' : 'secondary'}>
              {props.gatewayState}
            </Badge>
            <Button variant="outline" size="sm" onClick={props.onRestartGateway}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t('common:actions.restart')}
            </Button>
            <Button variant="outline" size="sm" onClick={props.onShowLogs}>
              <FileText className="mr-2 h-4 w-4" />
              {t('settings:gateway.logs')}
            </Button>
          </div>
        </div>

        {props.showLogs && (
          <div className={cn(settingsPanelClass, 'mt-4 bg-black/10 p-4 dark:bg-black/40')}>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium">{t('settings:gateway.appLogs')}</p>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={props.onOpenLogDir}>
                  <ExternalLink className="mr-1 h-3 w-3" />
                  {t('settings:gateway.openFolder')}
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={props.onCloseLogs}>
                  {t('common:actions.close')}
                </Button>
              </div>
            </div>
            <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded bg-background/50 p-3 font-mono text-xs text-muted-foreground">
              {props.logContent || t('chat:noLogs')}
            </pre>
          </div>
        )}

        <Separator />

        <div className="flex items-center justify-between">
          <div>
            <Label>{t('settings:gateway.autoStart')}</Label>
            <p className="text-sm text-muted-foreground">{t('settings:gateway.autoStartDesc')}</p>
          </div>
          <Switch checked={props.gatewayAutoStart} onCheckedChange={props.onGatewayAutoStartChange} />
        </div>

        <Separator />

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>{t('settings:gateway.proxyTitle')}</Label>
              <p className="text-sm text-muted-foreground">{t('settings:gateway.proxyDesc')}</p>
            </div>
            <Switch checked={props.proxyEnabledDraft} onCheckedChange={props.onProxyEnabledChange} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="proxy-server">{t('settings:gateway.proxyServer')}</Label>
            <Input id="proxy-server" value={props.proxyServerDraft} onChange={(event) => props.onProxyServerChange(event.target.value)} placeholder="http://127.0.0.1:7890" />
            <p className="text-xs text-muted-foreground">{t('settings:gateway.proxyServerHelp')}</p>
          </div>

          {props.devModeUnlocked && (
            <>
              <div className="space-y-2">
                <Label htmlFor="proxy-http-server">{t('settings:gateway.proxyHttpServer')}</Label>
                <Input id="proxy-http-server" value={props.proxyHttpServerDraft} onChange={(event) => props.onProxyHttpServerChange(event.target.value)} placeholder={props.proxyServerDraft || 'http://127.0.0.1:7890'} />
                <p className="text-xs text-muted-foreground">{t('settings:gateway.proxyHttpServerHelp')}</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="proxy-https-server">{t('settings:gateway.proxyHttpsServer')}</Label>
                <Input id="proxy-https-server" value={props.proxyHttpsServerDraft} onChange={(event) => props.onProxyHttpsServerChange(event.target.value)} placeholder={props.proxyServerDraft || 'http://127.0.0.1:7890'} />
                <p className="text-xs text-muted-foreground">{t('settings:gateway.proxyHttpsServerHelp')}</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="proxy-all-server">{t('settings:gateway.proxyAllServer')}</Label>
                <Input id="proxy-all-server" value={props.proxyAllServerDraft} onChange={(event) => props.onProxyAllServerChange(event.target.value)} placeholder={props.proxyServerDraft || 'socks5://127.0.0.1:7891'} />
                <p className="text-xs text-muted-foreground">{t('settings:gateway.proxyAllServerHelp')}</p>
              </div>
            </>
          )}

          <div className="space-y-2">
            <Label htmlFor="proxy-bypass">{t('settings:gateway.proxyBypass')}</Label>
            <Input id="proxy-bypass" value={props.proxyBypassRulesDraft} onChange={(event) => props.onProxyBypassRulesChange(event.target.value)} placeholder="<local>;localhost;127.0.0.1;::1" />
            <p className="text-xs text-muted-foreground">{t('settings:gateway.proxyBypassHelp')}</p>
          </div>

          <div className={cn(settingsPanelClass, 'flex items-center justify-between gap-3 p-3')}>
            <p className="text-sm text-muted-foreground">{t('settings:gateway.proxyRestartNote')}</p>
            <Button variant="outline" onClick={props.onSaveProxySettings} disabled={props.savingProxy}>
              <RefreshCw className={`mr-2 h-4 w-4${props.savingProxy ? ' animate-spin' : ''}`} />
              {props.savingProxy ? t('common:status.saving') : t('common:actions.save')}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface UpdatesSettingsCardProps {
  autoCheckUpdate: boolean;
  autoDownloadUpdate: boolean;
  onAutoCheckChange: (value: boolean) => void;
  onAutoDownloadChange: (value: boolean) => void;
}

export function UpdatesSettingsCard({ autoCheckUpdate, autoDownloadUpdate, onAutoCheckChange, onAutoDownloadChange }: UpdatesSettingsCardProps) {
  const { t } = useTranslation('settings');

  return (
    <Card className={settingsCardClass}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Download className="h-5 w-5" />
          {t('updates.title')}
        </CardTitle>
        <CardDescription>{t('updates.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <UpdateSettings />

        <Separator />

        <div className="flex items-center justify-between">
          <div>
            <Label>{t('updates.autoCheck')}</Label>
            <p className="text-sm text-muted-foreground">{t('updates.autoCheckDesc')}</p>
          </div>
          <Switch checked={autoCheckUpdate} onCheckedChange={onAutoCheckChange} />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label>{t('updates.autoDownload')}</Label>
            <p className="text-sm text-muted-foreground">{t('updates.autoDownloadDesc')}</p>
          </div>
          <Switch checked={autoDownloadUpdate} onCheckedChange={onAutoDownloadChange} />
        </div>
      </CardContent>
    </Card>
  );
}

interface AdvancedSettingsCardProps {
  devModeUnlocked: boolean;
  onDevModeChange: (value: boolean) => void;
}

export function AdvancedSettingsCard({ devModeUnlocked, onDevModeChange }: AdvancedSettingsCardProps) {
  const { t } = useTranslation('settings');

  return (
    <Card className={settingsCardClass}>
      <CardHeader>
        <CardTitle>{t('advanced.title')}</CardTitle>
        <CardDescription>{t('advanced.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Label>{t('advanced.devMode')}</Label>
            <p className="text-sm text-muted-foreground">{t('advanced.devModeDesc')}</p>
          </div>
          <Switch checked={devModeUnlocked} onCheckedChange={onDevModeChange} />
        </div>
      </CardContent>
    </Card>
  );
}

interface DeveloperSettingsCardProps {
  devModeUnlocked: boolean;
  showCliTools: boolean;
  isWindows: boolean;
  controlUiInfo: ControlUiInfo | null;
  openclawCliCommand: string;
  openclawCliError: string | null;
  onOpenDevConsole: () => void;
  onRefreshControlUiInfo: () => void;
  onCopyGatewayToken: () => void;
  onCopyCliCommand: () => void;
}

export function DeveloperSettingsCard(props: DeveloperSettingsCardProps) {
  const { t } = useTranslation(['settings', 'common']);

  if (!props.devModeUnlocked) return null;

  return (
    <Card className={settingsCardClass}>
      <CardHeader>
        <CardTitle>{t('settings:developer.title')}</CardTitle>
        <CardDescription>{t('settings:developer.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>{t('settings:developer.console')}</Label>
          <p className="text-sm text-muted-foreground">{t('settings:developer.consoleDesc')}</p>
          <Button variant="outline" onClick={props.onOpenDevConsole}>
            <Terminal className="mr-2 h-4 w-4" />
            {t('settings:developer.openConsole')}
            <ExternalLink className="ml-2 h-3 w-3" />
          </Button>
          <p className="text-xs text-muted-foreground">{t('settings:developer.consoleNote')}</p>
          <div className="space-y-2 pt-2">
            <Label>{t('settings:developer.gatewayToken')}</Label>
            <p className="text-sm text-muted-foreground">{t('settings:developer.gatewayTokenDesc')}</p>
            <div className="flex gap-2">
              <Input readOnly value={props.controlUiInfo?.token || ''} placeholder={t('settings:developer.tokenUnavailable')} className="font-mono" />
              <Button type="button" variant="outline" onClick={props.onRefreshControlUiInfo} disabled={!props.devModeUnlocked}>
                <RefreshCw className="mr-2 h-4 w-4" />
                {t('common:actions.load')}
              </Button>
              <Button type="button" variant="outline" onClick={props.onCopyGatewayToken} disabled={!props.controlUiInfo?.token}>
                <Copy className="mr-2 h-4 w-4" />
                {t('common:actions.copy')}
              </Button>
            </div>
          </div>
        </div>
        {props.showCliTools && (
          <>
            <Separator />
            <div className="space-y-2">
              <Label>{t('settings:developer.cli')}</Label>
              <p className="text-sm text-muted-foreground">{t('settings:developer.cliDesc')}</p>
              {props.isWindows && <p className="text-xs text-muted-foreground">{t('settings:developer.cliPowershell')}</p>}
              <div className="flex gap-2">
                <Input readOnly value={props.openclawCliCommand} placeholder={props.openclawCliError || t('settings:developer.cmdUnavailable')} className="font-mono" />
                <Button type="button" variant="outline" onClick={props.onCopyCliCommand} disabled={!props.openclawCliCommand}>
                  <Copy className="mr-2 h-4 w-4" />
                  {t('common:actions.copy')}
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface AboutCardProps {
  currentVersion: string;
}

export function AboutCard({ currentVersion }: AboutCardProps) {
  const { t } = useTranslation('settings');

  return (
    <Card className={settingsCardClass}>
      <CardHeader>
        <CardTitle>{t('about.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        <p>
          <strong>{t('about.appName')}</strong> - {t('about.tagline')}
        </p>
        <p>{t('about.basedOn')}</p>
        <p>{t('about.version', { version: currentVersion })}</p>
        <div className="flex gap-4 pt-2">
          <Button variant="link" className="h-auto p-0" onClick={() => window.electron.openExternal('https://claw-x.com')}>
            {t('about.docs')}
          </Button>
          <Button variant="link" className="h-auto p-0" onClick={() => window.electron.openExternal('https://github.com/ValueCell-ai/Monoclaw')}>
            {t('about.github')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
