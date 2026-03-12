/**
 * OpenClaw workspace context utilities.
 *
 * All file I/O is async (fs/promises) to avoid blocking the Electron
 * main thread.
 */
import { access, readFile, writeFile, readdir, mkdir, unlink } from 'fs/promises';
import { constants, Dirent } from 'fs';
import { join } from 'path';
import { logger } from './logger';
import { expandPath, getOpenClawConfigDir, getResourcesDir } from './paths';

const MONOCLAW_BEGIN = '<!-- monoclaw:begin -->';
const MONOCLAW_END = '<!-- monoclaw:end -->';

// ── Helpers ──────────────────────────────────────────────────────

async function fileExists(p: string): Promise<boolean> {
  try { await access(p, constants.F_OK); return true; } catch { return false; }
}

async function ensureDir(dir: string): Promise<void> {
  if (!(await fileExists(dir))) {
    await mkdir(dir, { recursive: true });
  }
}

// ── Pure helpers (no I/O) ────────────────────────────────────────

/**
 * Merge a Monoclaw context section into an existing file's content.
 * If markers already exist, replaces the section in-place.
 * Otherwise appends it at the end.
 */
export function mergeMonoclawSection(existing: string, section: string): string {
  const wrapped = `${MONOCLAW_BEGIN}\n${section.trim()}\n${MONOCLAW_END}`;
  const beginIdx = existing.indexOf(MONOCLAW_BEGIN);
  const endIdx = existing.indexOf(MONOCLAW_END);
  if (beginIdx !== -1 && endIdx !== -1) {
    return existing.slice(0, beginIdx) + wrapped + existing.slice(endIdx + MONOCLAW_END.length);
  }
  return existing.trimEnd() + '\n\n' + wrapped + '\n';
}

// ── Workspace directory resolution ───────────────────────────────

/**
 * Collect all unique workspace directories from the openclaw config:
 * the defaults workspace, each agent's workspace, and any workspace-*
 * directories that already exist under the OpenClaw state directory.
 */
async function resolveAllWorkspaceDirs(): Promise<string[]> {
  const openclawDir = getOpenClawConfigDir();
  const dirs = new Set<string>();

  const configPath = join(openclawDir, 'openclaw.json');
  try {
    if (await fileExists(configPath)) {
      const config = JSON.parse(await readFile(configPath, 'utf-8'));

      const defaultWs = config?.agents?.defaults?.workspace;
      if (typeof defaultWs === 'string' && defaultWs.trim()) {
        dirs.add(expandPath(defaultWs));
      }

      const agents = config?.agents?.list;
      if (Array.isArray(agents)) {
        for (const agent of agents) {
          const ws = agent?.workspace;
          if (typeof ws === 'string' && ws.trim()) {
            dirs.add(expandPath(ws));
          }
        }
      }
    }
  } catch {
    // ignore config parse errors
  }

  try {
    const entries: Dirent[] = await readdir(openclawDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('workspace')) {
        dirs.add(join(openclawDir, entry.name));
      }
    }
  } catch {
    // ignore read errors
  }

  if (dirs.size === 0) {
    dirs.add(join(openclawDir, 'workspace'));
  }

  return [...dirs];
}

// ── Bootstrap file repair ────────────────────────────────────────

/**
 * Detect and remove bootstrap .md files that contain only Monoclaw markers
 * with no meaningful OpenClaw content outside them.
 */
export async function repairMonoclawOnlyBootstrapFiles(): Promise<void> {
  const workspaceDirs = await resolveAllWorkspaceDirs();
  for (const workspaceDir of workspaceDirs) {
    if (!(await fileExists(workspaceDir))) continue;

    let entries: string[];
    try {
      entries = (await readdir(workspaceDir)).filter((f) => f.endsWith('.md'));
    } catch {
      continue;
    }

    for (const file of entries) {
      const filePath = join(workspaceDir, file);
      let content: string;
      try {
        content = await readFile(filePath, 'utf-8');
      } catch {
        continue;
      }
      const beginIdx = content.indexOf(MONOCLAW_BEGIN);
      const endIdx = content.indexOf(MONOCLAW_END);
      if (beginIdx === -1 || endIdx === -1) continue;

      const before = content.slice(0, beginIdx).trim();
      const after = content.slice(endIdx + MONOCLAW_END.length).trim();
      if (before === '' && after === '') {
        try {
          await unlink(filePath);
          logger.info(`Removed Monoclaw-only bootstrap file for re-seeding: ${file} (${workspaceDir})`);
        } catch {
          logger.warn(`Failed to remove Monoclaw-only bootstrap file: ${filePath}`);
        }
      }
    }
  }
}

// ── Context merging ──────────────────────────────────────────────

/**
 * Merge Monoclaw context snippets into workspace bootstrap files that
 * already exist on disk.  Returns the number of target files that were
 * skipped because they don't exist yet.
 */
async function mergeMonoclawContextOnce(): Promise<number> {
  const contextDir = join(getResourcesDir(), 'context');
  if (!(await fileExists(contextDir))) {
    logger.debug('Monoclaw context directory not found, skipping context merge');
    return 0;
  }

  let files: string[];
  try {
    files = (await readdir(contextDir)).filter((f) => f.endsWith('.monoclaw.md'));
  } catch {
    return 0;
  }

  const workspaceDirs = await resolveAllWorkspaceDirs();
  let skipped = 0;

  for (const workspaceDir of workspaceDirs) {
    await ensureDir(workspaceDir);

    for (const file of files) {
      const targetName = file.replace('.monoclaw.md', '.md');
      const targetPath = join(workspaceDir, targetName);

      if (!(await fileExists(targetPath))) {
        logger.debug(`Skipping ${targetName} in ${workspaceDir} (file does not exist yet, will be seeded by gateway)`);
        skipped++;
        continue;
      }

      const section = await readFile(join(contextDir, file), 'utf-8');
      const existing = await readFile(targetPath, 'utf-8');

      const merged = mergeMonoclawSection(existing, section);
      if (merged !== existing) {
        await writeFile(targetPath, merged, 'utf-8');
        logger.info(`Merged Monoclaw context into ${targetName} (${workspaceDir})`);
      }
    }
  }

  return skipped;
}

const RETRY_INTERVAL_MS = 2000;
const MAX_RETRIES = 15;

/**
 * Ensure Monoclaw context snippets are merged into the openclaw workspace
 * bootstrap files.
 */
export async function ensureMonoclawContext(): Promise<void> {
  let skipped = await mergeMonoclawContextOnce();
  if (skipped === 0) return;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    await new Promise((r) => setTimeout(r, RETRY_INTERVAL_MS));
    skipped = await mergeMonoclawContextOnce();
    if (skipped === 0) {
      logger.info(`Monoclaw context merge completed after ${attempt} retry(ies)`);
      return;
    }
    logger.debug(`Monoclaw context merge: ${skipped} file(s) still missing (retry ${attempt}/${MAX_RETRIES})`);
  }

  logger.warn(`Monoclaw context merge: ${skipped} file(s) still missing after ${MAX_RETRIES} retries`);
}
