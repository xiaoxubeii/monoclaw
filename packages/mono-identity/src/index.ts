import crypto from 'node:crypto';
import type {
  MonoDidDocument,
  MonoLocalIdentityRecord,
  MonoPublicIdentity,
  MonoVerificationMethod,
} from '@mono/types';

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const ED25519_MULTICODEC_PREFIX = Buffer.from([0xed, 0x01]);
const DID_PEER_PREFIX = 'did:peer:2';
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_MAP = new Map([...BASE58_ALPHABET].map((char, index) => [char, index]));

function base58Encode(input: Buffer): string {
  if (input.length === 0) return '';

  const digits = [0];
  for (const byte of input) {
    let carry = byte;
    for (let index = 0; index < digits.length; index += 1) {
      const value = digits[index] * 256 + carry;
      digits[index] = value % 58;
      carry = Math.floor(value / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  let output = '';
  for (const byte of input) {
    if (byte !== 0) break;
    output += BASE58_ALPHABET[0];
  }

  for (let index = digits.length - 1; index >= 0; index -= 1) {
    output += BASE58_ALPHABET[digits[index]];
  }

  return output;
}

function base58Decode(value: string): Buffer {
  if (!value) return Buffer.alloc(0);

  const bytes = [0];
  for (const char of value) {
    const digit = BASE58_MAP.get(char);
    if (digit === undefined) {
      throw new Error(`Invalid base58 character: ${char}`);
    }

    let carry = digit;
    for (let index = 0; index < bytes.length; index += 1) {
      const next = bytes[index] * 58 + carry;
      bytes[index] = next & 0xff;
      carry = next >> 8;
    }

    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  let leadingZeros = 0;
  for (const char of value) {
    if (char !== BASE58_ALPHABET[0]) break;
    leadingZeros += 1;
  }

  return Buffer.concat([
    Buffer.alloc(leadingZeros),
    Buffer.from(bytes.reverse()),
  ]);
}

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(value: string): Buffer {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, 'base64');
}

function deriveEd25519PublicKeyRaw(publicKeyPem: string): Buffer {
  const spki = crypto.createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' }) as Buffer;
  if (
    spki.length === ED25519_SPKI_PREFIX.length + 32
    && spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }
  throw new Error('Unsupported Ed25519 public key encoding');
}

function publicKeyPemFromRawEd25519(rawPublicKey: Buffer): string {
  const der = Buffer.concat([ED25519_SPKI_PREFIX, rawPublicKey]);
  return crypto.createPublicKey({ key: der, format: 'der', type: 'spki' })
    .export({ format: 'pem', type: 'spki' })
    .toString();
}

export function createMultikeyFromPublicKeyPem(publicKeyPem: string): string {
  const rawPublicKey = deriveEd25519PublicKeyRaw(publicKeyPem);
  return `z${base58Encode(Buffer.concat([ED25519_MULTICODEC_PREFIX, rawPublicKey]))}`;
}

export function publicKeyPemFromMultikey(multikey: string): string {
  if (!multikey.startsWith('z')) {
    throw new Error('Unsupported multibase prefix for multikey');
  }

  const decoded = base58Decode(multikey.slice(1));
  if (decoded.length !== ED25519_MULTICODEC_PREFIX.length + 32) {
    throw new Error('Unsupported multikey length');
  }
  if (!decoded.subarray(0, ED25519_MULTICODEC_PREFIX.length).equals(ED25519_MULTICODEC_PREFIX)) {
    throw new Error('Unsupported multicodec for multikey');
  }

  return publicKeyPemFromRawEd25519(decoded.subarray(ED25519_MULTICODEC_PREFIX.length));
}

function normalizeMethodId(did: string, fragment: string): string {
  return `${did}#${fragment}`;
}

function normalizeServiceId(did: string, value: string, index: number): string {
  if (!value) return `${did}#service-${index + 1}`;
  if (value.startsWith('#')) return `${did}${value}`;
  if (value.startsWith(did)) return value;
  return `${did}#${value}`;
}

function buildVerificationMethod(did: string, multikey: string, index: number): MonoVerificationMethod {
  return {
    id: normalizeMethodId(did, `key-${index + 1}`),
    type: 'Multikey',
    controller: did,
    publicKeyMultibase: multikey,
  };
}

export function resolveDidPeer2(did: string): MonoDidDocument {
  if (!did.startsWith(`${DID_PEER_PREFIX}.`)) {
    throw new Error('Unsupported DID. Expected did:peer:2');
  }

  const segments = did.slice(`${DID_PEER_PREFIX}.`.length).split('.').filter(Boolean);
  const verificationMethod: MonoVerificationMethod[] = [];
  const authentication: string[] = [];
  const service: MonoDidDocument['service'] = [];

  for (const segment of segments) {
    const purpose = segment[0];
    const value = segment.slice(1);

    if (purpose === 'V') {
      const method = buildVerificationMethod(did, value, verificationMethod.length);
      verificationMethod.push(method);
      authentication.push(method.id);
      continue;
    }

    if (purpose === 'S') {
      const decoded = JSON.parse(base64UrlDecode(value).toString('utf8')) as {
        id?: string;
        type?: string;
        serviceEndpoint?: string | Record<string, unknown>;
      } | Array<{
        id?: string;
        type?: string;
        serviceEndpoint?: string | Record<string, unknown>;
      }>;
      const services = Array.isArray(decoded) ? decoded : [decoded];
      for (const entry of services) {
        if (!entry?.type || entry.serviceEndpoint === undefined) {
          throw new Error('Invalid did:peer service segment');
        }
        service.push({
          id: normalizeServiceId(did, entry.id ?? '', service.length),
          type: entry.type,
          serviceEndpoint: entry.serviceEndpoint as string | Record<string, unknown>,
        });
      }
    }
  }

  if (verificationMethod.length === 0 || authentication.length === 0) {
    throw new Error('did:peer:2 document must include at least one authentication key');
  }

  return {
    id: did,
    verificationMethod,
    authentication,
    service: service.length > 0 ? service : undefined,
  };
}

export async function createDidPeerIdentity(): Promise<MonoLocalIdentityRecord> {
  const { publicKey, privateKey } = await new Promise<crypto.KeyPairKeyObjectResult>((resolve, reject) => {
    crypto.generateKeyPair('ed25519', (error, generatedPublicKey, generatedPrivateKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ publicKey: generatedPublicKey, privateKey: generatedPrivateKey });
    });
  });

  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicKeyMultibase = createMultikeyFromPublicKeyPem(publicKeyPem);
  const did = `${DID_PEER_PREFIX}.V${publicKeyMultibase}`;
  const document = resolveDidPeer2(did);
  const now = new Date().toISOString();

  return {
    did,
    document,
    authKeyId: document.authentication[0],
    publicKeyMultibase,
    privateKeyPem,
    publicKeyPem,
    createdAt: now,
    updatedAt: now,
  };
}

export function signPayload(privateKeyPem: string, payload: string): string {
  const key = crypto.createPrivateKey(privateKeyPem);
  return base64UrlEncode(crypto.sign(null, Buffer.from(payload, 'utf8'), key));
}

export function verifyPayload(publicKeyPem: string, payload: string, signature: string): boolean {
  const key = crypto.createPublicKey(publicKeyPem);
  return crypto.verify(null, Buffer.from(payload, 'utf8'), key, base64UrlDecode(signature));
}

export function createNonce(bytes = 16): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function publicIdentityFromRecord(record: MonoLocalIdentityRecord): MonoPublicIdentity {
  return {
    did: record.did,
    document: record.document,
    authKeyId: record.authKeyId,
    publicKeyMultibase: record.publicKeyMultibase,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function getAuthenticationMethod(document: MonoDidDocument): MonoVerificationMethod {
  const methodId = document.authentication[0];
  const method = document.verificationMethod.find((candidate) => candidate.id === methodId);
  if (!method) {
    throw new Error(`Authentication method not found for DID ${document.id}`);
  }
  return method;
}

export function publicKeyPemFromDidDocument(document: MonoDidDocument): string {
  return publicKeyPemFromMultikey(getAuthenticationMethod(document).publicKeyMultibase);
}
