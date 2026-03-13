import { join } from 'node:path';
import type {
  MonoPeerPolicy,
  MonoPeerPolicyLimits,
  MonoPeerPolicyPatch,
} from '@mono/types';
import { ensureMonoConnectDir, readJsonFile, writeJsonFile } from './storage';

const POLICY_STORE_FILE_NAME = 'peer-policy-store.json';

const DEFAULT_LIMITS: MonoPeerPolicyLimits = {
  requestsPerMinute: 6,
  maxInputChars: 8000,
  maxTokens: 2048,
  timeoutMs: 90000,
};

function normalizeList(value: string[] | undefined): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const items: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const item = raw.trim();
    if (!item || seen.has(item)) continue;
    seen.add(item);
    items.push(item);
  }
  return items;
}

function normalizeLimits(limits?: Partial<MonoPeerPolicyLimits>): MonoPeerPolicyLimits {
  return {
    requestsPerMinute: Math.max(1, Math.floor(Number(limits?.requestsPerMinute ?? DEFAULT_LIMITS.requestsPerMinute))),
    maxInputChars: Math.max(1, Math.floor(Number(limits?.maxInputChars ?? DEFAULT_LIMITS.maxInputChars))),
    maxTokens: Math.max(1, Math.floor(Number(limits?.maxTokens ?? DEFAULT_LIMITS.maxTokens))),
    timeoutMs: Math.max(1000, Math.floor(Number(limits?.timeoutMs ?? DEFAULT_LIMITS.timeoutMs))),
  };
}

function buildDefaultPolicy(did: string): MonoPeerPolicy {
  const now = new Date().toISOString();
  return {
    did,
    mode: 'ask',
    scopes: ['agent.invoke'],
    allowedTools: [],
    allowedFileRoots: [],
    limits: { ...DEFAULT_LIMITS },
    createdAt: now,
    updatedAt: now,
  };
}

export class MonoPolicyStore {
  private async getFilePath(): Promise<string> {
    return join(await ensureMonoConnectDir(), POLICY_STORE_FILE_NAME);
  }

  async list(): Promise<MonoPeerPolicy[]> {
    const filePath = await this.getFilePath();
    const records = await readJsonFile<MonoPeerPolicy[]>(filePath, []);
    return [...records].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async getByDid(did: string): Promise<MonoPeerPolicy | null> {
    const records = await this.list();
    return records.find((record) => record.did === did) ?? null;
  }

  async getOrCreateDefault(did: string): Promise<MonoPeerPolicy> {
    const existing = await this.getByDid(did);
    if (existing) return existing;
    return this.upsert(did, {});
  }

  async upsert(did: string, patch: MonoPeerPolicyPatch): Promise<MonoPeerPolicy> {
    const filePath = await this.getFilePath();
    const records = await this.list();
    const now = new Date().toISOString();
    const existingIndex = records.findIndex((record) => record.did === did);
    const base = existingIndex >= 0 ? records[existingIndex] : buildDefaultPolicy(did);

    const nextLimits = normalizeLimits({
      ...base.limits,
      ...(patch.limits ?? {}),
    });

    const nextRecord: MonoPeerPolicy = {
      ...base,
      did,
      mode: patch.mode ?? base.mode,
      scopes: normalizeList(patch.scopes ?? base.scopes) as MonoPeerPolicy['scopes'],
      allowedTools: normalizeList(patch.allowedTools ?? base.allowedTools),
      allowedFileRoots: normalizeList(patch.allowedFileRoots ?? base.allowedFileRoots),
      limits: nextLimits,
      updatedAt: now,
      createdAt: base.createdAt || now,
    };

    if (nextRecord.scopes.length === 0) {
      nextRecord.scopes = ['agent.invoke'];
    }

    const nextRecords = existingIndex >= 0
      ? records.map((record, index) => (index === existingIndex ? nextRecord : record))
      : [nextRecord, ...records];

    await writeJsonFile(filePath, nextRecords);
    return nextRecord;
  }
}

