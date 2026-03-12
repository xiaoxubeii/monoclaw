import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStore } from '@/stores/chat';

const invokeMock = window.electron.ipcRenderer.invoke as ReturnType<typeof vi.fn>;

function resetChatStore() {
  useChatStore.setState({
    messages: [],
    loading: false,
    error: null,
    sending: false,
    activeRunId: null,
    streamingText: '',
    streamingMessage: null,
    streamingTools: [],
    pendingFinal: false,
    lastUserMessageAt: null,
    pendingToolImages: [],
    sessions: [],
    currentSessionKey: 'agent:main:main',
    sessionLabels: {},
    sessionLastActivity: {},
    showThinking: true,
    thinkingLevel: null,
  });
}

describe('chat store pending-final recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invokeMock.mockReset();
    localStorage.clear();
    resetChatStore();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('falls back to the latest tool result when no final assistant message arrives', async () => {
    const now = new Date('2026-03-11T12:00:20.000Z');
    vi.setSystemTime(now);

    const userTs = now.getTime() - 30_000;
    invokeMock.mockImplementation(async (_channel: string, method?: string) => {
      if (method === 'chat.history') {
        return {
          success: true,
          result: {
            messages: [
              { id: 'user-1', role: 'user', timestamp: userTs, content: 'what model are you using?' },
              {
                id: 'assistant-1',
                role: 'assistant',
                timestamp: userTs + 1_000,
                content: [{ type: 'toolCall', id: 'call-1', name: 'session_status', arguments: { model: '' } }],
              },
              {
                id: 'tool-1',
                role: 'toolresult',
                toolCallId: 'call-1',
                toolName: 'session_status',
                timestamp: userTs + 2_000,
                content: [{ type: 'text', text: 'Model: ollama-ollama/qwen2.5:3b' }],
              },
            ],
          },
        };
      }
      return { success: false, error: `unexpected method: ${String(method)}` };
    });

    useChatStore.setState({
      sending: true,
      pendingFinal: true,
      lastUserMessageAt: userTs,
    });

    await useChatStore.getState().loadHistory(true);

    const state = useChatStore.getState();
    expect(state.sending).toBe(false);
    expect(state.pendingFinal).toBe(false);
    expect(state.messages.some((msg) => typeof msg.content === 'string' && msg.content.includes('Model: ollama-ollama/qwen2.5:3b'))).toBe(true);
  });

  it('re-arms history polling after a tool result final event', async () => {
    const now = new Date('2026-03-11T12:00:20.000Z');
    vi.setSystemTime(now);

    invokeMock.mockImplementation(async (_channel: string, method?: string) => {
      if (method === 'chat.history') {
        return { success: true, result: { messages: [] } };
      }
      return { success: false, error: `unexpected method: ${String(method)}` };
    });

    useChatStore.setState({
      sending: true,
      pendingFinal: false,
      lastUserMessageAt: now.getTime() - 5_000,
    });

    useChatStore.getState().handleChatEvent({
      state: 'final',
      runId: 'run-1',
      sessionKey: 'agent:main:main',
      message: {
        role: 'toolresult',
        toolCallId: 'call-1',
        toolName: 'session_status',
        timestamp: now.getTime(),
        content: [{ type: 'text', text: 'Model: ollama-ollama/qwen2.5:3b' }],
      },
    });

    expect(useChatStore.getState().pendingFinal).toBe(true);

    await vi.advanceTimersByTimeAsync(3_100);

    expect(invokeMock).toHaveBeenCalledWith(
      'gateway:rpc',
      'chat.history',
      { sessionKey: 'agent:main:main', limit: 200 },
    );
  });

  it('surfaces orphaned tool results when reopening a historical session', async () => {
    const now = new Date('2026-03-11T12:00:20.000Z');
    vi.setSystemTime(now);

    const userTs = now.getTime() - 30_000;
    invokeMock.mockImplementation(async (_channel: string, method?: string) => {
      if (method === 'chat.history') {
        return {
          success: true,
          result: {
            messages: [
              { id: 'user-1', role: 'user', timestamp: userTs, content: 'show session status' },
              {
                id: 'assistant-1',
                role: 'assistant',
                timestamp: userTs + 1_000,
                content: [{ type: 'toolCall', id: 'call-1', name: 'session_status', arguments: { model: '' } }],
              },
              {
                id: 'tool-1',
                role: 'toolresult',
                toolCallId: 'call-1',
                toolName: 'session_status',
                timestamp: userTs + 2_000,
                content: [{ type: 'text', text: 'Model: ollama-ollama/qwen2.5:3b' }],
              },
            ],
          },
        };
      }
      return { success: false, error: `unexpected method: ${String(method)}` };
    });

    await useChatStore.getState().loadHistory(true);

    const state = useChatStore.getState();
    expect(state.sending).toBe(false);
    expect(state.messages.some((msg) => typeof msg.content === 'string' && msg.content.includes('Model: ollama-ollama/qwen2.5:3b'))).toBe(true);
  });
});

describe('chat store guarded tool policy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invokeMock.mockReset();
    localStorage.clear();
    resetChatStore();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('blocks unexpected session_status calls for non-diagnostic prompts', () => {
    const now = new Date('2026-03-12T00:11:00.000Z');
    vi.setSystemTime(now);
    invokeMock.mockResolvedValue({ success: true });

    useChatStore.setState({
      messages: [
        { id: 'user-1', role: 'user', timestamp: now.getTime() / 1000, content: '帮我总结今天的工作重点' },
      ],
      sending: true,
      activeRunId: 'run-guard-session-status',
    });

    useChatStore.getState().handleChatEvent({
      state: 'delta',
      runId: 'run-guard-session-status',
      sessionKey: 'agent:main:main',
      message: {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'call-1', name: 'session_status', arguments: {} }],
      },
    });

    const state = useChatStore.getState();
    expect(state.sending).toBe(false);
    expect(state.activeRunId).toBeNull();
    expect(state.pendingFinal).toBe(false);
    expect(state.messages[state.messages.length - 1]?.role).toBe('assistant');
    expect(String(state.messages[state.messages.length - 1]?.content)).toContain('session_status');
    expect(invokeMock).toHaveBeenCalledWith(
      'gateway:rpc',
      'chat.abort',
      { sessionKey: 'agent:main:main' },
    );
  });

  it('allows session_status when user explicitly asks for diagnostics', () => {
    const now = new Date('2026-03-12T00:12:00.000Z');
    vi.setSystemTime(now);

    useChatStore.setState({
      messages: [
        { id: 'user-1', role: 'user', timestamp: now.getTime() / 1000, content: '现在用的是什么模型？给我 session status' },
      ],
      sending: true,
      activeRunId: 'run-allow-session-status',
    });

    useChatStore.getState().handleChatEvent({
      state: 'delta',
      runId: 'run-allow-session-status',
      sessionKey: 'agent:main:main',
      message: {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'call-1', name: 'session_status', arguments: {} }],
      },
    });

    const state = useChatStore.getState();
    expect(state.sending).toBe(true);
    expect(state.streamingTools.some((tool) => tool.name === 'session_status' && tool.status === 'running')).toBe(true);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
