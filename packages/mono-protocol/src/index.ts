import type { MonoHandshakeFrame } from '@mono/types';

export const MONO_HANDSHAKE_PROTOCOL = '/mono/handshake/1.0.0';
export const MONO_JSON_LINE_DELIMITER = '\n';

export function encodeFrame(frame: MonoHandshakeFrame): string {
  return `${JSON.stringify(frame)}${MONO_JSON_LINE_DELIMITER}`;
}

export function decodeFrame(line: string): MonoHandshakeFrame {
  const parsed = JSON.parse(line) as MonoHandshakeFrame;
  if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) {
    throw new Error('Invalid mono handshake frame');
  }
  return parsed;
}
