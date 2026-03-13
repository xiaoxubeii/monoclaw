import crypto from 'node:crypto';
import {
  publicKeyPemFromDidDocument,
  signPayload,
  verifyPayload,
} from '@mono/identity';
import type {
  MonoFrame,
  MonoHandshakeChallengeFrame,
  MonoHandshakeFrame,
  MonoHandshakeHelloFrame,
  MonoHandshakeResponseFrame,
  MonoLocalIdentityRecord,
} from '@mono/types';

const HANDSHAKE_PREFIX = 'mono-handshake-v1';

export function createHandshakeSessionId(): string {
  return crypto.randomUUID();
}

function buildPayload(parts: string[]): string {
  return [HANDSHAKE_PREFIX, ...parts].join('|');
}

export function buildServerChallengePayload(input: {
  sessionId: string;
  initiatorDid: string;
  responderDid: string;
  initiatorNonce: string;
  responderNonce: string;
}): string {
  return buildPayload([
    'server-challenge',
    input.sessionId,
    input.initiatorDid,
    input.responderDid,
    input.initiatorNonce,
    input.responderNonce,
  ]);
}

export function buildClientResponsePayload(input: {
  sessionId: string;
  initiatorDid: string;
  responderDid: string;
  initiatorNonce: string;
  responderNonce: string;
}): string {
  return buildPayload([
    'client-response',
    input.sessionId,
    input.initiatorDid,
    input.responderDid,
    input.initiatorNonce,
    input.responderNonce,
  ]);
}

export function createServerChallengeFrame(input: {
  hello: MonoHandshakeHelloFrame;
  responderIdentity: MonoLocalIdentityRecord;
  responderNonce: string;
}): MonoHandshakeChallengeFrame {
  const payload = buildServerChallengePayload({
    sessionId: input.hello.sessionId,
    initiatorDid: input.hello.did,
    responderDid: input.responderIdentity.did,
    initiatorNonce: input.hello.nonce,
    responderNonce: input.responderNonce,
  });

  return {
    type: 'challenge',
    version: 1,
    sessionId: input.hello.sessionId,
    did: input.responderIdentity.did,
    didDocument: input.responderIdentity.document,
    nonce: input.responderNonce,
    respondingToNonce: input.hello.nonce,
    signature: signPayload(input.responderIdentity.privateKeyPem, payload),
    sentAt: new Date().toISOString(),
  };
}

export function verifyServerChallengeFrame(input: {
  hello: MonoHandshakeHelloFrame;
  challenge: MonoHandshakeChallengeFrame;
}): boolean {
  const payload = buildServerChallengePayload({
    sessionId: input.challenge.sessionId,
    initiatorDid: input.hello.did,
    responderDid: input.challenge.did,
    initiatorNonce: input.hello.nonce,
    responderNonce: input.challenge.nonce,
  });

  return verifyPayload(
    publicKeyPemFromDidDocument(input.challenge.didDocument),
    payload,
    input.challenge.signature,
  );
}

export function createClientResponseFrame(input: {
  hello: MonoHandshakeHelloFrame;
  challenge: MonoHandshakeChallengeFrame;
  initiatorIdentity: MonoLocalIdentityRecord;
}): MonoHandshakeResponseFrame {
  const payload = buildClientResponsePayload({
    sessionId: input.challenge.sessionId,
    initiatorDid: input.initiatorIdentity.did,
    responderDid: input.challenge.did,
    initiatorNonce: input.hello.nonce,
    responderNonce: input.challenge.nonce,
  });

  return {
    type: 'response',
    version: 1,
    sessionId: input.challenge.sessionId,
    did: input.initiatorIdentity.did,
    respondingToNonce: input.challenge.nonce,
    signature: signPayload(input.initiatorIdentity.privateKeyPem, payload),
    sentAt: new Date().toISOString(),
  };
}

export function verifyClientResponseFrame(input: {
  hello: MonoHandshakeHelloFrame;
  challenge: MonoHandshakeChallengeFrame;
  response: MonoHandshakeResponseFrame;
}): boolean {
  const payload = buildClientResponsePayload({
    sessionId: input.response.sessionId,
    initiatorDid: input.hello.did,
    responderDid: input.challenge.did,
    initiatorNonce: input.hello.nonce,
    responderNonce: input.challenge.nonce,
  });

  return verifyPayload(
    publicKeyPemFromDidDocument(input.hello.didDocument),
    payload,
    input.response.signature,
  );
}

export function assertHandshakeFrameType<T extends MonoHandshakeFrame['type']>(
  frame: MonoFrame,
  type: T,
): asserts frame is Extract<MonoHandshakeFrame, { type: T }> {
  if (frame.type !== type) {
    throw new Error(`Expected handshake frame ${type}, received ${frame.type}`);
  }
}
