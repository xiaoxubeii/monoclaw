import { describe, expect, it } from 'vitest';
import { createDidPeerIdentity, createNonce } from '@mono/identity';
import {
  createClientResponseFrame,
  createHandshakeSessionId,
  createServerChallengeFrame,
  verifyClientResponseFrame,
  verifyServerChallengeFrame,
} from '@mono/handshake';

describe('mono handshake', () => {
  it('completes a mutual challenge-response round trip', async () => {
    const initiator = await createDidPeerIdentity();
    const responder = await createDidPeerIdentity();

    const hello = {
      type: 'hello' as const,
      version: 1 as const,
      sessionId: createHandshakeSessionId(),
      did: initiator.did,
      didDocument: initiator.document,
      nonce: createNonce(),
      sentAt: new Date().toISOString(),
    };

    const challenge = createServerChallengeFrame({
      hello,
      responderIdentity: responder,
      responderNonce: createNonce(),
    });

    expect(verifyServerChallengeFrame({ hello, challenge })).toBe(true);

    const response = createClientResponseFrame({
      hello,
      challenge,
      initiatorIdentity: initiator,
    });

    expect(verifyClientResponseFrame({ hello, challenge, response })).toBe(true);
  });
});
