import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getAssistantDataLayout } from '../utils/assistant-data-paths';

export function getMonoConnectDir(): string {
  return join(getAssistantDataLayout().monoclawConfigDir, 'mono_connect');
}

export async function ensureMonoConnectDir(): Promise<string> {
  const dir = getMonoConnectDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
