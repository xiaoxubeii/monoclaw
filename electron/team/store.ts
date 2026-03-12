import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { access, constants } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getMonoclawConfigDir } from '../utils/paths';
import { logger } from '../utils/logger';
import type { PersistedTeamStore, TeamRoleDefinition, VirtualTeam } from './types';

const STORE_VERSION = 1;
const ROOT_DIR = join(getMonoclawConfigDir(), 'virtual-teams');
const TEAM_ROOT_DIR = join(ROOT_DIR, 'teams');
const STORE_FILE = join(ROOT_DIR, 'teams.json');

function resolveWithin(baseDir: string, ...paths: string[]): string {
  const target = resolve(baseDir, ...paths);
  const normalizedBase = resolve(baseDir);
  const allowPrefix = normalizedBase.endsWith(sep) ? normalizedBase : `${normalizedBase}${sep}`;
  // Guard against directory traversal to keep all team assets under managed monoclaw config.
  if (target !== normalizedBase && !target.startsWith(allowPrefix)) {
    throw new Error(`Unsafe path resolution blocked: ${target}`);
  }
  return target;
}

function assertId(id: string, kind: string): void {
  if (!/^[a-z0-9][a-z0-9-_]{1,63}$/i.test(id)) {
    throw new Error(`Invalid ${kind} id: ${id}`);
  }
}

function buildSoulMarkdown(role: TeamRoleDefinition): string {
  const responsibilities = role.responsibilities.map((item) => `- ${item}`).join("\n");
  const boundaries = role.boundaries.map((item) => `- ${item}`).join("\n");
  const keywords = role.keywords.map((item) => `- ${item}`).join("\n");
  const skills = (role.skills ?? []).map((item) => `- ${item}`).join("\n");

  const agentProvider = role.agent?.provider?.trim() || 'openclaw';
  const agentModel = role.agent?.model?.trim() || 'auto';
  const agentTemperature = typeof role.agent?.temperature === 'number'
    ? String(role.agent.temperature)
    : '0.2';
  const agentMaxTokens = typeof role.agent?.maxTokens === 'number'
    ? String(Math.round(role.agent.maxTokens))
    : '2048';
  const agentSystemPrompt = role.agent?.systemPrompt?.trim() || [
    `You are ${role.name}.`,
    `Persona: ${role.personality || 'Professional and focused.'}.`,
    'Follow responsibilities and boundaries defined in this SOUL profile.',
    `Use role-bound skills when needed: ${(role.skills ?? []).join(', ') || 'none'}.`,
    'Return actionable output with concise structure.',
  ].join("\n");

  return [
    `# ${role.name} SOUL`,
    '',
    '## Core Persona',
    role.personality || 'Professional, reliable, and focused on assigned responsibilities.',
    '',
    '## Responsibilities',
    responsibilities || '- Follow assigned tasks and provide concrete deliverables.',
    '',
    '## Boundaries',
    boundaries || '- Do not exceed assigned domain responsibilities.',
    '',
    '## Routing Keywords',
    keywords || '- general',
    '',
    '## Bound Skills',
    skills || '- none',
    '',
    '## OpenClaw Agent',
    `- Provider: ${agentProvider}`,
    `- Model: ${agentModel}`,
    `- Temperature: ${agentTemperature}`,
    `- Max Tokens: ${agentMaxTokens}`,
    '',
    '### Agent System Prompt',
    '```text',
    agentSystemPrompt,
    '```',
    '',
    '## Operational Rules',
    '- Always return actionable output first.',
    '- State assumptions when information is incomplete.',
    '- Escalate when task scope crosses boundaries.',
    '',
  ].join("\n");
}

async function fileExists(filePath: string): Promise<boolean> {
  return new Promise((resolvePromise) => {
    access(filePath, constants.F_OK, (error) => {
      resolvePromise(!error);
    });
  });
}

async function ensureRootDirectories(): Promise<void> {
  await mkdir(ROOT_DIR, { recursive: true, mode: 0o700 });
  await mkdir(TEAM_ROOT_DIR, { recursive: true, mode: 0o700 });
}

async function atomicWriteUtf8(filePath: string, content: string): Promise<void> {
  // Write-rename ensures we never leave a partially written config file.
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(tempPath, content, { encoding: 'utf-8', mode: 0o600 });
  await rename(tempPath, filePath);
}

async function readPersistedStore(): Promise<PersistedTeamStore> {
  await ensureRootDirectories();

  if (!(await fileExists(STORE_FILE))) {
    return { version: STORE_VERSION, teams: [] };
  }

  try {
    const content = await readFile(STORE_FILE, 'utf-8');
    const parsed = JSON.parse(content) as Partial<PersistedTeamStore>;
    const version = parsed.version === STORE_VERSION ? STORE_VERSION : STORE_VERSION;
    const teams = Array.isArray(parsed.teams) ? parsed.teams : [];
    return { version, teams };
  } catch (error) {
    logger.warn('Failed to read persisted team store, fallback to empty store', error);
    return { version: STORE_VERSION, teams: [] };
  }
}

async function writePersistedStore(store: PersistedTeamStore): Promise<void> {
  await ensureRootDirectories();
  await atomicWriteUtf8(STORE_FILE, JSON.stringify(store, null, 2));
}

export class TeamPersistenceStore {
  async listTeams(): Promise<VirtualTeam[]> {
    const store = await readPersistedStore();
    return store.teams;
  }

  async saveTeams(teams: VirtualTeam[]): Promise<void> {
    await writePersistedStore({
      version: STORE_VERSION,
      teams,
    });
  }

  async saveTeam(team: VirtualTeam): Promise<void> {
    const current = await readPersistedStore();
    const idx = current.teams.findIndex((item) => item.id === team.id);

    if (idx >= 0) {
      current.teams[idx] = team;
    } else {
      current.teams.push(team);
    }

    await writePersistedStore(current);
  }

  async removeTeam(teamId: string): Promise<void> {
    assertId(teamId, 'team');
    const current = await readPersistedStore();
    current.teams = current.teams.filter((item) => item.id !== teamId);
    await writePersistedStore(current);

    const teamDir = this.getTeamDir(teamId);
    await rm(teamDir, { recursive: true, force: true });
  }

  getRootDir(): string {
    return ROOT_DIR;
  }

  getTeamDir(teamId: string): string {
    assertId(teamId, 'team');
    return resolveWithin(TEAM_ROOT_DIR, teamId);
  }

  getRoleDir(teamId: string, roleId: string): string {
    assertId(roleId, 'role');
    return resolveWithin(this.getTeamDir(teamId), 'roles', roleId);
  }

  getRoleSoulPath(teamId: string, roleId: string): string {
    return resolveWithin(this.getRoleDir(teamId, roleId), 'SOUL.md');
  }

  async ensureTeamFilesystem(team: VirtualTeam): Promise<void> {
    const teamDir = this.getTeamDir(team.id);
    const rolesDir = resolveWithin(teamDir, 'roles');
    await mkdir(teamDir, { recursive: true, mode: 0o700 });
    await mkdir(rolesDir, { recursive: true, mode: 0o700 });

    for (const role of team.roles) {
      assertId(role.id, 'role');
      const roleDir = this.getRoleDir(team.id, role.id);
      await mkdir(roleDir, { recursive: true, mode: 0o700 });
      const soulPath = this.getRoleSoulPath(team.id, role.id);
      const soulContent = buildSoulMarkdown(role);
      await atomicWriteUtf8(soulPath, soulContent);
    }
  }

  async cleanupStaleRoleDirectories(team: VirtualTeam): Promise<void> {
    const teamDir = this.getTeamDir(team.id);
    const rolesDir = resolveWithin(teamDir, 'roles');
    await mkdir(rolesDir, { recursive: true, mode: 0o700 });

    const expectedRoleDirs = new Set(team.roles.map((role) => role.id));

    try {
      const { readdir } = await import('node:fs/promises');
      const entries = await readdir(rolesDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (expectedRoleDirs.has(entry.name)) continue;
        const stalePath = resolveWithin(rolesDir, entry.name);
        await rm(stalePath, { recursive: true, force: true });
      }
    } catch (error) {
      logger.warn(`Failed to cleanup stale role directories for team ${team.id}`, error);
    }
  }
}
