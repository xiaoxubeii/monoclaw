import { describe, expect, it } from 'vitest';
import { extractTextForDisplay } from '@/pages/Chat/message-utils';

describe('chat message utils', () => {
  it('hides leaked internal assistant trace in normal user mode', () => {
    const message = {
      role: 'assistant',
      content: `Thinking
The user is asking me to introduce myself.

read
{
  "path": "/Users/test/IDENTITY.md"
}`,
    };

    expect(extractTextForDisplay(message, { hideInternalAssistantTrace: true })).toBe('');
  });

  it('keeps assistant trace text when debug mode is enabled', () => {
    const message = {
      role: 'assistant',
      content: `Thinking
The user is asking me to introduce myself.

read
{
  "path": "/Users/test/IDENTITY.md"
}`,
    };

    expect(extractTextForDisplay(message, { hideInternalAssistantTrace: false }))
      .toContain('Thinking');
  });

  it('does not hide normal assistant replies', () => {
    const message = {
      role: 'assistant',
      content: '你好，我是 Monoclaw 助手。',
    };

    expect(extractTextForDisplay(message, { hideInternalAssistantTrace: true }))
      .toBe('你好，我是 Monoclaw 助手。');
  });
});

