export type ShellMode = 'workspace' | 'control';

export const APP_ROUTES = {
  root: '/',
  setup: '/setup',
  workspace: {
    root: '/workspace',
    chat: '/workspace/chat',
    teams: '/workspace/teams',
    team: (teamId: string) => `/workspace/teams/${teamId}`,
    skills: '/workspace/skills',
    automation: '/workspace/automation',
  },
  control: {
    root: '/control',
    overview: '/control/overview',
    monoConnect: '/control/mono-connect',
    monoclawCore: '/control/monoclaw-core',
    runtimeManager: '/control/runtime-manager',
    channels: '/control/channels',
    ops: '/control/ops',
    settings: '/control/settings',
  },
} as const;

export const LEGACY_ROUTE_REDIRECTS = {
  dashboard: APP_ROUTES.control.overview,
  monoConnect: APP_ROUTES.control.monoConnect,
  channels: APP_ROUTES.control.channels,
  skills: APP_ROUTES.workspace.skills,
  cron: APP_ROUTES.workspace.automation,
  teams: APP_ROUTES.workspace.teams,
  monoclawCore: APP_ROUTES.control.monoclawCore,
  runtimeManager: APP_ROUTES.control.runtimeManager,
  openclawManager: APP_ROUTES.control.runtimeManager,
  ops: APP_ROUTES.control.ops,
  settings: APP_ROUTES.control.settings,
} as const;

export function resolveShellMode(pathname: string): ShellMode | null {
  if (pathname.startsWith(APP_ROUTES.workspace.root)) return 'workspace';
  if (pathname.startsWith(APP_ROUTES.control.root)) return 'control';
  return null;
}

export function isTeamsPath(pathname: string): boolean {
  return pathname === APP_ROUTES.workspace.teams || pathname.startsWith(`${APP_ROUTES.workspace.teams}/`);
}

export function isChatPath(pathname: string): boolean {
  return pathname === APP_ROUTES.workspace.chat;
}

export function getShellEntry(mode: ShellMode): string {
  return mode === 'workspace' ? APP_ROUTES.workspace.chat : APP_ROUTES.control.overview;
}
