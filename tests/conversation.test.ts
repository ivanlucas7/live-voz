import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveServerMessage } from '@google/genai';

// ── Falsos do SDK e do motor de áudio ──────────────────────────────────

interface FakeSession {
  config: Record<string, unknown>;
  callbacks: { onmessage: (m: LiveServerMessage) => void; onclose?: (e: CloseEvent) => void };
  sent: unknown[];
  toolResponses: unknown[];
  closed: boolean;
  sendRealtimeInput: (p: unknown) => void;
  sendToolResponse: (p: unknown) => void;
  close: () => void;
}
const sessions: FakeSession[] = [];

vi.mock('@google/genai', async (importOriginal) => {
  const real = await importOriginal<typeof import('@google/genai')>();
  class GoogleGenAI {
    live = {
      connect: async ({ config, callbacks }: { config: Record<string, unknown>; callbacks: FakeSession['callbacks'] }) => {
        const session: FakeSession = {
          config,
          callbacks,
          sent: [],
          toolResponses: [],
          closed: false,
          sendRealtimeInput: (p) => session.sent.push(p),
          sendToolResponse: (p) => session.toolResponses.push(p),
          close: () => (session.closed = true),
        };
        sessions.push(session);
        return session;
      },
    };
  }
  return { ...real, GoogleGenAI };
});

const audio = {
  playing: false,
  played: 0,
  cleared: 0,
  ended: 0,
  events: null as null | { onMicChunk: (pcm: Int16Array, level: number) => void; onDrained?: () => void },
};
vi.mock('../src/audio/engine', () => ({
  AudioEngine: class {
    constructor(events: typeof audio.events) {
      audio.events = events;
    }
    get playing() {
      return audio.playing;
    }
    start = async () => undefined;
    stop = async () => undefined;
    play = () => {
      audio.played++;
      audio.playing = true;
    };
    endOfTurn = () => audio.ended++;
    clearPlayback = () => {
      audio.cleared++;
      audio.playing = false;
    };
    setMuted = () => undefined;
    isMuted = false;
    outputLevel = () => 0;
  },
}));

const { Conversation } = await import('../src/live/conversation');

function setup(overrides: Partial<ConstructorParameters<typeof Conversation>[0]> = {}) {
  const callbacks = { onTranscript: vi.fn(), onTool: vi.fn(), onError: vi.fn(), onEnded: vi.fn(), onNotice: vi.fn() };
  const conversation = new Conversation({
    settings: { voice: 'Kore', name: 'Lia', extraInstructions: '', password: 'senha' },
    searchEnabled: false,
    callbacks,
    ...overrides,
  });
  return { conversation, callbacks };
}

const last = () => sessions[sessions.length - 1];
const msg = (m: Record<string, unknown>) => last().callbacks.onmessage(m as unknown as LiveServerMessage);
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  sessions.length = 0;
  Object.assign(audio, { playing: false, played: 0, cleared: 0, ended: 0 });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url === '/api/token'
        ? new Response(JSON.stringify({ token: 'auth_tokens/t', model: 'm' }))
        : new Response(JSON.stringify({ results: [] })),
    ),
  );
});

describe('Conversation', () => {
  it('conecta com voz, ferramentas, transcrição e retomada de sessão', async () => {
    const { conversation } = setup();
    await conversation.start();
    const config = last().config;
    expect(config.speechConfig).toEqual({ voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } });
    expect(config.inputAudioTranscription).toEqual({});
    expect(config.sessionResumption).toEqual({});
    expect(String(config.systemInstruction)).toContain('Você é Lia');
    expect(fetch).toHaveBeenCalledWith('/api/token', expect.objectContaining({ headers: { 'x-app-password': 'senha' } }));
    expect(conversation.state).toBe('connecting');
    await conversation.stop();
  });

  it('guarda o áudio até o setup terminar e depois envia em ordem', async () => {
    const { conversation } = setup();
    await conversation.start();
    audio.events!.onMicChunk(new Int16Array([1]), 0);
    audio.events!.onMicChunk(new Int16Array([2]), 0);
    expect(last().sent).toHaveLength(0);
    msg({ setupComplete: {} });
    expect(last().sent).toHaveLength(2);
    expect(conversation.state).toBe('listening');
    audio.events!.onMicChunk(new Int16Array([3]), 0);
    expect(last().sent).toHaveLength(3);
    await conversation.stop();
  });

  it('mostra que está ouvindo, pensando e falando', async () => {
    const { conversation, callbacks } = setup();
    await conversation.start();
    msg({ setupComplete: {} });
    audio.events!.onMicChunk(new Int16Array(640), 0.2);
    expect(conversation.state).toBe('user_speaking');
    msg({ serverContent: { inputTranscription: { text: 'Que horas são?' } } });
    vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 1000);
    expect(conversation.state).toBe('thinking');
    msg({ serverContent: { modelTurn: { parts: [{ inlineData: { data: 'AAAA', mimeType: 'audio/pcm;rate=24000' } }] } } });
    expect(conversation.state).toBe('speaking');
    msg({ serverContent: { outputTranscription: { text: 'São três horas.' } } });
    msg({ serverContent: { turnComplete: true } });
    expect(audio.ended).toBe(1);
    const roles = callbacks.onTranscript.mock.calls.map(([e]) => `${e.role}:${e.done}`);
    expect(roles).toContain('user:true');
    expect(roles).toContain('ai:true');
    vi.restoreAllMocks();
    await conversation.stop();
  });

  it('corta a fala na hora quando a pessoa interrompe', async () => {
    const { conversation, callbacks } = setup();
    await conversation.start();
    msg({ setupComplete: {} });
    msg({ serverContent: { modelTurn: { parts: [{ inlineData: { data: 'AAAA', mimeType: 'audio/pcm' } }] } } });
    msg({ serverContent: { outputTranscription: { text: 'Uma resposta comprida' } } });
    msg({ serverContent: { interrupted: true } });
    expect(audio.cleared).toBe(1);
    const lastAi = callbacks.onTranscript.mock.calls.map(([e]) => e).filter((e) => e.role === 'ai').at(-1);
    expect(lastAi).toMatchObject({ done: true, interrupted: true });
    await conversation.stop();
  });

  it('executa ferramenta e devolve a resposta com o mesmo id', async () => {
    const { conversation, callbacks } = setup();
    await conversation.start();
    msg({ setupComplete: {} });
    msg({ toolCall: { functionCalls: [{ id: 'c1', name: 'web_search', args: { query: 'x' } }] } });
    expect(conversation.state).toBe('thinking');
    await flush();
    expect(last().toolResponses).toEqual([
      { functionResponses: [{ id: 'c1', name: 'web_search', response: { error: 'A busca na internet não está configurada neste app.' } }] },
    ]);
    expect(callbacks.onTool).toHaveBeenCalledWith('web_search', 'running');
    expect(callbacks.onTool).toHaveBeenCalledWith('web_search', 'error');
    await conversation.stop();
  });

  it('não responde chamadas canceladas', async () => {
    const { conversation } = setup();
    await conversation.start();
    msg({ setupComplete: {} });
    msg({ toolCall: { functionCalls: [{ id: 'c2', name: 'web_search', args: { query: 'x' } }] } });
    msg({ toolCallCancellation: { ids: ['c2'] } });
    await flush();
    expect(last().toolResponses).toHaveLength(0);
    await conversation.stop();
  });

  it('reconecta com o handle de retomada quando a conexão cai', async () => {
    const { conversation, callbacks } = setup();
    await conversation.start();
    msg({ setupComplete: {} });
    msg({ sessionResumptionUpdate: { resumable: true, newHandle: 'h-123' } });
    const first = last();
    first.callbacks.onclose?.({ code: 1006, reason: '' } as CloseEvent);
    await vi.waitFor(() => expect(sessions).toHaveLength(2));
    expect(conversation.state).toBe('reconnecting');
    expect(last().config.sessionResumption).toEqual({ handle: 'h-123' });
    expect(fetch).toHaveBeenCalledTimes(2); // um token novo por conexão
    msg({ setupComplete: {} });
    expect(conversation.state).toBe('listening');
    expect(callbacks.onNotice).not.toHaveBeenCalled();
    // eventos atrasados da conexão antiga são ignorados
    first.callbacks.onmessage({ serverContent: { interrupted: true } } as unknown as LiveServerMessage);
    expect(audio.cleared).toBe(0);
    await conversation.stop();
  });

  it('troca de conexão no goAway só quando o modelo terminou de falar', async () => {
    const { conversation } = setup();
    await conversation.start();
    msg({ setupComplete: {} });
    audio.playing = true;
    msg({ goAway: { timeLeft: '10s' } });
    await flush();
    expect(sessions).toHaveLength(1);
    audio.playing = false;
    audio.events!.onDrained!();
    await vi.waitFor(() => expect(sessions).toHaveLength(2));
    expect(sessions[0].closed).toBe(true);
    await conversation.stop();
  });

  it('para de tentar quando o Gemini recusa a configuração', async () => {
    const { conversation, callbacks } = setup();
    await conversation.start();
    last().callbacks.onclose?.({ code: 1008, reason: 'modelo inválido' } as CloseEvent);
    await vi.waitFor(() => expect(callbacks.onEnded).toHaveBeenCalledWith('error'));
    expect(callbacks.onError.mock.calls[0][0]).toContain('modelo inválido');
    expect(sessions).toHaveLength(1);
  });

  it('encerra sozinho depois de se despedir', async () => {
    const { conversation, callbacks } = setup();
    await conversation.start();
    msg({ setupComplete: {} });
    msg({ toolCall: { functionCalls: [{ id: 'bye', name: 'end_conversation', args: {} }] } });
    await flush();
    msg({ serverContent: { modelTurn: { parts: [{ inlineData: { data: 'AAAA', mimeType: 'audio/pcm' } }] } } });
    msg({ serverContent: { turnComplete: true } });
    audio.playing = false;
    audio.events!.onDrained!();
    await vi.waitFor(() => expect(callbacks.onEnded).toHaveBeenCalledWith('goodbye'));
    expect(last().closed).toBe(true);
  });

  it('erro de senha no token vira TokenError 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Senha incorreta ou ausente.' }), { status: 401 })));
    const { conversation } = setup();
    await expect(conversation.start()).rejects.toMatchObject({ status: 401, message: 'Senha incorreta ou ausente.' });
  });
});
