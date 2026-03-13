import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Globe,
  MessageSquareText,
  PackageOpen,
  Pause,
  Play,
  Plus,
  Puzzle,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn, formatRelativeTime, truncate } from '@/lib/utils';
import { APP_ROUTES } from '@/lib/navigation';
import { useTeamStore } from '@/stores/team';
import type { MarketplaceSkill } from '@/types/skill';
import type {
  CollaborationProtocol,
  OpenClawAgentConfig,
  TaskStatus,
  TeamAuditLogEntry,
  TeamRoleDefinition,
  TeamTask,
  TeamTemplate,
  VirtualTeam,
} from '@/types/team';

interface RoleDraft extends TeamRoleDefinition {
  responsibilitiesText: string;
  boundariesText: string;
  keywordsText: string;
  skillsText: string;
  agentProvider: string;
  agentModel: string;
  agentSystemPrompt: string;
  agentTemperatureText: string;
  agentMaxTokensText: string;
}

interface AgentFormState {
  provider: string;
  model: string;
  systemPrompt: string;
  temperature: string;
  maxTokens: string;
}

type TeamsListTab = 'home' | 'blueprints' | 'market';
type CreateMode = 'template' | 'custom';
type TeamDetailTab = 'workbench' | 'studio' | 'runs';
type TeamRunsTab = 'tasks' | 'logs';
type TeamRoomSidebarView = 'participants' | 'tasks';

const TEMPLATE_PAGE_SIZE = 6;
const COLLAB_PROTOCOL_OPTIONS: CollaborationProtocol[] = ['native', 'langgraph', 'crewai', 'n8n'];
const TASK_PROTOCOL_TEAM_DEFAULT = '__team_default__';
const DEFAULT_AGENT_FORM: AgentFormState = {
  provider: 'openclaw',
  model: 'auto',
  systemPrompt: '',
  temperature: '0.2',
  maxTokens: '2048',
};
const teamsHeroCardClass =
  'relative overflow-hidden border-border/70 bg-background/80 shadow-[0_28px_90px_-46px_rgba(99,102,241,0.5)]';
const teamsSurfaceCardClass =
  'border-border/70 bg-gradient-to-br from-background via-background to-indigo-500/[0.05] shadow-[0_20px_60px_-36px_rgba(99,102,241,0.32)]';
const teamsPanelClass =
  'rounded-xl border border-border/60 bg-background/60 backdrop-blur-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]';
const teamsTabsListClass = 'grid';

interface TeamRoomFeedItem {
  id: string;
  actor: string;
  kind: 'user' | 'lead' | 'role' | 'alert';
  content: string;
  timestamp: string;
  meta?: string;
}

interface TeamArtifactSummary {
  id: string;
  roleName: string;
  title: string;
  excerpt: string;
  timestamp: string;
  status: TaskStatus;
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'running' || status === 'idle' || status === 'completed') return 'default';
  if (status === 'starting' || status === 'busy' || status === 'queued' || status === 'hibernating') return 'secondary';
  if (status === 'error' || status === 'failed' || status === 'warn') return 'destructive';
  return 'outline';
}

function parseCsv(input: string): string[] {
  return input
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeTemperature(raw: string): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 0.2;
  return Math.min(2, Math.max(0, parsed));
}

function normalizeMaxTokens(raw: string): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 2048;
  return Math.round(Math.min(32768, Math.max(128, parsed)));
}

function buildDefaultRolePrompt(roleName: string, personality: string, skills: string[]): string {
  return [
    `You are ${roleName}.`,
    `Persona: ${personality}.`,
    'Follow responsibilities and boundaries in SOUL.md.',
    `Prefer bound skills when needed: ${skills.join(', ') || 'none'}.`,
    'Provide actionable and concise output.',
  ].join('\n');
}

function resolveAgentFromForm(
  form: AgentFormState,
  roleName: string,
  personality: string,
  skills: string[],
): OpenClawAgentConfig {
  const prompt = form.systemPrompt.trim() || buildDefaultRolePrompt(roleName, personality, skills);
  return {
    provider: form.provider.trim() || 'openclaw',
    model: form.model.trim() || 'auto',
    systemPrompt: prompt,
    temperature: normalizeTemperature(form.temperature),
    maxTokens: normalizeMaxTokens(form.maxTokens),
  };
}

function roleToDraft(role: TeamRoleDefinition): RoleDraft {
  const agent = role.agent;
  const skills = role.skills ?? [];
  return {
    ...role,
    responsibilitiesText: role.responsibilities.join(', '),
    boundariesText: role.boundaries.join(', '),
    keywordsText: role.keywords.join(', '),
    skillsText: skills.join(', '),
    agentProvider: agent?.provider || 'openclaw',
    agentModel: agent?.model || 'auto',
    agentSystemPrompt: agent?.systemPrompt || buildDefaultRolePrompt(role.name, role.personality, skills),
    agentTemperatureText: String(typeof agent?.temperature === 'number' ? agent.temperature : 0.2),
    agentMaxTokensText: String(typeof agent?.maxTokens === 'number' ? agent.maxTokens : 2048),
  };
}

function draftToRole(draft: RoleDraft): TeamRoleDefinition {
  const roleName = draft.name.trim() || draft.id;
  const personality = draft.personality.trim() || 'Professional and focused.';
  const skills = parseCsv(draft.skillsText).map((item) => item.toLowerCase());

  return {
    id: draft.id,
    name: roleName,
    personality,
    responsibilities: parseCsv(draft.responsibilitiesText),
    boundaries: parseCsv(draft.boundariesText),
    keywords: parseCsv(draft.keywordsText),
    skills,
    enabled: draft.enabled,
    agent: {
      provider: draft.agentProvider.trim() || 'openclaw',
      model: draft.agentModel.trim() || 'auto',
      systemPrompt: draft.agentSystemPrompt.trim() || buildDefaultRolePrompt(roleName, personality, skills),
      temperature: normalizeTemperature(draft.agentTemperatureText),
      maxTokens: normalizeMaxTokens(draft.agentMaxTokensText),
    },
  };
}

function applyAgentFormToRole(role: TeamRoleDefinition, form: AgentFormState): TeamRoleDefinition {
  const roleName = role.name.trim() || role.id;
  const personality = role.personality.trim() || 'Professional and focused.';
  const skills = role.skills ?? [];
  return {
    ...role,
    agent: resolveAgentFromForm(form, roleName, personality, skills),
  };
}

function buildCustomDefaultRole(form: AgentFormState): TeamRoleDefinition {
  const roleName = 'Team Manager';
  const personality = 'Structured and accountable.';
  return {
    id: 'manager',
    name: roleName,
    personality,
    responsibilities: ['Task decomposition', 'Result consolidation', 'Cross-role coordination'],
    boundaries: ['Do not fabricate facts', 'Escalate missing information'],
    keywords: ['plan', 'split', 'summary', 'coordination'],
    skills: ['workflow.plan', 'workflow.handoff', 'workflow.synthesize'],
    enabled: true,
    agent: resolveAgentFromForm(form, roleName, personality, ['workflow.plan', 'workflow.handoff', 'workflow.synthesize']),
  };
}

function buildMarketSeedRole(item: MarketplaceSkill): TeamRoleDefinition {
  const roleName = `${item.name} Coordinator`;
  const personality = 'Pragmatic and execution-focused.';
  return {
    id: 'manager',
    name: roleName,
    personality,
    responsibilities: ['Clarify request scope', 'Coordinate sub-tasks', 'Deliver consolidated output'],
    boundaries: ['No fabricated facts', 'Escalate unclear constraints'],
    keywords: ['summary', 'plan', 'coordination', 'delivery'],
    skills: ['workflow.plan', 'workflow.handoff', 'workflow.synthesize'],
    enabled: true,
    agent: resolveAgentFromForm(DEFAULT_AGENT_FORM, roleName, personality, ['workflow.plan', 'workflow.handoff', 'workflow.synthesize']),
  };
}

function toRoomExcerpt(value?: string, maxLength = 220): string {
  if (!value) return '';
  return truncate(value.replace(/\s+/g, ' ').trim(), maxLength);
}

function buildTeamRoomFeed(
  team: VirtualTeam,
  tasks: TeamTask[],
  logs: TeamAuditLogEntry[],
): TeamRoomFeedItem[] {
  const roleNameById = new Map(team.roles.map((role) => [role.id, role.name]));
  const coordinatorName = roleNameById.get('manager') || team.roles[0]?.name || 'Team Lead';
  const feed: TeamRoomFeedItem[] = [
    {
      id: `intro-${team.id}`,
      actor: coordinatorName,
      kind: 'lead',
      content: team.description || `${team.name} is ready. Share a goal and this room will break it down across the team.`,
      timestamp: team.createdAt,
      meta: team.templateId ? `Blueprint ${team.templateId}` : 'Custom blueprint',
    },
  ];

  const recentTasks = [...tasks]
    .sort((left, right) => new Date(left.requestedAt).getTime() - new Date(right.requestedAt).getTime())
    .slice(-6);

  recentTasks.forEach((task) => {
    const roleName = roleNameById.get(task.assignedRoleId) || task.assignedRoleId;
    feed.push({
      id: `prompt-${task.id}`,
      actor: 'You',
      kind: 'user',
      content: task.input,
      timestamp: task.requestedAt,
      meta: task.collaboration?.enabled ? `Collaborative via ${task.collaboration.protocol || 'native'}` : 'Single route',
    });

    if (task.status === 'queued' || task.status === 'running') {
      feed.push({
        id: `handoff-${task.id}`,
        actor: coordinatorName,
        kind: 'lead',
        content: `${roleName} is handling this now.`,
        timestamp: task.startedAt || task.requestedAt,
        meta: task.status === 'queued' ? 'Queued' : 'In progress',
      });
    }

    if (task.status === 'completed' && task.result) {
      feed.push({
        id: `result-${task.id}`,
        actor: roleName,
        kind: 'role',
        content: task.result,
        timestamp: task.completedAt || task.startedAt || task.requestedAt,
        meta: task.collaboration?.enabled ? 'Shared back to room' : 'Delivered',
      });
    }

    if (task.status === 'failed') {
      feed.push({
        id: `failed-${task.id}`,
        actor: roleName,
        kind: 'alert',
        content: task.error || 'The task failed before the team could complete it.',
        timestamp: task.completedAt || task.startedAt || task.requestedAt,
        meta: 'Needs attention',
      });
    }
  });

  logs
    .filter((entry) => entry.level !== 'info')
    .sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime())
    .slice(-4)
    .forEach((entry) => {
      feed.push({
        id: `log-${entry.id}`,
        actor: entry.source === 'task' ? coordinatorName : 'Room Watcher',
        kind: 'alert',
        content: entry.message,
        timestamp: entry.timestamp,
        meta: entry.level === 'error' ? 'Error' : 'Heads-up',
      });
    });

  return feed.sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
}

function buildArtifactSummaries(team: VirtualTeam, tasks: TeamTask[]): TeamArtifactSummary[] {
  const roleNameById = new Map(team.roles.map((role) => [role.id, role.name]));

  return [...tasks]
    .filter((task) => task.result || task.error)
    .sort((left, right) => {
      const rightTime = new Date(right.completedAt || right.startedAt || right.requestedAt).getTime();
      const leftTime = new Date(left.completedAt || left.startedAt || left.requestedAt).getTime();
      return rightTime - leftTime;
    })
    .slice(0, 4)
    .map((task) => ({
      id: task.id,
      roleName: roleNameById.get(task.assignedRoleId) || task.assignedRoleId,
      title: task.status === 'failed' ? 'Blocked run' : 'Delivered output',
      excerpt: toRoomExcerpt(task.result || task.error, 120),
      timestamp: task.completedAt || task.startedAt || task.requestedAt,
      status: task.status,
    }));
}

function summarizeCollaborativeProgress(tasks: TeamTask[], goalId: string): {
  completedSteps: number;
  totalSteps: number | null;
  currentStep: number;
} {
  const children = tasks.filter((task) => (
    task.collaboration?.goalId === goalId
    && task.collaboration?.isRoot === false
  ));

  let maxObservedStep = 0;
  let maxTotalSteps = 0;
  const completedStepSet = new Set<number>();

  for (const task of children) {
    const step = task.collaboration?.step;
    if (typeof step === 'number' && Number.isFinite(step) && step > 0) {
      maxObservedStep = Math.max(maxObservedStep, step);
      if (task.status === 'completed') {
        completedStepSet.add(step);
      }
    }

    const total = task.collaboration?.totalSteps;
    if (typeof total === 'number' && Number.isFinite(total) && total > 0) {
      maxTotalSteps = Math.max(maxTotalSteps, total);
    }
  }

  const completedSteps = completedStepSet.size;
  const totalSteps = maxTotalSteps > 0 ? maxTotalSteps : null;
  const currentStep = totalSteps
    ? Math.min(totalSteps, Math.max(maxObservedStep, completedSteps))
    : Math.max(maxObservedStep, completedSteps);

  return {
    completedSteps,
    totalSteps,
    currentStep,
  };
}

export function Teams() {
  const { teamId: routeTeamId } = useParams<{ teamId?: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { t, i18n } = useTranslation('teams');

  const {
    init,
    templates,
    teams,
    runtimes,
    tasksByTeam,
    logsByTeam,
    selectedTeamId,
    loading,
    isInitialized,
    refreshAll,
    error,
    selectTeam,
    createTeam,
    updateTeam,
    startTeam,
    hibernateTeam,
    dissolveTeam,
    dispatchTask,
    interveneTask,
    clearError,
  } = useTeamStore();

  const [listTab, setListTab] = useState<TeamsListTab>('home');
  const [templatePage, setTemplatePage] = useState(1);
  const [detailTab, setDetailTab] = useState<TeamDetailTab>('workbench');
  const [runsTab, setRunsTab] = useState<TeamRunsTab>('tasks');

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createMode, setCreateMode] = useState<CreateMode>('template');
  const [creatingTeam, setCreatingTeam] = useState(false);

  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [templateTeamName, setTemplateTeamName] = useState('');
  const [templateAgentForm, setTemplateAgentForm] = useState<AgentFormState>(DEFAULT_AGENT_FORM);

  const [customName, setCustomName] = useState('');
  const [customDomain, setCustomDomain] = useState('general');
  const [customDescription, setCustomDescription] = useState('');
  const [customAgentForm, setCustomAgentForm] = useState<AgentFormState>(DEFAULT_AGENT_FORM);

  const [marketQuery, setMarketQuery] = useState('');
  const [marketSearching, setMarketSearching] = useState(false);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [marketResults, setMarketResults] = useState<MarketplaceSkill[]>([]);
  const [marketCreatingSlug, setMarketCreatingSlug] = useState<string | null>(null);

  const [roleDrafts, setRoleDrafts] = useState<RoleDraft[]>([]);
  const [expandedRoleId, setExpandedRoleId] = useState<string | null>(null);
  const [advancedRoleId, setAdvancedRoleId] = useState<string | null>(null);
  const [taskInput, setTaskInput] = useState('');
  const [teamDefaultCollaborationProtocol, setTeamDefaultCollaborationProtocol] = useState<CollaborationProtocol>('native');
  const [taskProtocolOverrideEnabled, setTaskProtocolOverrideEnabled] = useState(false);
  const [taskCollaborationProtocol, setTaskCollaborationProtocol] = useState<CollaborationProtocol>('native');
  const [interventionNote, setInterventionNote] = useState('');
  const [roomSidebarView, setRoomSidebarView] = useState<TeamRoomSidebarView>('participants');
  const [feishuChannelConnected, setFeishuChannelConnected] = useState(false);
  const [pendingAction, setPendingAction] = useState<'none' | 'start' | 'hibernate' | 'dispatch' | 'intervene' | 'saveTeam'>('none');
  const [teamToDissolve, setTeamToDissolve] = useState<VirtualTeam | null>(null);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    if (!routeTeamId) return;
    const exists = teams.some((team) => team.id === routeTeamId);
    if (exists && selectedTeamId !== routeTeamId) {
      selectTeam(routeTeamId);
    }
  }, [routeTeamId, teams, selectedTeamId, selectTeam]);

  useEffect(() => {
    if (!routeTeamId || !isInitialized || loading) return;
    const exists = teams.some((team) => team.id === routeTeamId);
    if (!exists) {
      navigate(APP_ROUTES.workspace.teams, { replace: true });
    }
  }, [routeTeamId, teams, isInitialized, loading, navigate]);

  const selectedTeam = useMemo(() => {
    if (!routeTeamId) return null;
    return teams.find((team) => team.id === routeTeamId) ?? null;
  }, [teams, routeTeamId]);

  const selectedTemplate = useMemo<TeamTemplate | null>(
    () => templates.find((template) => template.id === selectedTemplateId) ?? null,
    [templates, selectedTemplateId],
  );

  const totalTemplatePages = Math.max(1, Math.ceil(templates.length / TEMPLATE_PAGE_SIZE));
  const safeTemplatePage = Math.min(templatePage, totalTemplatePages);
  const pagedTemplates = templates.slice(
    (safeTemplatePage - 1) * TEMPLATE_PAGE_SIZE,
    safeTemplatePage * TEMPLATE_PAGE_SIZE,
  );

  const runtime = selectedTeam ? runtimes[selectedTeam.id] : undefined;
  const tasks = selectedTeam ? (tasksByTeam[selectedTeam.id] ?? []) : [];
  const logs = selectedTeam ? (logsByTeam[selectedTeam.id] ?? []) : [];

  useEffect(() => {
    if (!templates.length) {
      setSelectedTemplateId('');
      return;
    }

    const exists = templates.some((template) => template.id === selectedTemplateId);
    if (!exists) {
      setSelectedTemplateId(templates[0].id);
    }
  }, [templates, selectedTemplateId]);

  useEffect(() => {
    setTemplatePage(1);
  }, [templates.length]);

  useEffect(() => {
    if (!selectedTeam) {
      setRoleDrafts([]);
      setExpandedRoleId(null);
      setAdvancedRoleId(null);
      return;
    }
    const nextDrafts = selectedTeam.roles.map((role) => roleToDraft(role));
    setRoleDrafts(nextDrafts);
    setExpandedRoleId((current) => (
      nextDrafts.some((draft) => draft.id === current) ? current : nextDrafts[0]?.id ?? null
    ));
    setAdvancedRoleId((current) => (
      nextDrafts.some((draft) => draft.id === current) ? current : null
    ));
    const defaultProtocol = selectedTeam.defaultCollaborationProtocol || 'native';
    setTeamDefaultCollaborationProtocol(defaultProtocol);
    setTaskProtocolOverrideEnabled(false);
    setTaskCollaborationProtocol(defaultProtocol);
  }, [selectedTeam]);

  useEffect(() => {
    if (!routeTeamId) return;
    setDetailTab('workbench');
    setRunsTab('tasks');
    setRoomSidebarView('participants');
  }, [routeTeamId]);

  useEffect(() => {
    if (!isInitialized) return;
    void refreshAll().catch(() => {});
  }, [i18n.language, isInitialized, refreshAll]);

  useEffect(() => {
    let cancelled = false;

    const refreshFeishuChannelStatus = async () => {
      try {
        const response = await window.electron.ipcRenderer.invoke(
          'gateway:rpc',
          'channels.status',
          { probe: true }
        ) as {
          success: boolean;
          result?: {
            channels?: Record<string, unknown>;
            channelAccounts?: Record<string, Array<{
              connected?: boolean;
              linked?: boolean;
              running?: boolean;
              lastConnectedAt?: number | null;
              lastInboundAt?: number | null;
              lastOutboundAt?: number | null;
            }>>;
          };
        };

        if (!response.success || !response.result) {
          if (!cancelled) setFeishuChannelConnected(false);
          return;
        }

        const now = Date.now();
        const recentMs = 10 * 60 * 1000;
        const accounts = response.result.channelAccounts?.feishu ?? [];
        const hasRecentActivity = (account: {
          lastConnectedAt?: number | null;
          lastInboundAt?: number | null;
          lastOutboundAt?: number | null;
        }) => (
          (typeof account.lastConnectedAt === 'number' && now - account.lastConnectedAt < recentMs) ||
          (typeof account.lastInboundAt === 'number' && now - account.lastInboundAt < recentMs) ||
          (typeof account.lastOutboundAt === 'number' && now - account.lastOutboundAt < recentMs)
        );

        const accountConnected = accounts.some((account) =>
          account.connected === true || account.linked === true || account.running === true || hasRecentActivity(account));
        const channelSummary = response.result.channels?.feishu as { running?: boolean } | undefined;
        const connected = accountConnected || channelSummary?.running === true;

        if (!cancelled) setFeishuChannelConnected(connected);
      } catch {
        if (!cancelled) setFeishuChannelConnected(false);
      }
    };

    void refreshFeishuChannelStatus();
    const timer = window.setInterval(() => {
      void refreshFeishuChannelStatus();
    }, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const statusLabel = (value: string): string => (
    t(`status.${value}`, { defaultValue: t(`common:status.${value}`, value) })
  );

  const openCreateDialog = (mode: CreateMode, templateId?: string) => {
    setCreateMode(mode);
    if (templateId) {
      setSelectedTemplateId(templateId);
    }
    setCreateDialogOpen(true);
  };

  useEffect(() => {
    if (routeTeamId) return;
    if (searchParams.get('create') !== '1') return;
    openCreateDialog('template');
    const nextSearch = new URLSearchParams(searchParams);
    nextSearch.delete('create');
    setSearchParams(nextSearch, { replace: true });
  }, [routeTeamId, searchParams, setSearchParams]);

  const searchRemoteTemplates = async (rawQuery?: string) => {
    setMarketSearching(true);
    setMarketError(null);
    try {
      const query = rawQuery ?? marketQuery;
      const response = await window.electron.ipcRenderer.invoke('clawhub:search', {
        query: query.trim(),
      }) as {
        success: boolean;
        results?: MarketplaceSkill[];
        error?: string;
      };

      if (!response.success) {
        throw new Error(response.error || t('market.searchError'));
      }

      setMarketResults(response.results ?? []);
    } catch (searchError) {
      setMarketError(String(searchError));
    } finally {
      setMarketSearching(false);
    }
  };

  useEffect(() => {
    if (listTab !== 'market') return;
    if (marketSearching || marketResults.length > 0 || marketError) return;
    void searchRemoteTemplates('team template');
  }, [listTab, marketSearching, marketResults.length, marketError]);

  const onCreateFromTemplate = async (templateId?: string) => {
    const resolvedTemplateId = templateId || selectedTemplateId;
    if (!resolvedTemplateId) {
      toast.error(t('create.templateRequired'));
      return;
    }

    const template = templates.find((item) => item.id === resolvedTemplateId);
    if (!template) {
      toast.error(t('create.templateRequired'));
      return;
    }

    setCreatingTeam(true);
    try {
      const roles = template.roles.map((role) => applyAgentFormToRole(role, templateAgentForm));
      const created = await createTeam({
        name: templateTeamName.trim() || template.name,
        domain: template.domain,
        description: template.description,
        templateId: template.id,
        roles,
      });

      setTemplateTeamName('');
      setTemplateAgentForm(DEFAULT_AGENT_FORM);
      setCreateDialogOpen(false);
      selectTeam(created.id);
      navigate(APP_ROUTES.workspace.team(created.id));
      toast.success(t('toast.teamCreated', { name: created.name }));
    } catch (actionError) {
      toast.error(String(actionError));
    } finally {
      setCreatingTeam(false);
    }
  };

  const onCreateCustomTeam = async () => {
    const name = customName.trim();
    if (!name) {
      toast.error(t('toast.nameRequired'));
      return;
    }

    setCreatingTeam(true);
    try {
      const created = await createTeam({
        name,
        domain: customDomain,
        description: customDescription,
        roles: [buildCustomDefaultRole(customAgentForm)],
      });

      setCustomName('');
      setCustomDescription('');
      setCustomDomain('general');
      setCustomAgentForm(DEFAULT_AGENT_FORM);
      setCreateDialogOpen(false);
      selectTeam(created.id);
      navigate(APP_ROUTES.workspace.team(created.id));
      toast.success(t('toast.customCreated'));
    } catch (actionError) {
      toast.error(String(actionError));
    } finally {
      setCreatingTeam(false);
    }
  };

  const onCreateFromMarketSeed = async (item: MarketplaceSkill) => {
    setMarketCreatingSlug(item.slug);
    try {
      const created = await createTeam({
        name: item.name,
        domain: 'general',
        description: item.description,
        roles: [buildMarketSeedRole(item)],
      });
      selectTeam(created.id);
      navigate(APP_ROUTES.workspace.team(created.id));
      toast.success(t('toast.marketSeedCreated', { name: created.name }));
    } catch (actionError) {
      toast.error(String(actionError));
    } finally {
      setMarketCreatingSlug(null);
    }
  };

  const onSaveRoles = async () => {
    if (!selectedTeam) return;
    setPendingAction('saveTeam');
    try {
      await updateTeam(selectedTeam.id, {
        defaultCollaborationProtocol: teamDefaultCollaborationProtocol,
        roles: roleDrafts.map((draft) => draftToRole(draft)),
      });
      toast.success(t('toast.rolesSaved'));
    } catch (actionError) {
      toast.error(String(actionError));
    } finally {
      setPendingAction('none');
    }
  };

  const onSaveTeamBlueprint = async () => {
    if (!selectedTeam) return;
    setPendingAction('saveTeam');
    try {
      await updateTeam(selectedTeam.id, {
        defaultCollaborationProtocol: teamDefaultCollaborationProtocol,
      });
      toast.success(t('toast.teamSettingsSaved', { defaultValue: 'Team settings saved' }));
    } catch (actionError) {
      toast.error(String(actionError));
    } finally {
      setPendingAction('none');
    }
  };

  const onStartTeam = async () => {
    if (!selectedTeam) return;
    setPendingAction('start');
    try {
      await startTeam(selectedTeam.id);
      toast.success(t('toast.teamStarted'));
    } catch (actionError) {
      toast.error(String(actionError));
    } finally {
      setPendingAction('none');
    }
  };

  const onHibernateTeam = async () => {
    if (!selectedTeam) return;
    setPendingAction('hibernate');
    try {
      await hibernateTeam(selectedTeam.id);
      toast.success(t('toast.teamHibernated'));
    } catch (actionError) {
      toast.error(String(actionError));
    } finally {
      setPendingAction('none');
    }
  };

  const onDispatchTask = async () => {
    if (!selectedTeam) return;
    const input = taskInput.trim();
    if (!input) {
      toast.error(t('toast.taskInputRequired'));
      return;
    }

    setPendingAction('dispatch');
    try {
      await dispatchTask(selectedTeam.id, {
        input,
        collaborative: true,
        collaborationProtocol: taskProtocolOverrideEnabled ? taskCollaborationProtocol : undefined,
      });
      setTaskInput('');
      setTaskProtocolOverrideEnabled(false);
      setTaskCollaborationProtocol(selectedTeam.defaultCollaborationProtocol || 'native');
      toast.success(t('toast.taskDispatched'));
    } catch (actionError) {
      toast.error(String(actionError));
    } finally {
      setPendingAction('none');
    }
  };

  const onInterveneTask = async () => {
    if (!selectedTeam) return;
    if (!focusCollaborativeTask) return;
    const note = interventionNote.trim();
    if (!note) {
      toast.error(t('detail.intervention.noteRequired', { defaultValue: 'Please provide intervention notes first.' }));
      return;
    }

    setPendingAction('intervene');
    try {
      await interveneTask(selectedTeam.id, {
        rootTaskId: focusCollaborativeTask.id,
        note,
      });
      setInterventionNote('');
      toast.success(t('detail.intervention.submitted', { defaultValue: 'Intervention submitted. The team is resuming.' }));
    } catch (actionError) {
      toast.error(String(actionError));
    } finally {
      setPendingAction('none');
    }
  };

  const renderRoleStatus = (roleId: string) => {
    const runtimeRole = runtime?.roles.find((item) => item.roleId === roleId);
    const status = runtimeRole?.status ?? 'stopped';
    return <Badge variant={statusVariant(status)}>{statusLabel(status)}</Badge>;
  };

  const renderAgentPresetEditor = (
    form: AgentFormState,
    onPatch: (patch: Partial<AgentFormState>) => void,
  ) => (
    <div className="space-y-3 rounded-lg border border-border/70 p-3">
      <div>
        <p className="text-sm font-medium">{t('create.agentPresetTitle')}</p>
        <p className="text-xs text-muted-foreground">{t('create.agentPresetDescription')}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <Label>{t('roles.agentProvider')}</Label>
          <Input
            value={form.provider}
            onChange={(event) => onPatch({ provider: event.target.value })}
            placeholder="openclaw"
            disabled={creatingTeam}
          />
        </div>
        <div className="space-y-2">
          <Label>{t('roles.agentModel')}</Label>
          <Input
            value={form.model}
            onChange={(event) => onPatch({ model: event.target.value })}
            placeholder="auto"
            disabled={creatingTeam}
          />
        </div>
        <div className="space-y-2">
          <Label>{t('roles.agentTemperature')}</Label>
          <Input
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={form.temperature}
            onChange={(event) => onPatch({ temperature: event.target.value })}
            disabled={creatingTeam}
          />
        </div>
        <div className="space-y-2">
          <Label>{t('roles.agentMaxTokens')}</Label>
          <Input
            type="number"
            min={128}
            max={32768}
            step={1}
            value={form.maxTokens}
            onChange={(event) => onPatch({ maxTokens: event.target.value })}
            disabled={creatingTeam}
          />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label>{t('roles.agentSystemPrompt')}</Label>
          <Textarea
            rows={4}
            value={form.systemPrompt}
            onChange={(event) => onPatch({ systemPrompt: event.target.value })}
            placeholder={t('create.agentPromptPlaceholder')}
            disabled={creatingTeam}
          />
        </div>
      </div>
    </div>
  );

  const gatewayConnected = Boolean(runtime?.gatewayConnected || feishuChannelConnected);
  const teamCount = teams.length;
  const runningTeamCount = teams.filter((team) => team.status === 'running').length;
  const queuedTaskCount = Object.values(runtimes).reduce((sum, snapshot) => sum + snapshot.queuedTasks, 0);
  const completedTaskCount = tasks.filter((task) => task.status === 'completed').length;
  const failedTaskCount = tasks.filter((task) => task.status === 'failed').length;
  const latestLogs = logs.slice().reverse();
  const activeTaskCount = tasks.filter((task) => task.status === 'running' || task.status === 'queued').length;
  const attentionCount = failedTaskCount + latestLogs.filter((entry) => entry.level !== 'info').length;
  const teamBindings = Array.from(new Set(
    (selectedTeam?.roles ?? [])
      .map((role) => (role.agent?.provider || 'openclaw').trim())
      .filter(Boolean)
  ));
  const roomFeed = selectedTeam ? buildTeamRoomFeed(selectedTeam, tasks, logs) : [];
  const artifactSummaries = selectedTeam ? buildArtifactSummaries(selectedTeam, tasks) : [];
  const spotlightTasks = [...tasks]
    .sort((left, right) => {
      const rightTime = new Date(right.completedAt || right.startedAt || right.requestedAt).getTime();
      const leftTime = new Date(left.completedAt || left.startedAt || left.requestedAt).getTime();
      return rightTime - leftTime;
    })
    .slice(0, 4);

  const collaborativeRootTasks = [...tasks]
    .filter((task) => task.collaboration?.enabled && task.collaboration?.isRoot === true)
    .sort((left, right) => {
      const rightTime = new Date(right.requestedAt).getTime();
      const leftTime = new Date(left.requestedAt).getTime();
      return rightTime - leftTime;
    });
  const awaitingInterventionTask = collaborativeRootTasks.find((task) => (
    task.status === 'running' && task.collaboration?.awaitingIntervention
  ));
  const focusCollaborativeTask = awaitingInterventionTask
    || collaborativeRootTasks.find((task) => task.status === 'running')
    || collaborativeRootTasks[0]
    || null;
  const focusCollaboration = focusCollaborativeTask?.collaboration;
  const focusProgress = focusCollaboration?.goalId
    ? summarizeCollaborativeProgress(tasks, focusCollaboration.goalId)
    : null;
  const focusNeedsIntervention = Boolean(focusCollaboration?.awaitingIntervention);
  const focusStatusText = (() => {
    if (!focusCollaborativeTask) {
      return t('detail.intervention.noMission', { defaultValue: 'No collaborative mission yet.' });
    }
    if (focusNeedsIntervention) {
      return t('detail.intervention.currentBlocked', {
        defaultValue: 'Blocked: {{reason}}',
        reason: focusCollaboration?.interventionMessage || t('detail.intervention.waitingInput', { defaultValue: 'Waiting for user input' }),
      });
    }
    if (focusCollaborativeTask.status === 'completed') {
      return t('detail.intervention.currentCompleted', { defaultValue: 'Completed.' });
    }
    if (focusCollaborativeTask.status === 'failed') {
      return t('detail.intervention.currentFailed', { defaultValue: 'Failed.' });
    }
    if (focusCollaborativeTask.status === 'queued') {
      return t('detail.intervention.currentQueued', { defaultValue: 'Queued and waiting to start.' });
    }
    return t('detail.intervention.currentRunning', { defaultValue: 'Processing.' });
  })();
  const focusInterventionText = focusNeedsIntervention
    ? t('detail.intervention.needYes', { defaultValue: 'Need your confirmation now.' })
    : t('detail.intervention.needNo', { defaultValue: 'No intervention needed.' });
  const focusEtaText = (() => {
    if (!focusCollaborativeTask) {
      return t('detail.intervention.etaUnknown', { defaultValue: 'No estimate yet.' });
    }
    if (focusCollaborativeTask.status === 'completed') {
      return t('detail.intervention.etaDone', { defaultValue: 'Done.' });
    }
    if (focusCollaborativeTask.status === 'failed') {
      return t('detail.intervention.etaFailed', { defaultValue: 'Stopped due to failure.' });
    }
    if (focusNeedsIntervention) {
      if (focusProgress?.totalSteps) {
        return t('detail.intervention.etaBlockedProgress', {
          defaultValue: 'At step {{current}} / {{total}}. Will continue after intervention.',
          current: focusProgress.currentStep,
          total: focusProgress.totalSteps,
        });
      }
      return t('detail.intervention.etaBlocked', { defaultValue: 'Waiting for intervention to continue.' });
    }
    if (focusProgress?.totalSteps) {
      return t('detail.intervention.etaProgress', {
        defaultValue: 'Progress {{completed}} / {{total}}.',
        completed: focusProgress.completedSteps,
        total: focusProgress.totalSteps,
      });
    }
    return t('detail.intervention.etaSoon', { defaultValue: 'Short wait for the next stage result.' });
  })();

  useEffect(() => {
    setInterventionNote('');
  }, [focusCollaborativeTask?.id]);

  const formatBindingLabel = (binding: string) => {
    const normalized = binding.toLowerCase();
    if (normalized === 'openclaw') return 'OpenClaw';
    if (normalized === 'crewai') return 'CrewAI';
    if (normalized === 'langgraph') return 'LangGraph';
    if (normalized === 'n8n') return 'n8n';
    return binding;
  };

  const formatProtocolLabel = (protocol: CollaborationProtocol) => (
    t(`dispatch.protocolOptions.${protocol}`)
  );

  const savedTeamProtocol = selectedTeam?.defaultCollaborationProtocol || 'native';

  const updateRoleDraft = (index: number, patch: Partial<RoleDraft>) => {
    setRoleDrafts((current) => current.map((draft, draftIndex) => (
      draftIndex === index ? { ...draft, ...patch } : draft
    )));
  };

  const openRunsTab = (nextTab: TeamRunsTab) => {
    setDetailTab('runs');
    setRunsTab(nextTab);
  };

  return (
    <div className="space-y-6">
      {!routeTeamId ? (
        <Card className={teamsHeroCardClass}>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(129,140,248,0.18),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.12),transparent_30%)]" />
          <CardContent className="relative flex flex-col gap-5 p-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="space-y-3">
              <div>
                <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
                <p className="text-muted-foreground">{t('subtitle')}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{t('tabs.home', { defaultValue: 'Home' })}</Badge>
                <Badge variant={runningTeamCount > 0 ? 'success' : 'secondary'}>{t('status.running')}: {runningTeamCount}</Badge>
                <Badge variant={queuedTaskCount > 0 ? 'warning' : 'secondary'}>{t('detail.opsDispatch', { defaultValue: '分发' })}: {queuedTaskCount}</Badge>
                <Badge variant="outline">{t('tabs.blueprints', { defaultValue: 'Blueprints' })}: {templates.length}</Badge>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" className="border-border/70 bg-background/60" onClick={() => { void refreshAll(); }} disabled={loading}>
                <RefreshCw className={`mr-2 h-4 w-4${loading ? ' animate-spin' : ''}`} />
                {t('common:actions.refresh')}
              </Button>
              <Button onClick={() => openCreateDialog('template')}>
                <Plus className="mr-2 h-4 w-4" />
                {t('list.createTeam')}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className={teamsHeroCardClass}>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(129,140,248,0.18),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.12),transparent_30%)]" />
          <CardContent className="relative flex flex-col gap-5 p-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="space-y-3">
              <div>
                <h1 className="text-2xl font-bold tracking-tight">{selectedTeam?.name || t('detail.missingTitle')}</h1>
                <p className="text-muted-foreground">
                  {selectedTeam
                    ? (selectedTeam.description || t('detail.descriptionEmpty'))
                    : t('detail.missing')}
                </p>
                {selectedTeam && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('detail.lastUpdated', { time: formatRelativeTime(selectedTeam.updatedAt) })}
                  </p>
                )}
              </div>
              {selectedTeam && (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={statusVariant(selectedTeam.status)}>{statusLabel(selectedTeam.status)}</Badge>
                  <Badge variant="secondary">{selectedTeam.domain}</Badge>
                  {selectedTeam.templateId && (
                    <Badge variant="outline">{t('list.templateBadge', { id: selectedTeam.templateId })}</Badge>
                  )}
                  {teamBindings.map((binding) => (
                    <Badge key={binding} variant="outline">
                      {formatBindingLabel(binding)}
                    </Badge>
                  ))}
                  <Badge variant={gatewayConnected ? 'success' : 'warning'}>
                    {gatewayConnected ? t('detail.gatewayConnected') : t('detail.gatewayDisconnected')}
                  </Badge>
                </div>
              )}
            </div>
            {selectedTeam && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => void onStartTeam()}
                  disabled={pendingAction !== 'none' || selectedTeam.status === 'running' || selectedTeam.status === 'starting'}
                >
                  <Play className="mr-1 h-4 w-4" />
                  {t('detail.start')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-border/70 bg-background/60"
                  onClick={() => void onHibernateTeam()}
                  disabled={pendingAction !== 'none' || selectedTeam.status === 'stopped' || selectedTeam.status === 'hibernating'}
                >
                  <Pause className="mr-1 h-4 w-4" />
                  {t('detail.hibernate')}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-destructive">
          <CardContent className="flex items-center justify-between gap-4 pt-4">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={clearError}>{t('actions.clearError')}</Button>
          </CardContent>
        </Card>
      )}

      {!routeTeamId && (
        <div className="space-y-6">
          <div className="grid gap-3 md:grid-cols-4">
            <Card className={teamsSurfaceCardClass}>
              <CardContent className="py-4">
                <p className="text-xs text-muted-foreground">{t('tabs.home', { defaultValue: 'Home' })}</p>
                <p className="mt-1 text-2xl font-semibold">{teamCount}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('management.description')}
                </p>
              </CardContent>
            </Card>
            <Card className={teamsSurfaceCardClass}>
              <CardContent className="py-4">
                <p className="text-xs text-muted-foreground">{t('status.running')}</p>
                <p className="mt-1 text-2xl font-semibold">{runningTeamCount}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('management.quickStats', { roles: 0, running: runningTeamCount, queued: queuedTaskCount })}
                </p>
              </CardContent>
            </Card>
            <Card className={teamsSurfaceCardClass}>
              <CardContent className="py-4">
                <p className="text-xs text-muted-foreground">{t('tabs.blueprints', { defaultValue: 'Blueprints' })}</p>
                <p className="mt-1 text-2xl font-semibold">{templates.length}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('template.description')}
                </p>
              </CardContent>
            </Card>
            <Card className={teamsSurfaceCardClass}>
              <CardContent className="py-4">
                <p className="text-xs text-muted-foreground">{t('detail.opsDispatch', { defaultValue: '分发' })}</p>
                <p className="mt-1 text-2xl font-semibold">{queuedTaskCount}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('management.quickStats', { roles: 0, running: runningTeamCount, queued: queuedTaskCount })}
                </p>
              </CardContent>
            </Card>
          </div>

          <Tabs value={listTab} onValueChange={(value) => setListTab(value as TeamsListTab)}>
            <TabsList className={cn(teamsTabsListClass, 'w-full max-w-xl grid-cols-3')}>
              <TabsTrigger value="home" className="gap-2">
                {t('tabs.home', { defaultValue: 'Home' })}
              </TabsTrigger>
              <TabsTrigger value="blueprints" className="gap-2">
                <Puzzle className="h-4 w-4" />
                {t('tabs.blueprints', { defaultValue: 'Blueprints' })}
              </TabsTrigger>
              <TabsTrigger value="market" className="gap-2">
                <Globe className="h-4 w-4" />
                {t('tabs.market')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="home" className="mt-6 space-y-4">
              <Card className={cn(teamsSurfaceCardClass, 'bg-muted/20')}>
                <CardContent className="flex flex-col gap-4 py-5 md:flex-row md:items-center md:justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">
                      {t('management.focusTitle', { defaultValue: '先选团队，再把业务目标交给它。' })}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t('management.focusDescription', { defaultValue: '日常使用先进入 Workbench；只有需要调整角色、绑定和拓扑时才进入 Studio。' })}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => openCreateDialog('template')}>
                      <Plus className="mr-2 h-4 w-4" />
                      {t('list.createTeam')}
                    </Button>
                    <Button variant="outline" onClick={() => setListTab('blueprints')}>
                      {t('management.browseTemplates', { defaultValue: '查看蓝图' })}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <div className="grid gap-4 xl:grid-cols-3">
                <Card className={teamsSurfaceCardClass}>
                  <CardHeader>
                    <CardTitle className="text-base">{t('home.steps.discoverTitle', { defaultValue: '1. 选择蓝图' })}</CardTitle>
                    <CardDescription>{t('home.steps.discoverDescription', { defaultValue: '从内置 Blueprint 或远端种子创建一个团队。' })}</CardDescription>
                  </CardHeader>
                </Card>
                <Card className={teamsSurfaceCardClass}>
                  <CardHeader>
                    <CardTitle className="text-base">{t('home.steps.runTitle', { defaultValue: '2. 进入 Workbench' })}</CardTitle>
                    <CardDescription>{t('home.steps.runDescription', { defaultValue: '直接提交 mission，决定是否启用多角色协作与协议适配。' })}</CardDescription>
                  </CardHeader>
                </Card>
                <Card className={teamsSurfaceCardClass}>
                  <CardHeader>
                    <CardTitle className="text-base">{t('home.steps.tuneTitle', { defaultValue: '3. 进入 Studio 调优' })}</CardTitle>
                    <CardDescription>{t('home.steps.tuneDescription', { defaultValue: '结果不理想时，再调整角色职责、技能绑定和引擎。' })}</CardDescription>
                  </CardHeader>
                </Card>
              </div>

              {loading && teams.length === 0 && (
                <Card className={teamsSurfaceCardClass}>
                  <CardContent className="py-8 text-sm text-muted-foreground">{t('management.loading')}</CardContent>
                </Card>
              )}

              {!loading && teams.length === 0 && (
                <Card className={teamsSurfaceCardClass}>
                  <CardContent className="py-8 text-sm text-muted-foreground">{t('management.empty')}</CardContent>
                </Card>
              )}

              {teams.length > 0 && (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {teams.map((team) => {
                    const snapshot = runtimes[team.id];
                    const bindings = Array.from(new Set(
                      team.roles.map((role) => formatBindingLabel((role.agent?.provider || 'openclaw').trim()))
                    ));
                    return (
                      <Card key={team.id} className={cn(teamsSurfaceCardClass, 'transition-transform hover:-translate-y-0.5')}>
                        <CardHeader className="pb-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <CardTitle className="truncate text-base">{team.name}</CardTitle>
                              <CardDescription className="mt-1 line-clamp-2">
                                {team.description || team.domain}
                              </CardDescription>
                            </div>
                            <Badge variant={statusVariant(team.status)} className="shrink-0 whitespace-nowrap">
                              {statusLabel(team.status)}
                            </Badge>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <div className="flex flex-wrap gap-1">
                            <Badge variant="secondary">{team.domain}</Badge>
                            {team.templateId && (
                              <Badge variant="outline">{t('list.templateBadge', { id: team.templateId })}</Badge>
                            )}
                            {bindings.slice(0, 2).map((binding) => (
                              <Badge key={binding} variant="outline">{binding}</Badge>
                            ))}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {t('management.quickStats', {
                              roles: team.roles.length,
                              running: snapshot?.runningTasks ?? 0,
                              queued: snapshot?.queuedTasks ?? 0,
                            })}
                          </p>
                          <Button
                            size="sm"
                            className="w-full"
                            onClick={() => {
                              selectTeam(team.id);
                              navigate(APP_ROUTES.workspace.team(team.id));
                            }}
                          >
                            {t('management.open', { defaultValue: 'Open Workbench' })}
                          </Button>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            <TabsContent value="blueprints" className="mt-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{t('template.title')}</h2>
                  <p className="text-sm text-muted-foreground">{t('template.description')}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => openCreateDialog('template')}>
                    {t('template.create')}
                  </Button>
                  <Button onClick={() => openCreateDialog('custom')}>
                    <Plus className="mr-1 h-4 w-4" />
                    {t('custom.create')}
                  </Button>
                </div>
              </div>

              {templates.length === 0 ? (
                <Card className={teamsSurfaceCardClass}>
                  <CardContent className="py-8 text-sm text-muted-foreground">{t('market.empty')}</CardContent>
                </Card>
              ) : (
                <>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {pagedTemplates.map((template) => (
                      <Card
                        key={template.id}
                        className={cn(teamsSurfaceCardClass, 'group transition-colors hover:border-primary/50')}
                      >
                        <CardHeader className="pb-3">
                          <CardTitle className="text-base group-hover:text-primary">
                            {template.name}
                          </CardTitle>
                          <CardDescription className="line-clamp-2">{template.description}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <div className="flex flex-wrap gap-1">
                            <Badge variant="secondary">{template.domain}</Badge>
                            <Badge variant="outline">
                              {t('market.rolesCount', { count: template.roles.length })}
                            </Badge>
                          </div>
                          <div className="max-h-20 overflow-hidden rounded-md border border-border/60 bg-background/70 p-2 text-xs text-muted-foreground">
                            {template.roles.map((role) => role.name).join(' · ')}
                          </div>
                          <Button
                            variant="outline"
                            className="w-full"
                            onClick={() => openCreateDialog('template', template.id)}
                          >
                            {t('market.useTemplate')}
                          </Button>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={safeTemplatePage <= 1}
                      onClick={() => setTemplatePage((prev) => Math.max(1, prev - 1))}
                    >
                      <ChevronLeft className="mr-1 h-4 w-4" />
                      {t('market.prev')}
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      {t('market.page', { current: safeTemplatePage, total: totalTemplatePages })}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={safeTemplatePage >= totalTemplatePages}
                      onClick={() => setTemplatePage((prev) => Math.min(totalTemplatePages, prev + 1))}
                    >
                      {t('market.next')}
                      <ChevronRight className="ml-1 h-4 w-4" />
                    </Button>
                  </div>
                </>
              )}
            </TabsContent>

            <TabsContent value="market" className="mt-6 space-y-4">
              <Card className={cn(teamsSurfaceCardClass, 'bg-muted/20')}>
                <CardContent className="py-4 text-sm text-muted-foreground">
                  {t('market.description')}
                </CardContent>
              </Card>

              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void searchRemoteTemplates();
                }}
                className="flex flex-wrap items-center gap-3"
              >
                <div className="relative min-w-[240px] flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    value={marketQuery}
                    onChange={(event) => setMarketQuery(event.target.value)}
                  />
                </div>
                <Button type="submit" disabled={marketSearching}>
                  {t('market.searchButton')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={marketSearching}
                  onClick={() => {
                    void searchRemoteTemplates();
                  }}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  {t('common:actions.refresh')}
                </Button>
              </form>

              {marketError && (
                <Card className="border-destructive bg-destructive/5">
                  <CardContent className="py-4 text-sm text-destructive">{marketError}</CardContent>
                </Card>
              )}

              {marketResults.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {marketResults.map((item) => (
                    <Card key={item.slug} className={teamsSurfaceCardClass}>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base">{item.name}</CardTitle>
                        <CardDescription className="line-clamp-2">{item.description}</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="flex flex-wrap gap-1">
                          <Badge variant="secondary">{item.slug}</Badge>
                          <Badge variant="outline">{item.version}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {t('market.source')}: ClawHub
                        </p>
                        <Button
                          className="w-full"
                          variant="outline"
                          disabled={marketCreatingSlug === item.slug}
                          onClick={() => { void onCreateFromMarketSeed(item); }}
                        >
                          {marketCreatingSlug === item.slug ? t('create.creating') : t('market.useSeed')}
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <Card className={teamsSurfaceCardClass}>
                  <CardContent className="py-8 text-center text-sm text-muted-foreground">
                    {marketSearching
                      ? t('market.searching')
                      : marketQuery.trim()
                        ? t('market.noResults')
                        : t('market.emptyPrompt')}
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </div>
      )}

      {routeTeamId && !selectedTeam && (
        <Card className={teamsSurfaceCardClass}>
          <CardContent className="space-y-3 pt-6">
            <p className="text-sm text-muted-foreground">{t('detail.missing')}</p>
          </CardContent>
        </Card>
      )}

      {routeTeamId && selectedTeam && (
        <div className="space-y-4">
          <Tabs value={detailTab} onValueChange={(value) => setDetailTab(value as TeamDetailTab)}>
            <TabsList className={cn(teamsTabsListClass, 'w-full max-w-2xl grid-cols-3')}>
              <TabsTrigger value="workbench">
                {t('detail.tabs.workbench', { defaultValue: 'Workbench' })}
              </TabsTrigger>
              <TabsTrigger value="studio">
                {t('detail.tabs.studio', { defaultValue: 'Studio' })}
              </TabsTrigger>
              <TabsTrigger value="runs">
                {t('detail.tabs.runs', { defaultValue: 'Runs' })}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="workbench" className="mt-6 space-y-4">
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
                <Card className={cn(teamsSurfaceCardClass, 'overflow-hidden')}>
                  <CardHeader className="border-b border-border/70 bg-background/40">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <MessageSquareText className="h-4 w-4 text-primary" />
                          <CardTitle>{t('detail.roomTitle', { defaultValue: 'Team Room' })}</CardTitle>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">
                          {t('detail.roomMembers', { defaultValue: '{{count}} members', count: selectedTeam.roles.length })}
                        </Badge>
                        <Badge variant={activeTaskCount > 0 ? 'default' : 'secondary'}>
                          {t('detail.roomActive', { defaultValue: '{{count}} active', count: activeTaskCount })}
                        </Badge>
                        <Badge variant={attentionCount > 0 ? 'destructive' : 'outline'}>
                          {t('detail.roomAttention', { defaultValue: '{{count}} need attention', count: attentionCount })}
                        </Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    {selectedTeam.status !== 'running' && (
                      <div className="flex items-center justify-between gap-3 border-b border-amber-500/20 bg-amber-500/10 px-5 py-3 text-sm">
                        <div className="flex items-center gap-2 text-amber-200">
                          <AlertTriangle className="h-4 w-4" />
                          <span>{statusLabel(selectedTeam.status)}</span>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-amber-400/40 bg-background/40"
                          onClick={() => void onStartTeam()}
                          disabled={pendingAction !== 'none' || selectedTeam.status === 'starting'}
                        >
                          {t('detail.start')}
                        </Button>
                      </div>
                    )}

                    <div className="max-h-[34rem] space-y-5 overflow-auto px-5 py-5">
                      {roomFeed.map((item) => {
                        const isUserMessage = item.kind === 'user';
                        const isAlert = item.kind === 'alert';
                        return (
                          <div
                            key={item.id}
                            className={cn('flex gap-3', isUserMessage ? 'flex-row-reverse' : 'flex-row')}
                          >
                            <div
                              className={cn(
                                'mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl text-white',
                                isUserMessage && 'bg-primary text-primary-foreground',
                                item.kind === 'lead' && 'bg-gradient-to-br from-cyan-500 to-sky-600',
                                item.kind === 'role' && 'bg-gradient-to-br from-indigo-500 to-violet-600',
                                isAlert && 'bg-gradient-to-br from-amber-500 to-orange-600'
                              )}
                            >
                              {isUserMessage ? (
                                <Users className="h-4 w-4" />
                              ) : isAlert ? (
                                <AlertTriangle className="h-4 w-4" />
                              ) : item.kind === 'lead' ? (
                                <Sparkles className="h-4 w-4" />
                              ) : (
                                <Bot className="h-4 w-4" />
                              )}
                            </div>
                            <div className={cn('max-w-[85%] space-y-1', isUserMessage && 'items-end')}>
                              <div className={cn('flex items-center gap-2', isUserMessage && 'justify-end')}>
                                <span className="text-sm font-medium">{item.actor}</span>
                                <span className="text-xs text-muted-foreground">{formatRelativeTime(item.timestamp)}</span>
                              </div>
                              <div
                                className={cn(
                                  'rounded-2xl border px-4 py-3 text-sm leading-6 shadow-sm',
                                  isUserMessage && 'border-primary/20 bg-primary text-primary-foreground',
                                  item.kind === 'lead' && 'border-cyan-500/20 bg-cyan-500/8',
                                  item.kind === 'role' && 'border-border/70 bg-background/70',
                                  isAlert && 'border-amber-500/25 bg-amber-500/8'
                                )}
                              >
                                <p className="whitespace-pre-wrap">
                                  {toRoomExcerpt(item.content, item.kind === 'user' ? 240 : 360)}
                                </p>
                                {item.meta && (
                                  <p className={cn('mt-2 text-xs', isUserMessage ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
                                    {item.meta}
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="border-t border-border/70 bg-background/35 px-5 py-4">
                      <div className="space-y-3">
                        {focusCollaborativeTask && (
                          <div className="rounded-2xl border border-border/70 bg-background/70 p-4 shadow-[0_20px_60px_-42px_rgba(56,189,248,0.35)]">
                            <div className="grid gap-3 md:grid-cols-3">
                              <div className={cn(teamsPanelClass, 'space-y-1 p-3')}>
                                <p className="text-xs text-muted-foreground">{t('detail.intervention.currentLabel', { defaultValue: 'Now' })}</p>
                                <p className="text-sm font-medium">{focusStatusText}</p>
                              </div>
                              <div className={cn(teamsPanelClass, 'space-y-1 p-3')}>
                                <p className="text-xs text-muted-foreground">{t('detail.intervention.needLabel', { defaultValue: 'Need me?' })}</p>
                                <p className={cn('text-sm font-medium', focusNeedsIntervention && 'text-amber-300')}>{focusInterventionText}</p>
                              </div>
                              <div className={cn(teamsPanelClass, 'space-y-1 p-3')}>
                                <p className="text-xs text-muted-foreground">{t('detail.intervention.etaLabel', { defaultValue: 'ETA' })}</p>
                                <p className="text-sm font-medium">{focusEtaText}</p>
                              </div>
                            </div>

                            {focusNeedsIntervention && (
                              <div className="mt-3 space-y-2">
                                <Label>{t('detail.intervention.noteLabel', { defaultValue: 'Intervention note' })}</Label>
                                <Textarea
                                  rows={3}
                                  value={interventionNote}
                                  onChange={(event) => setInterventionNote(event.target.value)}
                                  placeholder={t('detail.intervention.notePlaceholder', {
                                    defaultValue: 'Example: Confirm economy class, depart after 18:00, budget under $300.',
                                  })}
                                  className="border-border/70 bg-background/60"
                                />
                                <div className="flex items-center justify-between gap-3">
                                  <p className="text-xs text-muted-foreground">
                                    {focusCollaboration?.interventionMessage || t('detail.intervention.waitingInput', { defaultValue: 'Waiting for user input' })}
                                  </p>
                                  <Button
                                    size="sm"
                                    onClick={() => void onInterveneTask()}
                                    disabled={pendingAction !== 'none' || !interventionNote.trim()}
                                  >
                                    {t('detail.intervention.submit', { defaultValue: 'Submit intervention' })}
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        <div className="rounded-3xl border border-border/70 bg-background/70 p-4 shadow-[0_24px_70px_-40px_rgba(56,189,248,0.35)]">
                          <div className="space-y-3">
                          <div className="space-y-2">
                            <Label>{t('dispatch.taskInput')}</Label>
                            <Textarea
                              rows={4}
                              value={taskInput}
                              onChange={(event) => setTaskInput(event.target.value)}
                              placeholder={t('dispatch.taskPlaceholder')}
                              className="border-none bg-transparent px-0 shadow-none focus-visible:ring-0"
                            />
                          </div>

                          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                            <div className="w-full max-w-sm space-y-2">
                              <Label>{t('dispatch.protocol')}</Label>
                              <Select
                                value={taskProtocolOverrideEnabled ? taskCollaborationProtocol : TASK_PROTOCOL_TEAM_DEFAULT}
                                onChange={(event) => {
                                  const value = event.target.value;
                                  if (value === TASK_PROTOCOL_TEAM_DEFAULT) {
                                    setTaskProtocolOverrideEnabled(false);
                                    setTaskCollaborationProtocol(savedTeamProtocol);
                                    return;
                                  }
                                  setTaskProtocolOverrideEnabled(true);
                                  setTaskCollaborationProtocol(value as CollaborationProtocol);
                                }}
                              >
                                <option value={TASK_PROTOCOL_TEAM_DEFAULT}>
                                  {t('dispatch.protocolTeamDefault', {
                                    defaultValue: 'Team Default ({{protocol}})',
                                    protocol: formatProtocolLabel(savedTeamProtocol),
                                  })}
                                </option>
                                {COLLAB_PROTOCOL_OPTIONS.map((protocol) => (
                                  <option key={protocol} value={protocol}>
                                    {t(`dispatch.protocolOptions.${protocol}`)}
                                  </option>
                                ))}
                              </Select>
                            </div>

                            <div className="flex items-center gap-3">
                              <Button variant="outline" onClick={() => setDetailTab('studio')}>
                                {t('detail.nextWorkspace', { defaultValue: 'Open Studio' })}
                              </Button>
                              <Button
                                onClick={() => void onDispatchTask()}
                                disabled={pendingAction !== 'none' || selectedTeam.status !== 'running'}
                              >
                                <Send className="mr-2 h-4 w-4" />
                                {t('dispatch.submit')}
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <div className="space-y-4">
                  <Card className={teamsSurfaceCardClass}>
                    <CardHeader>
                      <div className="flex justify-start">
                        <div className="inline-flex rounded-xl border border-border/60 bg-background/60 p-1">
                          <button
                            type="button"
                            className={cn(
                              'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                              roomSidebarView === 'participants'
                                ? 'bg-primary text-primary-foreground shadow-sm'
                                : 'text-muted-foreground hover:text-foreground'
                            )}
                            onClick={() => setRoomSidebarView('participants')}
                          >
                            {t('detail.participantsTitle', { defaultValue: 'Participants' })}
                          </button>
                          <button
                            type="button"
                            className={cn(
                              'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                              roomSidebarView === 'tasks'
                                ? 'bg-primary text-primary-foreground shadow-sm'
                                : 'text-muted-foreground hover:text-foreground'
                            )}
                            onClick={() => setRoomSidebarView('tasks')}
                          >
                            {t('detail.boardTitle', { defaultValue: 'Task Board' })}
                          </button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {roomSidebarView === 'participants' ? (
                        selectedTeam.roles.map((role) => {
                          const runtimeRole = runtime?.roles.find((item) => item.roleId === role.id);
                          return (
                            <div key={role.id} className={cn(teamsPanelClass, 'flex items-start gap-3 p-3')}>
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-700 to-slate-900 text-sm font-semibold text-white">
                                {role.name.slice(0, 1).toUpperCase()}
                              </div>
                              <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="truncate text-sm font-medium">{role.name}</p>
                                  <Badge variant={statusVariant(runtimeRole?.status || 'stopped')}>
                                    {statusLabel(runtimeRole?.status || 'stopped')}
                                  </Badge>
                                </div>
                                <p className="text-xs text-muted-foreground">{toRoomExcerpt(role.personality, 70)}</p>
                                <div className="flex flex-wrap gap-1">
                                  <Badge variant="outline">{formatBindingLabel((role.agent?.provider || 'openclaw').trim())}</Badge>
                                  {role.skills?.slice(0, 1).map((skill) => (
                                    <Badge key={skill} variant="secondary">{skill}</Badge>
                                  ))}
                                </div>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <>
                          <div className="grid grid-cols-3 gap-2">
                            <div className={cn(teamsPanelClass, 'p-3')}>
                              <p className="text-xs text-muted-foreground">{t('status.queued')}</p>
                              <p className="mt-1 text-lg font-semibold">{tasks.filter((task) => task.status === 'queued').length}</p>
                            </div>
                            <div className={cn(teamsPanelClass, 'p-3')}>
                              <p className="text-xs text-muted-foreground">{t('status.running')}</p>
                              <p className="mt-1 text-lg font-semibold">{tasks.filter((task) => task.status === 'running').length}</p>
                            </div>
                            <div className={cn(teamsPanelClass, 'p-3')}>
                              <p className="text-xs text-muted-foreground">{t('status.completed')}</p>
                              <p className="mt-1 text-lg font-semibold">{completedTaskCount}</p>
                            </div>
                          </div>

                          <div className="space-y-2">
                            {spotlightTasks.length === 0 && (
                              <p className="text-sm text-muted-foreground">{t('dispatch.noTasks')}</p>
                            )}
                            {spotlightTasks.map((task) => {
                              const roleName = selectedTeam.roles.find((item) => item.id === task.assignedRoleId)?.name || task.assignedRoleId;
                              return (
                                <div key={task.id} className={cn(teamsPanelClass, 'space-y-1 p-3')}>
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="truncate text-sm font-medium">{roleName}</span>
                                    <Badge variant={statusVariant(task.status)}>{statusLabel(task.status)}</Badge>
                                  </div>
                                  <p className="line-clamp-2 text-xs text-muted-foreground">{task.input}</p>
                                </div>
                              );
                            })}
                          </div>

                          <Button variant="ghost" size="sm" className="px-0" onClick={() => openRunsTab('tasks')}>
                            {t('detail.viewAllTasks', { defaultValue: 'View all runs' })}
                          </Button>
                        </>
                      )}
                    </CardContent>
                  </Card>

                  <Card className={teamsSurfaceCardClass}>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <PackageOpen className="h-4 w-4 text-primary" />
                        {t('detail.artifactsTitle', { defaultValue: 'Artifacts' })}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {artifactSummaries.length === 0 && (
                        <div className={cn(teamsPanelClass, 'p-3 text-sm text-muted-foreground')}>
                          {t('detail.artifactsEmpty', { defaultValue: 'No delivered artifacts yet. The room will surface results here once people start replying.' })}
                        </div>
                      )}
                      {artifactSummaries.map((artifact) => (
                        <div key={artifact.id} className={cn(teamsPanelClass, 'space-y-2 p-3')}>
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              {artifact.status === 'failed' ? (
                                <AlertTriangle className="h-4 w-4 text-amber-400" />
                              ) : (
                                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                              )}
                              <span className="text-sm font-medium">{artifact.roleName}</span>
                            </div>
                            <span className="text-xs text-muted-foreground">{formatRelativeTime(artifact.timestamp)}</span>
                          </div>
                          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{artifact.title}</p>
                          <p className="text-sm text-muted-foreground">{artifact.excerpt}</p>
                        </div>
                      ))}

                      <Button variant="ghost" size="sm" className="px-0" onClick={() => openRunsTab('logs')}>
                        {t('detail.viewAllLogs', { defaultValue: 'View audit log' })}
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="studio" className="mt-6 space-y-4">
              <div className="grid gap-4 xl:grid-cols-[320px,1fr]">
                <Card className={teamsSurfaceCardClass}>
                  <CardHeader>
                    <CardTitle>{t('detail.workspaceTitle', { defaultValue: 'Team Blueprint' })}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">{t('custom.name')}</p>
                      <p className="mt-1 font-medium">{selectedTeam.name}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">{t('custom.domain')}</p>
                      <p className="mt-1 font-medium">{selectedTeam.domain}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">{t('custom.descriptionLabel')}</p>
                      <p className="mt-1 leading-6 text-muted-foreground">
                        {selectedTeam.description || t('detail.descriptionEmpty')}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">{t('roles.title')}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {selectedTeam.roles.map((role) => (
                          <Badge key={role.id} variant="outline">{role.name}</Badge>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>{t('detail.defaultProtocol', { defaultValue: 'Default Collaboration Protocol' })}</Label>
                      <Select
                        value={teamDefaultCollaborationProtocol}
                        onChange={(event) => setTeamDefaultCollaborationProtocol(event.target.value as CollaborationProtocol)}
                      >
                        {COLLAB_PROTOCOL_OPTIONS.map((protocol) => (
                          <option key={protocol} value={protocol}>
                            {t(`dispatch.protocolOptions.${protocol}`)}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="outline"
                        onClick={() => void onSaveTeamBlueprint()}
                        disabled={
                          pendingAction !== 'none'
                          || teamDefaultCollaborationProtocol === savedTeamProtocol
                        }
                      >
                        {t('detail.saveTeamSettings', { defaultValue: 'Save Team' })}
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={() => setTeamToDissolve(selectedTeam)}
                        disabled={pendingAction !== 'none'}
                      >
                        <Trash2 className="mr-1 h-4 w-4" />
                        {t('detail.dissolve')}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <Card className={teamsSurfaceCardClass}>
                  <CardHeader className="flex flex-row items-start justify-between gap-3">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <Bot className="h-4 w-4" />
                        {t('roles.title', { defaultValue: 'Roles & Engine Bindings' })}
                      </CardTitle>
                    </div>
                    <Button onClick={() => void onSaveRoles()} disabled={pendingAction !== 'none'}>
                      {t('roles.save', { defaultValue: 'Save Blueprint' })}
                    </Button>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {roleDrafts.map((draft, index) => {
                      const isExpanded = expandedRoleId === draft.id;
                      const showAdvanced = advancedRoleId === draft.id;
                      return (
                        <div key={draft.id} className={cn(teamsPanelClass, 'overflow-hidden')}>
                          <button
                            type="button"
                            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                            onClick={() => setExpandedRoleId(isExpanded ? null : draft.id)}
                          >
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium">{draft.name || draft.id}</span>
                                {renderRoleStatus(draft.id)}
                                <Badge variant={draft.enabled ? 'default' : 'outline'}>
                                  {draft.enabled
                                    ? t('roles.enabledState', { defaultValue: '已启用' })
                                    : t('roles.disabledState', { defaultValue: '已停用' })}
                                </Badge>
                              </div>
                              <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                                {draft.personality || t('roles.personaEmpty', { defaultValue: '未设置个性描述' })}
                              </p>
                            </div>
                            <ChevronRight className={cn('h-4 w-4 shrink-0 transition-transform', isExpanded && 'rotate-90')} />
                          </button>

                          {isExpanded && (
                            <div className="space-y-4 border-t border-border/70 bg-background/40 px-4 py-4">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="flex items-center gap-2">
                                  <Label htmlFor={`role-enabled-${draft.id}`}>{t('roles.enable')}</Label>
                                  <Switch
                                    id={`role-enabled-${draft.id}`}
                                    checked={draft.enabled}
                                    onCheckedChange={(checked) => updateRoleDraft(index, { enabled: checked })}
                                  />
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setAdvancedRoleId(showAdvanced ? null : draft.id)}
                                >
                                  {showAdvanced
                                    ? t('roles.hideAdvanced', { defaultValue: '收起运行字段' })
                                    : t('roles.showAdvanced', { defaultValue: '展开运行字段' })}
                                </Button>
                              </div>

                              <div className="grid gap-3 md:grid-cols-2">
                                <div className="space-y-2">
                                  <Label>{t('custom.name')}</Label>
                                  <Input
                                    value={draft.name}
                                    onChange={(event) => updateRoleDraft(index, { name: event.target.value })}
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label>{t('roles.keywords')}</Label>
                                  <Input
                                    value={draft.keywordsText}
                                    onChange={(event) => updateRoleDraft(index, { keywordsText: event.target.value })}
                                  />
                                </div>
                                <div className="space-y-2 md:col-span-2">
                                  <Label>{t('roles.persona')}</Label>
                                  <Textarea
                                    value={draft.personality}
                                    rows={3}
                                    onChange={(event) => updateRoleDraft(index, { personality: event.target.value })}
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label>{t('roles.skills')}</Label>
                                  <Input
                                    value={draft.skillsText}
                                    onChange={(event) => updateRoleDraft(index, { skillsText: event.target.value })}
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label>{t('roles.responsibilities')}</Label>
                                  <Textarea
                                    value={draft.responsibilitiesText}
                                    rows={3}
                                    onChange={(event) => updateRoleDraft(index, { responsibilitiesText: event.target.value })}
                                  />
                                </div>
                                <div className="space-y-2 md:col-span-2">
                                  <Label>{t('roles.boundaries')}</Label>
                                  <Textarea
                                    value={draft.boundariesText}
                                    rows={3}
                                    onChange={(event) => updateRoleDraft(index, { boundariesText: event.target.value })}
                                  />
                                </div>
                              </div>

                              {showAdvanced && (
                                <div className={cn(teamsPanelClass, 'space-y-3 p-3')}>
                                  <p className="text-sm font-medium">{t('roles.agentTitle')}</p>
                                  <div className="grid gap-3 md:grid-cols-2">
                                    <div className="space-y-2">
                                      <Label>{t('roles.agentProvider')}</Label>
                                      <Input
                                        value={draft.agentProvider}
                                        onChange={(event) => updateRoleDraft(index, { agentProvider: event.target.value })}
                                      />
                                    </div>
                                    <div className="space-y-2">
                                      <Label>{t('roles.agentModel')}</Label>
                                      <Input
                                        value={draft.agentModel}
                                        onChange={(event) => updateRoleDraft(index, { agentModel: event.target.value })}
                                      />
                                    </div>
                                    <div className="space-y-2">
                                      <Label>{t('roles.agentTemperature')}</Label>
                                      <Input
                                        type="number"
                                        min={0}
                                        max={2}
                                        step={0.1}
                                        value={draft.agentTemperatureText}
                                        onChange={(event) => updateRoleDraft(index, { agentTemperatureText: event.target.value })}
                                      />
                                    </div>
                                    <div className="space-y-2">
                                      <Label>{t('roles.agentMaxTokens')}</Label>
                                      <Input
                                        type="number"
                                        min={128}
                                        max={32768}
                                        step={1}
                                        value={draft.agentMaxTokensText}
                                        onChange={(event) => updateRoleDraft(index, { agentMaxTokensText: event.target.value })}
                                      />
                                    </div>
                                    <div className="space-y-2 md:col-span-2">
                                      <Label>{t('roles.agentSystemPrompt')}</Label>
                                      <Textarea
                                        rows={4}
                                        value={draft.agentSystemPrompt}
                                        onChange={(event) => updateRoleDraft(index, { agentSystemPrompt: event.target.value })}
                                      />
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="runs" className="mt-6 space-y-4">
              <Tabs value={runsTab} onValueChange={(value) => setRunsTab(value as TeamRunsTab)}>
                <TabsList className={cn(teamsTabsListClass, 'w-full max-w-xl grid-cols-2')}>
                  <TabsTrigger value="tasks">{t('dispatch.recentTasks')}</TabsTrigger>
                  <TabsTrigger value="logs">{t('dispatch.logs')}</TabsTrigger>
                </TabsList>

                <TabsContent value="tasks" className="mt-6">
                  <Card className={teamsSurfaceCardClass}>
                    <CardHeader>
                      <CardTitle>{t('dispatch.recentTasks')}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="max-h-[28rem] space-y-2 overflow-auto rounded-lg border p-2">
                        {tasks.length === 0 && <p className="text-xs text-muted-foreground">{t('dispatch.noTasks')}</p>}
                        {tasks.slice(0, 50).map((task) => {
                          const role = selectedTeam.roles.find((item) => item.id === task.assignedRoleId);
                          return (
                            <div key={task.id} className={cn(teamsPanelClass, 'space-y-1 p-3')}>
                              <div className="flex items-center justify-between gap-2">
                                <span className="truncate text-sm font-medium">{role?.name || task.assignedRoleId}</span>
                                <Badge variant={statusVariant(task.status)}>{statusLabel(task.status)}</Badge>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {new Date(task.requestedAt).toLocaleString()}
                              </p>
                              <p className="line-clamp-3 text-sm text-muted-foreground">{task.input}</p>
                              {task.result && <p className="whitespace-pre-wrap text-sm">{task.result}</p>}
                              {task.error && <p className="text-sm text-destructive">{task.error}</p>}
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="logs" className="mt-6">
                  <Card className={teamsSurfaceCardClass}>
                    <CardHeader>
                      <CardTitle>{t('dispatch.logs')}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="max-h-[28rem] space-y-1 overflow-auto rounded-lg border p-2">
                        {latestLogs.length === 0 && <p className="text-xs text-muted-foreground">{t('dispatch.noLogs')}</p>}
                        {latestLogs.slice(0, 120).map((entry) => (
                          <div key={entry.id} className="border-b pb-2 text-xs leading-relaxed last:border-b-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-muted-foreground">{new Date(entry.timestamp).toLocaleString()}</span>
                              <Badge variant={statusVariant(entry.level)}>{statusLabel(entry.level)}</Badge>
                            </div>
                            <p className="mt-1 text-sm">{entry.message}</p>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </TabsContent>
          </Tabs>
        </div>
      )}

      {createDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setCreateDialogOpen(false)}>
          <Card className={cn(teamsSurfaceCardClass, 'max-h-[90vh] w-full max-w-3xl overflow-y-auto')} onClick={(event) => event.stopPropagation()}>
            <CardHeader className="flex flex-row items-start justify-between">
              <div>
                <CardTitle>{t('create.title')}</CardTitle>
                <CardDescription>{t('create.description')}</CardDescription>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setCreateDialogOpen(false)} disabled={creatingTeam}>
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <Tabs value={createMode} onValueChange={(value) => setCreateMode(value as CreateMode)}>
                <TabsList className={cn(teamsTabsListClass, 'w-full grid-cols-2')}>
                  <TabsTrigger value="template">{t('create.fromTemplate')}</TabsTrigger>
                  <TabsTrigger value="custom">{t('create.custom')}</TabsTrigger>
                </TabsList>

                <TabsContent value="template" className="mt-4 space-y-4">
                  <div className="space-y-2">
                    <Label>{t('create.template')}</Label>
                    <Select
                      value={selectedTemplateId}
                      onChange={(event) => setSelectedTemplateId(event.target.value)}
                      disabled={templates.length === 0 || creatingTeam}
                    >
                      {templates.map((template) => (
                        <option key={template.id} value={template.id}>{template.name}</option>
                      ))}
                    </Select>
                  </div>

                  {selectedTemplate && (
                    <Card className={cn(teamsSurfaceCardClass, 'bg-muted/20')}>
                      <CardContent className="space-y-2 py-4">
                        <p className="text-sm font-medium">{selectedTemplate.name}</p>
                        <p className="text-xs text-muted-foreground">{selectedTemplate.description}</p>
                        <div className="flex flex-wrap gap-1">
                          {selectedTemplate.roles.map((role) => (
                            <Badge key={role.id} variant="secondary">{role.name}</Badge>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  <div className="space-y-2">
                    <Label>{t('create.nameOverride')}</Label>
                    <Input
                      placeholder={t('template.nameOverridePlaceholder')}
                      value={templateTeamName}
                      onChange={(event) => setTemplateTeamName(event.target.value)}
                      disabled={creatingTeam}
                    />
                  </div>

                  {renderAgentPresetEditor(templateAgentForm, (patch) => {
                    setTemplateAgentForm((prev) => ({ ...prev, ...patch }));
                  })}

                  <Button
                    className="w-full"
                    onClick={() => { void onCreateFromTemplate(selectedTemplateId); }}
                    disabled={creatingTeam || !selectedTemplateId}
                  >
                    {creatingTeam ? t('create.creating') : t('create.createFromTemplate')}
                  </Button>
                </TabsContent>

                <TabsContent value="custom" className="mt-4 space-y-3">
                  <div className="space-y-2">
                    <Label>{t('custom.name')}</Label>
                    <Input
                      value={customName}
                      onChange={(event) => setCustomName(event.target.value)}
                      placeholder={t('custom.namePlaceholder')}
                      disabled={creatingTeam}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('custom.domain')}</Label>
                    <Input
                      value={customDomain}
                      onChange={(event) => setCustomDomain(event.target.value)}
                      placeholder={t('custom.domainPlaceholder')}
                      disabled={creatingTeam}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('custom.descriptionLabel')}</Label>
                    <Textarea
                      value={customDescription}
                      onChange={(event) => setCustomDescription(event.target.value)}
                      rows={4}
                      placeholder={t('custom.descriptionPlaceholder')}
                      disabled={creatingTeam}
                    />
                  </div>

                  {renderAgentPresetEditor(customAgentForm, (patch) => {
                    setCustomAgentForm((prev) => ({ ...prev, ...patch }));
                  })}

                  <Button className="w-full" onClick={() => { void onCreateCustomTeam(); }} disabled={creatingTeam}>
                    {creatingTeam ? t('create.creating') : t('custom.create')}
                  </Button>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      )}

      <ConfirmDialog
        open={!!teamToDissolve}
        title={t('dialog.dissolveTitle')}
        message={teamToDissolve ? t('dialog.dissolveMessage', { name: teamToDissolve.name }) : ''}
        confirmLabel={t('dialog.dissolveConfirm')}
        cancelLabel={t('dialog.cancel')}
        variant="destructive"
        onConfirm={() => {
          if (!teamToDissolve) return;
          const pendingTeamId = teamToDissolve.id;
          void dissolveTeam(pendingTeamId)
            .then(() => {
              if (routeTeamId === pendingTeamId) {
                navigate(APP_ROUTES.workspace.teams);
              }
              toast.success(t('toast.teamDissolved'));
              setTeamToDissolve(null);
            })
            .catch((actionError) => {
              toast.error(String(actionError));
              setTeamToDissolve(null);
            });
        }}
        onCancel={() => setTeamToDissolve(null)}
      />
    </div>
  );
}
