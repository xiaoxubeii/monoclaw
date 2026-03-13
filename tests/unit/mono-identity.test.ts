import { describe, expect, it } from 'vitest';
import {
  createDidPeerIdentity,
  publicIdentityFromRecord,
  resolveDidPeer2,
  signPayload,
  verifyPayload,
} from '@mono/identity';

describe('mono identity', () => {
  it('creates a did:peer:2 identity that resolves back into the same document', async () => {
    const identity = await createDidPeerIdentity();

    expect(identity.did.startsWith('did:peer:2.')).toBe(true);
    expect(resolveDidPeer2(identity.did)).toEqual(identity.document);
  });

  it('signs and verifies payloads with the generated authentication key', async () => {
    const identity = await createDidPeerIdentity();
    const publicIdentity = publicIdentityFromRecord(identity);
    const payload = `mono:${publicIdentity.did}`;
    const signature = signPayload(identity.privateKeyPem, payload);

    expect(verifyPayload(identity.publicKeyPem, payload, signature)).toBe(true);
    expect(verifyPayload(identity.publicKeyPem, `${payload}:tampered`, signature)).toBe(false);
  });
});
