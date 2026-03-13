import { join } from 'node:path';
import type {
  ConnectivityKind,
  MonoDidDocument,
  MonoTransportKind,
  MonoTrustRecord,
} from '@mono/types';
import { ensureMonoConnectDir, readJsonFile, writeJsonFile } from './storage';

const TRUST_STORE_FILE_NAME = 'trust-store.json';

interface UpsertTrustRecordInput {
  did: string;
  document: MonoDidDocument;
  alias?: string;
  lastKnownHost?: string;
  lastKnownPort?: number;
  connectionKind?: ConnectivityKind;
  transport?: MonoTransportKind;
}

export class MonoTrustStore {
  private async getFilePath(): Promise<string> {
    return join(await ensureMonoConnectDir(), TRUST_STORE_FILE_NAME);
  }

  async list(): Promise<MonoTrustRecord[]> {
    const filePath = await this.getFilePath();
    const records = await readJsonFile<MonoTrustRecord[]>(filePath, []);
    return [...records].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async upsertVerifiedRecord(input: UpsertTrustRecordInput): Promise<MonoTrustRecord> {
    const filePath = await this.getFilePath();
    const records = await this.list();
    const now = new Date().toISOString();
    const existingIndex = records.findIndex((record) => record.did === input.did);

    const nextRecord: MonoTrustRecord = existingIndex >= 0
      ? {
          ...records[existingIndex],
          document: input.document,
          state: 'verified',
          alias: input.alias ?? records[existingIndex].alias,
          verifiedAt: now,
          updatedAt: now,
          lastSeenAt: now,
          lastSeenTransport: input.transport ?? records[existingIndex].lastSeenTransport ?? 'tailnet',
          lastConnectionKind: input.connectionKind ?? records[existingIndex].lastConnectionKind ?? 'unknown',
          lastKnownHost: input.lastKnownHost ?? records[existingIndex].lastKnownHost,
          lastKnownPort: input.lastKnownPort ?? records[existingIndex].lastKnownPort,
        }
      : {
          did: input.did,
          document: input.document,
          state: 'verified',
          verifiedAt: now,
          createdAt: now,
          updatedAt: now,
          alias: input.alias,
          lastSeenAt: now,
          lastSeenTransport: input.transport ?? 'tailnet',
          lastConnectionKind: input.connectionKind ?? 'unknown',
          lastKnownHost: input.lastKnownHost,
          lastKnownPort: input.lastKnownPort,
        };

    const nextRecords = existingIndex >= 0
      ? records.map((record, index) => (index === existingIndex ? nextRecord : record))
      : [nextRecord, ...records];

    await writeJsonFile(filePath, nextRecords);
    return nextRecord;
  }

  async revoke(did: string): Promise<void> {
    const filePath = await this.getFilePath();
    const records = await this.list();
    const now = new Date().toISOString();
    const nextRecords = records.map((record) => (
      record.did === did
        ? { ...record, state: 'revoked' as const, updatedAt: now }
        : record
    ));
    await writeJsonFile(filePath, nextRecords);
  }
}
