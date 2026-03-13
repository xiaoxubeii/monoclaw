import { join } from 'node:path';
import { createDidPeerIdentity, publicIdentityFromRecord } from '@mono/identity';
import type { MonoLocalIdentityRecord, MonoPublicIdentity } from '@mono/types';
import { ensureMonoConnectDir, readJsonFile, writeJsonFile } from './storage';

const IDENTITY_FILE_NAME = 'identity.json';

export class MonoKeyStore {
  private identityCache: MonoLocalIdentityRecord | null = null;

  private async getFilePath(): Promise<string> {
    return join(await ensureMonoConnectDir(), IDENTITY_FILE_NAME);
  }

  async loadOrCreateIdentity(): Promise<MonoLocalIdentityRecord> {
    if (this.identityCache) {
      return this.identityCache;
    }

    const filePath = await this.getFilePath();
    const stored = await readJsonFile<MonoLocalIdentityRecord | null>(filePath, null);
    if (stored && stored.did && stored.document && stored.privateKeyPem && stored.publicKeyPem) {
      this.identityCache = stored;
      return stored;
    }

    const created = await createDidPeerIdentity();
    this.identityCache = created;
    await writeJsonFile(filePath, created);
    return created;
  }

  async getPublicIdentity(): Promise<MonoPublicIdentity> {
    return publicIdentityFromRecord(await this.loadOrCreateIdentity());
  }
}
