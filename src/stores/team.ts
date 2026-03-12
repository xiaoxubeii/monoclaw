import { create } from 'zustand';
import i18n from '@/i18n';
import type {
  CreateTeamPayload,
  DispatchTaskPayload,
  TeamAuditLogEntry,
  TeamRuntimeSnapshot,
  TeamTask,
  TeamTemplate,
  UpdateFeishuPayload,
  UpdateTeamPayload,
  VirtualTeam,
} from '@/types/team';

type TeamIpcResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string };

async function invokeTeam<T>(channel: string, ...args: unknown[]): Promise<T> {
  const response = await window.electron.ipcRenderer.invoke(channel, ...args) as TeamIpcResponse<T>;
  if (!response.success) {
    throw new Error(response.error || `IPC request failed: ${channel}`);
  }
  return response.data;
}

function upsertTeam(existing: VirtualTeam[], next: VirtualTeam): VirtualTeam[] {
  const idx = existing.findIndex((item) => item.id === next.id);
  if (idx < 0) {
    return [...existing, next].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  const cloned = [...existing];
  cloned[idx] = next;
  return cloned.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function upsertTask(existing: TeamTask[], next: TeamTask): TeamTask[] {
  const idx = existing.findIndex((item) => item.id === next.id);
  if (idx < 0) {
    return [...existing, next].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  }
  const cloned = [...existing];
  cloned[idx] = next;
  return cloned.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
}

function pushLog(existing: TeamAuditLogEntry[], next: TeamAuditLogEntry): TeamAuditLogEntry[] {
  const merged = [...existing, next];
  if (merged.length > 800) {
    merged.splice(0, merged.length - 800);
  }
  return merged;
}

let teamInitPromise: Promise<void> | null = null;
let teamListenersBound = false;

interface TeamState {
  templates: TeamTemplate[];
  teams: VirtualTeam[];
  runtimes: Record<string, TeamRuntimeSnapshot>;
  tasksByTeam: Record<string, TeamTask[]>;
  logsByTeam: Record<string, TeamAuditLogEntry[]>;
  selectedTeamId: string | null;
  loading: boolean;
  isInitialized: boolean;
  error: string | null;

  init: () => Promise<void>;
  refreshAll: () => Promise<void>;
  refreshTeamData: (teamId: string) => Promise<void>;
  selectTeam: (teamId: string | null) => void;

  createFromTemplate: (templateId: string, name?: string, locale?: string) => Promise<VirtualTeam>;
  createTeam: (payload: CreateTeamPayload) => Promise<VirtualTeam>;
  updateTeam: (teamId: string, payload: UpdateTeamPayload) => Promise<VirtualTeam>;
  updateFeishu: (teamId: string, payload: UpdateFeishuPayload) => Promise<VirtualTeam>;

  startTeam: (teamId: string) => Promise<TeamRuntimeSnapshot>;
  hibernateTeam: (teamId: string) => Promise<TeamRuntimeSnapshot>;
  dissolveTeam: (teamId: string) => Promise<void>;

  dispatchTask: (teamId: string, payload: DispatchTaskPayload) => Promise<TeamTask>;

  clearError: () => void;
}

export const useTeamStore = create<TeamState>((set, get) => ({
  templates: [],
  teams: [],
  runtimes: {},
  tasksByTeam: {},
  logsByTeam: {},
  selectedTeamId: null,
  loading: false,
  isInitialized: false,
  error: null,

  init: async () => {
    if (get().isInitialized) return;
    if (teamInitPromise) {
      await teamInitPromise;
      return;
    }

    teamInitPromise = (async () => {
      set({ loading: true, error: null });
      try {
        await get().refreshAll();
        set({ isInitialized: true, loading: false });
      } catch (error) {
        set({ loading: false, error: String(error) });
      }

      if (!teamListenersBound) {
        teamListenersBound = true;

        window.electron.ipcRenderer.on('team:changed', (payload) => {
          const team = payload as VirtualTeam;
          useTeamStore.setState((state) => ({
            teams: upsertTeam(state.teams, team),
          }));
        });

        window.electron.ipcRenderer.on('team:removed', (payload) => {
          const teamId = (payload as { teamId?: string } | undefined)?.teamId;
          if (!teamId) return;
          useTeamStore.setState((state) => {
            const nextSelected = state.selectedTeamId === teamId ? null : state.selectedTeamId;
            const nextTasks = { ...state.tasksByTeam };
            const nextLogs = { ...state.logsByTeam };
            const nextRuntimes = { ...state.runtimes };
            delete nextTasks[teamId];
            delete nextLogs[teamId];
            delete nextRuntimes[teamId];

            return {
              teams: state.teams.filter((team) => team.id !== teamId),
              selectedTeamId: nextSelected,
              tasksByTeam: nextTasks,
              logsByTeam: nextLogs,
              runtimes: nextRuntimes,
            };
          });
        });

        window.electron.ipcRenderer.on('team:runtime', (payload) => {
          const runtime = payload as TeamRuntimeSnapshot;
          useTeamStore.setState((state) => ({
            runtimes: {
              ...state.runtimes,
              [runtime.teamId]: runtime,
            },
          }));
        });

        window.electron.ipcRenderer.on('team:task', (payload) => {
          const task = payload as TeamTask;
          useTeamStore.setState((state) => ({
            tasksByTeam: {
              ...state.tasksByTeam,
              [task.teamId]: upsertTask(state.tasksByTeam[task.teamId] ?? [], task),
            },
          }));
        });

        window.electron.ipcRenderer.on('team:log', (payload) => {
          const entry = payload as TeamAuditLogEntry;
          useTeamStore.setState((state) => ({
            logsByTeam: {
              ...state.logsByTeam,
              [entry.teamId]: pushLog(state.logsByTeam[entry.teamId] ?? [], entry),
            },
          }));
        });
      }
    })();

    try {
      await teamInitPromise;
    } finally {
      teamInitPromise = null;
    }
  },

  refreshAll: async () => {
    const [templates, teams, runtimes] = await Promise.all([
      invokeTeam<TeamTemplate[]>('team:listTemplates', { locale: i18n.language }),
      invokeTeam<VirtualTeam[]>('team:list'),
      invokeTeam<TeamRuntimeSnapshot[]>('team:getRuntimeOverview'),
    ]);

    const runtimeMap: Record<string, TeamRuntimeSnapshot> = {};
    for (const snapshot of runtimes) {
      runtimeMap[snapshot.teamId] = snapshot;
    }

    const tasksByTeam: Record<string, TeamTask[]> = {};
    const logsByTeam: Record<string, TeamAuditLogEntry[]> = {};

    await Promise.all(teams.map(async (team) => {
      const [tasks, logs] = await Promise.all([
        invokeTeam<TeamTask[]>('team:getTasks', team.id, 200),
        invokeTeam<TeamAuditLogEntry[]>('team:getLogs', team.id, 200),
      ]);
      tasksByTeam[team.id] = tasks;
      logsByTeam[team.id] = logs;
    }));

    set((state) => ({
      templates,
      teams,
      runtimes: runtimeMap,
      tasksByTeam,
      logsByTeam,
      selectedTeamId: state.selectedTeamId ?? teams[0]?.id ?? null,
      error: null,
    }));
  },

  refreshTeamData: async (teamId) => {
    const [runtime, tasks, logs] = await Promise.all([
      invokeTeam<TeamRuntimeSnapshot>('team:getRuntime', teamId),
      invokeTeam<TeamTask[]>('team:getTasks', teamId, 200),
      invokeTeam<TeamAuditLogEntry[]>('team:getLogs', teamId, 200),
    ]);

    set((state) => ({
      runtimes: {
        ...state.runtimes,
        [teamId]: runtime,
      },
      tasksByTeam: {
        ...state.tasksByTeam,
        [teamId]: tasks,
      },
      logsByTeam: {
        ...state.logsByTeam,
        [teamId]: logs,
      },
    }));
  },

  selectTeam: (teamId) => {
    set({ selectedTeamId: teamId });
    if (teamId) {
      void get().refreshTeamData(teamId).catch(() => {});
    }
  },

  createFromTemplate: async (templateId, name, locale) => {
    const team = await invokeTeam<VirtualTeam>('team:createFromTemplate', { templateId, name, locale: locale || i18n.language });
    set((state) => ({
      teams: upsertTeam(state.teams, team),
      selectedTeamId: team.id,
      error: null,
    }));
    await get().refreshTeamData(team.id);
    return team;
  },

  createTeam: async (payload) => {
    const team = await invokeTeam<VirtualTeam>('team:create', payload);
    set((state) => ({
      teams: upsertTeam(state.teams, team),
      selectedTeamId: team.id,
      error: null,
    }));
    await get().refreshTeamData(team.id);
    return team;
  },

  updateTeam: async (teamId, payload) => {
    const team = await invokeTeam<VirtualTeam>('team:update', teamId, payload);
    set((state) => ({
      teams: upsertTeam(state.teams, team),
      error: null,
    }));
    await get().refreshTeamData(teamId);
    return team;
  },

  updateFeishu: async (teamId, payload) => {
    const team = await invokeTeam<VirtualTeam>('team:updateFeishu', teamId, payload);
    set((state) => ({
      teams: upsertTeam(state.teams, team),
      error: null,
    }));
    await get().refreshTeamData(teamId);
    return team;
  },

  startTeam: async (teamId) => {
    const runtime = await invokeTeam<TeamRuntimeSnapshot>('team:start', teamId);
    set((state) => ({
      runtimes: {
        ...state.runtimes,
        [teamId]: runtime,
      },
      error: null,
    }));
    await get().refreshAll();
    return runtime;
  },

  hibernateTeam: async (teamId) => {
    const runtime = await invokeTeam<TeamRuntimeSnapshot>('team:hibernate', teamId);
    set((state) => ({
      runtimes: {
        ...state.runtimes,
        [teamId]: runtime,
      },
      error: null,
    }));
    await get().refreshAll();
    return runtime;
  },

  dissolveTeam: async (teamId) => {
    await invokeTeam<boolean>('team:dissolve', teamId);
    set((state) => {
      const nextTasks = { ...state.tasksByTeam };
      const nextLogs = { ...state.logsByTeam };
      const nextRuntimes = { ...state.runtimes };
      delete nextTasks[teamId];
      delete nextLogs[teamId];
      delete nextRuntimes[teamId];

      return {
        teams: state.teams.filter((team) => team.id !== teamId),
        selectedTeamId: state.selectedTeamId === teamId ? null : state.selectedTeamId,
        tasksByTeam: nextTasks,
        logsByTeam: nextLogs,
        runtimes: nextRuntimes,
        error: null,
      };
    });
  },

  dispatchTask: async (teamId, payload) => {
    const task = await invokeTeam<TeamTask>('team:dispatchTask', teamId, payload);
    set((state) => ({
      tasksByTeam: {
        ...state.tasksByTeam,
        [teamId]: upsertTask(state.tasksByTeam[teamId] ?? [], task),
      },
      error: null,
    }));
    await get().refreshTeamData(teamId);
    return task;
  },

  clearError: () => set({ error: null }),
}));
