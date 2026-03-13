import type { MonoFrame } from '@mono/types';

export const MONO_HANDSHAKE_PROTOCOL = '/mono/handshake/1.0.0';
export const MONO_JSON_LINE_DELIMITER = '\n';

export function encodeFrame(frame: MonoFrame): string {
  return `${JSON.stringify(frame)}${MONO_JSON_LINE_DELIMITER}`;
}

export function decodeFrame(line: string): MonoFrame {
  const parsed = JSON.parse(line) as MonoFrame;
  if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) {
    throw new Error('Invalid mono transport frame');
  }
  return parsed;
}
