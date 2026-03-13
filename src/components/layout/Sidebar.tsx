/**
 * Sidebar Component
 * Navigation shell split into Workspace vs Control Plane.
 */
import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Cpu,
  Database,
  ExternalLink,
  Home,
  MessageSquare,
  Plus,
  Puzzle,
  Radio,
  Settings,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trash2,
  Users2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';
import { useChatStore } from '@/stores/chat';
import { useTeamStore } from '@/stores/team';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useTranslation } from 'react-i18next';
import { APP_ROUTES, getShellEntry, isChatPath, isTeamsPath, resolveShellMode, type ShellMode } from '@/lib/navigation';
import { useResolvedTheme } from '@/hooks/useResolvedTheme';

interface NavItemProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  badge?: string;
  collapsed?: boolean;
  onClick?: () => void;
}

function NavItem({ to, icon, label, badge, collapsed, onClick }: NavItemProps) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
          'hover:bg-accent hover:text-accent-foreground',
          isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
          collapsed && 'justify-center px-2'
        )
      }
    >
      {icon}
      {!collapsed && (
        <>
          <span className="flex-1">{label}</span>
          {badge && (
            <Badge variant="secondary" className="ml-auto">
              {badge}
            </Badge>
          )}
        </>
      )}
    </NavLink>
  );
}

interface ModeButtonProps {
  active: boolean;
  collapsed: boolean;
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}

function ModeButton({ active, collapsed, icon, title, description, onClick }: ModeButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full rounded-2xl border text-left transition-all',
        collapsed ? 'flex items-center justify-center px-0 py-3' : 'px-3 py-3',
        active
          ? 'border-primary/40 bg-primary/10 text-foreground shadow-[0_12px_30px_-18px_hsl(var(--primary)/0.55)]'
          : 'border-border/60 bg-background/55 text-muted-foreground hover:border-border hover:bg-accent/40 hover:text-accent-foreground'
      )}
    >
      <div className={cn('flex items-center gap-3', collapsed && 'justify-center')}>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-background/70 text-primary">{icon}</span>
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{title}</p>
            <p className="truncate text-xs text-muted-foreground">{description}</p>
          </div>
        )}
      </div>
    </button>
  );
}

export function Sidebar() {
  const resolvedTheme = useResolvedTheme();
  const sidebarCollapsed = useSettingsStore((state) => state.sidebarCollapsed);
  const setSidebarCollapsed = useSettingsStore((state) => state.setSidebarCollapsed);
  const devModeUnlocked = useSettingsStore((state) => state.devModeUnlocked);
  const initTeams = useTeamStore((state) => state.init);
  const teams = useTeamStore((state) => state.teams);
  const runtimes = useTeamStore((state) => state.runtimes);
  const teamLoading = useTeamStore((state) => state.loading);
  const selectTeam = useTeamStore((state) => state.selectTeam);

  const sessions = useChatStore((s) => s.sessions);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const sessionLabels = useChatStore((s) => s.sessionLabels);
  const sessionLastActivity = useChatStore((s) => s.sessionLastActivity);
  const sessionLastAssistantAt = useChatStore((s) => s.sessionLastAssistantAt);
  const sessionLastSeenAt = useChatStore((s) => s.sessionLastSeenAt);
  const sessionRuntimeState = useChatStore((s) => s.sessionRuntimeState);
  const switchSession = useChatStore((s) => s.switchSession);
  const markSessionSeen = useChatStore((s) => s.markSessionSeen);
  const newSession = useChatStore((s) => s.newSession);
  const deleteSession = useChatStore((s) => s.deleteSession);

  const navigate = useNavigate();
  const location = useLocation();
  const shellMode = resolveShellMode(location.pathname) ?? 'workspace';
  const isOnChat = isChatPath(location.pathname);
  const isOnTeams = isTeamsPath(location.pathname);

  const mainSessions = sessions.filter((s) => s.key.endsWith(':main'));
  const otherSessions = sessions.filter((s) => !s.key.endsWith(':main'));

  const getSessionSuffix = (sessionKey: string): string => {
    if (!sessionKey.startsWith('agent:')) return sessionKey;
    const parts = sessionKey.split(':');
    if (parts.length < 3) return sessionKey;
    return parts.slice(2).join(':');
  };

  const isGenericDisplayName = (name?: string): boolean => name?.trim().toLowerCase() === 'monoclaw';
  const isMachineSessionName = (name?: string): boolean => {
    if (!name) return false;
    const normalized = name.trim().toLowerCase();
    if (!normalized) return false;
    if (normalized.startsWith('agent:') && normalized.includes(':session')) return true;
    return /^session[-:_]/.test(normalized);
  };

  const getSessionLabel = (key: string, displayName?: string, label?: string) => {
    const direct = sessionLabels[key];
    if (direct) return direct;

    const suffix = getSessionSuffix(key);
    if (suffix !== key && sessionLabels[suffix]) {
      return sessionLabels[suffix];
    }

    if (!key.startsWith('agent:')) {
      const aliased = Object.entries(sessionLabels).find(([sessionKey]) => getSessionSuffix(sessionKey) === key)?.[1];
      if (aliased) return aliased;
    }

    const backendLabel = (
      label
      && !isGenericDisplayName(label)
      && !isMachineSessionName(label)
    ) ? label : undefined;
    const backendDisplay = (
      displayName
      && !isGenericDisplayName(displayName)
      && !isMachineSessionName(displayName)
    ) ? displayName : undefined;

    if (key.endsWith(':main')) {
      return backendLabel ?? backendDisplay ?? key;
    }
    const humanSuffix = suffix && !isMachineSessionName(suffix) ? suffix : undefined;
    if (backendLabel || backendDisplay || humanSuffix) {
      return backendLabel ?? backendDisplay ?? humanSuffix!;
    }
    if (!isMachineSessionName(key)) return key;
    return t('sidebar.newChat', 'New Chat');
  };

  const openDevConsole = async () => {
    try {
      const result = await window.electron.ipcRenderer.invoke('gateway:getControlUiUrl') as {
        success: boolean;
        url?: string;
        error?: string;
      };
      if (result.success && result.url) {
        window.electron.openExternal(result.url);
      } else {
        console.error('Failed to get Dev Console URL:', result.error);
      }
    } catch (err) {
      console.error('Error opening Dev Console:', err);
    }
  };

  const { t } = useTranslation();
  const [sessionToDelete, setSessionToDelete] = useState<{ key: string; label: string } | null>(null);
  const [chatExpanded, setChatExpanded] = useState(true);
  const [teamsExpanded, setTeamsExpanded] = useState(true);
  const chatSectionExpanded = chatExpanded || isOnChat;
  const teamsSectionExpanded = teamsExpanded || isOnTeams;

  useEffect(() => {
    void initTeams().catch(() => {});
  }, [initTeams]);

  const workspaceNavItems = [
    { to: APP_ROUTES.workspace.skills, icon: <Puzzle className="h-5 w-5" />, label: t('sidebar.skills') },
    { to: APP_ROUTES.workspace.automation, icon: <Clock3 className="h-5 w-5" />, label: t('sidebar.automation', 'Automation') },
  ];

  const controlNavItems = [
    { to: APP_ROUTES.control.overview, icon: <Home className="h-5 w-5" />, label: t('sidebar.overview', 'Overview') },
    { to: APP_ROUTES.control.monoclawCore, icon: <Database className="h-5 w-5" />, label: t('sidebar.monoclawCore') },
    { to: APP_ROUTES.control.runtimeManager, icon: <Cpu className="h-5 w-5" />, label: t('sidebar.runtimeManager', 'Runtime Manager') },
    { to: APP_ROUTES.control.channels, icon: <Radio className="h-5 w-5" />, label: t('sidebar.channels') },
    { to: APP_ROUTES.control.ops, icon: <ShieldCheck className="h-5 w-5" />, label: t('sidebar.intelligentOps') },
    { to: APP_ROUTES.control.settings, icon: <Settings className="h-5 w-5" />, label: t('sidebar.settings') },
  ];

  const teamStatusDotClass = (status: string) => {
    if (status === 'running') return 'bg-green-500';
    if (status === 'starting' || status === 'hibernating') return 'bg-amber-500';
    if (status === 'error') return 'bg-red-500';
    return 'bg-slate-400';
  };

  const openTeamRoute = (teamId: string) => {
    selectTeam(teamId);
    navigate(APP_ROUTES.workspace.team(teamId));
  };

  const switchShellMode = (mode: ShellMode) => {
    navigate(getShellEntry(mode));
  };

  const createNewConversation = () => {
    newSession();
    navigate(APP_ROUTES.workspace.chat);
  };

  const createNewTeam = () => {
    navigate(`${APP_ROUTES.workspace.teams}?create=1`);
  };

  const sortedSessions = [...mainSessions, ...[...otherSessions].sort((a, b) =>
    (sessionLastActivity[b.key] ?? 0) - (sessionLastActivity[a.key] ?? 0)
  )];

  const conversationDotClass = (sessionKey: string) => {
    const state = sessionRuntimeState[sessionKey] ?? 'idle';
    const unread = (sessionLastAssistantAt[sessionKey] ?? 0) > (sessionLastSeenAt[sessionKey] ?? 0);
    if (state === 'running') return 'bg-green-500 animate-pulse';
    if (state === 'error') return 'bg-red-500';
    if (unread) return 'bg-green-500';
    return 'bg-slate-400';
  };

  const conversationDotLabel = (sessionKey: string) => {
    const state = sessionRuntimeState[sessionKey] ?? 'idle';
    const unread = (sessionLastAssistantAt[sessionKey] ?? 0) > (sessionLastSeenAt[sessionKey] ?? 0);
    if (state === 'running') return t('status.running', { ns: 'teams', defaultValue: 'Running' });
    if (state === 'error') return t('status.error', { ns: 'teams', defaultValue: 'Error' });
    if (unread) return t('detail.unread', { ns: 'teams', defaultValue: 'Unread' });
    return t('detail.read', { ns: 'teams', defaultValue: 'Read' });
  };

  return (
    <aside
      className={cn(
        'flex shrink-0 flex-col border-r backdrop-blur-xl transition-all duration-300',
        resolvedTheme === 'dark'
          ? 'border-cyan-500/10 bg-slate-950/48'
          : 'border-indigo-200/70 bg-white/78 shadow-[18px_0_45px_-32px_rgba(99,102,241,0.2)]',
        sidebarCollapsed ? 'w-16' : 'w-72'
      )}
    >
      <div className="border-b border-border/70 p-2">
        <div className={cn('space-y-2', sidebarCollapsed && 'space-y-1.5')}>
          <ModeButton
            active={shellMode === 'workspace'}
            collapsed={sidebarCollapsed}
            icon={<Sparkles className="h-4 w-4" />}
            title={t('sidebar.workspace', 'Monoclaw Workspace')}
            description={t('sidebar.workspaceDescription', 'Chat, teams, and everyday runs')}
            onClick={() => switchShellMode('workspace')}
          />
          <ModeButton
            active={shellMode === 'control'}
            collapsed={sidebarCollapsed}
            icon={<ShieldCheck className="h-4 w-4" />}
            title={t('sidebar.controlPlane', 'Control Plane')}
            description={t('sidebar.controlPlaneDescription', 'Runtime, integrations, and settings')}
            onClick={() => switchShellMode('control')}
          />
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-3 overflow-hidden p-2">
        {shellMode === 'workspace' ? (
          <>
            {sidebarCollapsed ? (
              <div className="space-y-1">
                <NavItem
                  to={APP_ROUTES.workspace.chat}
                  icon={<MessageSquare className="h-5 w-5" />}
                  label={t('sidebar.conversations', 'Conversations')}
                  collapsed
                />
                <NavItem
                  to={APP_ROUTES.workspace.teams}
                  icon={<Users2 className="h-5 w-5" />}
                  label={t('sidebar.teams', 'Teams')}
                  collapsed
                />
                {workspaceNavItems.map((item) => (
                  <NavItem key={item.to} {...item} collapsed />
                ))}
              </div>
            ) : (
              <>
                <div className="space-y-1">
                  <div
                    className={cn(
                      'flex items-center rounded-xl text-sm font-medium transition-colors',
                      isOnChat
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                    )}
                  >
                    <button
                      onClick={() => navigate(APP_ROUTES.workspace.chat)}
                      className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left"
                    >
                      <MessageSquare className="h-5 w-5 shrink-0" />
                      <span className="truncate">{t('sidebar.conversations', 'Conversations')}</span>
                    </button>
                    <div className="mr-2 flex items-center gap-1">
                      <button
                        onClick={() => setChatExpanded((prev) => !prev)}
                        className="rounded p-1 hover:bg-accent"
                        aria-label={t('sidebar.conversations', 'Conversations')}
                      >
                        <ChevronDown className={cn('h-4 w-4 transition-transform', chatSectionExpanded && 'rotate-180')} />
                      </button>
                      <button
                        onClick={createNewConversation}
                        className="rounded p-1 hover:bg-accent"
                        aria-label={t('sidebar.newChat', 'New Chat')}
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {chatSectionExpanded && (
                    <div className="ml-5 max-h-64 space-y-0.5 overflow-y-auto border-l pl-2">
                      {sessions.length === 0 && (
                        <p className="px-2 py-1 text-xs text-muted-foreground">
                          {t('sidebar.noConversations', 'No conversations')}
                        </p>
                      )}

                      {sortedSessions.map((session) => (
                        <div key={session.key} className="group relative flex items-center">
                          <button
                            onClick={() => {
                              markSessionSeen(session.key);
                              switchSession(session.key);
                              navigate(APP_ROUTES.workspace.chat);
                            }}
                            className={cn(
                              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                              !session.key.endsWith(':main') && 'pr-7',
                              'hover:bg-accent hover:text-accent-foreground',
                              isOnChat && currentSessionKey === session.key
                                ? 'bg-accent/60 font-medium text-accent-foreground'
                                : 'text-muted-foreground',
                            )}
                          >
                            <span
                              className={cn('h-2 w-2 shrink-0 rounded-full', conversationDotClass(session.key))}
                              aria-label={conversationDotLabel(session.key)}
                              title={conversationDotLabel(session.key)}
                            />
                            <span className="min-w-0 flex-1 truncate">
                              {getSessionLabel(session.key, session.displayName, session.label)}
                            </span>
                          </button>
                          {!session.key.endsWith(':main') && (
                            <button
                              aria-label="Delete session"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSessionToDelete({
                                  key: session.key,
                                  label: getSessionLabel(session.key, session.displayName, session.label),
                                });
                              }}
                              className={cn(
                                'absolute right-1 flex items-center justify-center rounded p-0.5 transition-opacity',
                                'opacity-0 group-hover:opacity-100',
                                'text-muted-foreground hover:bg-destructive/10 hover:text-destructive',
                              )}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <div
                    className={cn(
                      'flex items-center rounded-xl text-sm font-medium transition-colors',
                      isOnTeams
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                    )}
                  >
                    <button
                      onClick={() => navigate(APP_ROUTES.workspace.teams)}
                      className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left"
                    >
                      <Users2 className="h-5 w-5 shrink-0" />
                      <span className="truncate">{t('sidebar.teams', 'Teams')}</span>
                    </button>
                    <div className="mr-2 flex items-center gap-1">
                      <button
                        onClick={() => setTeamsExpanded((prev) => !prev)}
                        className="rounded p-1 hover:bg-accent"
                        aria-label={t('sidebar.teams', 'Teams')}
                      >
                        <ChevronDown className={cn('h-4 w-4 transition-transform', teamsSectionExpanded && 'rotate-180')} />
                      </button>
                      <button
                        onClick={createNewTeam}
                        className="rounded p-1 hover:bg-accent"
                        aria-label={t('teams.list.createTeam', { defaultValue: 'Create Team' })}
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {teamsSectionExpanded && (
                    <div className="ml-5 space-y-1 border-l pl-2">
                      {teamLoading && teams.length === 0 && (
                        <p className="px-2 py-1 text-xs text-muted-foreground">
                          {t('sidebar.teamsLoading', 'Loading teams...')}
                        </p>
                      )}
                      {!teamLoading && teams.length === 0 && (
                        <p className="px-2 py-1 text-xs text-muted-foreground">
                          {t('sidebar.noTeams', 'No teams yet')}
                        </p>
                      )}

                      {teams.map((team) => {
                        const runtime = runtimes[team.id];
                        const isActive = location.pathname === APP_ROUTES.workspace.team(team.id);
                        return (
                          <button
                            key={team.id}
                            onClick={() => openTeamRoute(team.id)}
                            className={cn(
                              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                              isActive
                                ? 'bg-accent text-accent-foreground'
                                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                            )}
                          >
                            <span className={cn('h-2 w-2 shrink-0 rounded-full', teamStatusDotClass(team.status))} />
                            <span className="min-w-0 flex-1 truncate">{team.name}</span>
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                              {runtime?.runningTasks ?? 0}/{runtime?.queuedTasks ?? 0}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="space-y-1 border-t border-border/70 pt-2">
                  {workspaceNavItems.map((item) => (
                    <NavItem key={item.to} {...item} />
                  ))}
                </div>
              </>
            )}
          </>
        ) : (
          <div className="space-y-1">
            {controlNavItems.map((item) => (
              <NavItem key={item.to} {...item} collapsed={sidebarCollapsed} />
            ))}
          </div>
        )}
      </nav>

      <div className="space-y-2 border-t border-border/70 p-2">
        {shellMode === 'control' && devModeUnlocked && !sidebarCollapsed && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={openDevConsole}
          >
            <Terminal className="mr-2 h-4 w-4" />
            {t('sidebar.devConsole')}
            <ExternalLink className="ml-auto h-3 w-3" />
          </Button>
        )}

        <Button
          variant="ghost"
          size="icon"
          className="w-full"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        >
          {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>

      <ConfirmDialog
        open={!!sessionToDelete}
        title={t('actions.confirm', { ns: 'common', defaultValue: 'Confirm' })}
        message={sessionToDelete ? t('sidebar.deleteSessionConfirm', `Delete "${sessionToDelete.label}"?`) : ''}
        confirmLabel={t('actions.delete', { ns: 'common', defaultValue: 'Delete' })}
        cancelLabel={t('actions.cancel', { ns: 'common', defaultValue: 'Cancel' })}
        variant="destructive"
        onConfirm={async () => {
          if (!sessionToDelete) return;
          await deleteSession(sessionToDelete.key);
          if (currentSessionKey === sessionToDelete.key) navigate(APP_ROUTES.workspace.chat);
          setSessionToDelete(null);
        }}
        onCancel={() => setSessionToDelete(null)}
      />
    </aside>
  );
}
