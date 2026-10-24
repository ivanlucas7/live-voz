// Conversa ao vivo com o Gemini: liga o motor de áudio à sessão Live, executa
// as ferramentas, troca de conexão antes do limite de ~10 min sem perder o
// contexto (session resumption) e se recupera de quedas de rede.

import {
  GoogleGenAI,
  Modality,
  type LiveConnectConfig,
  type LiveServerMessage,
  type Session,
} from '@google/genai';
import { AudioEngine } from '../audio/engine';
import { base64ToFloat32, int16ToBase64, sampleRateFromMime } from '../audio/pcm';
import { buildSystemPrompt, type Settings } from '../settings';
import { runTool, TOOL_DECLARATIONS } from '../tools';

export type ConversationState =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'user_speaking'
  | 'thinking'
  | 'speaking'
  | 'reconnecting'
  | 'error';

export interface TranscriptUpdate {
  id: number;
  role: 'user' | 'ai';
  text: string;
  done: boolean;
  interrupted?: boolean;
}

export interface ConversationCallbacks {
  onTranscript?: (entry: TranscriptUpdate) => void;
  onTool?: (name: string, status: 'running' | 'done' | 'error') => void;
  onError?: (message: string) => void;
  onEnded?: (reason: 'user' | 'goodbye' | 'error' | 'timeout') => void;
  onNotice?: (message: string) => void;
}

export interface ConversationOptions {
  settings: Settings;
  searchEnabled: boolean;
  callbacks: ConversationCallbacks;
}

/** Reconecta antes do limite de ~10 min por conexão do Gemini Live. */
const PROACTIVE_RECONNECT_MS = 9 * 60_000;
/** Encerra sozinho depois de 30 min, para não gastar cota esquecido aberto. */
const MAX_CONVERSATION_MS = 30 * 60_000;
/** Áudio do microfone guardado enquanto a conexão está sendo trocada (~4 s). */
const MAX_PENDING_CHUNKS = 100;
const VOICE_LEVEL = 0.02;
const RETRY_DELAYS_MS = [500, 1500, 4000];

export class TokenError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function fetchToken(password: string): Promise<{ token: string; model: string }> {
  const response = await fetch('/api/token', {
    method: 'POST',
    headers: { 'x-app-password': password },
  });
  const body = (await response.json().catch(() => ({}))) as { token?: string; model?: string; error?: string };
  if (!response.ok || !body.token || !body.model) {
    throw new TokenError(body.error ?? `Falha ao obter o token (HTTP ${response.status}).`, response.status);
  }
  return { token: body.token, model: body.model };
}

export class Conversation {
  readonly audio: AudioEngine;
  private session: Session | null = null;
  private generation = 0;
  private resumeHandle: string | null = null;
  private ready = false;
  private pending: string[] = [];
  private stopped = false;
  private phase: 'connecting' | 'active' | 'reconnecting' | 'error' | 'stopped' = 'connecting';
  private toolsRunning = 0;
  private cancelledCalls = new Set<string>();
  private awaitingSince = 0;
  private lastVoiceAt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private maxTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectRequested = false;
  private endAfterReply = false;
  private nextEntryId = 1;
  private userEntry: TranscriptUpdate | null = null;
  private aiEntry: TranscriptUpdate | null = null;

  /** Já ouviu a pessoa e ainda não chegou áudio da resposta. */
  private get awaitingReply(): boolean {
    return this.awaitingSince > 0 && performance.now() - this.awaitingSince < 10_000;
  }

  private set awaitingReply(value: boolean) {
    if (!value) this.awaitingSince = 0;
    else if (this.awaitingSince === 0) this.awaitingSince = performance.now();
  }

  constructor(private readonly options: ConversationOptions) {
    this.audio = new AudioEngine({
      onMicChunk: (pcm, level) => this.onMicChunk(pcm, level),
      onDrained: () => this.onPlaybackDrained(),
    });
  }

  /** Chame dentro do clique do botão: o navegador só libera áudio com gesto do usuário. */
  async start(): Promise<void> {
    try {
      await this.audio.start();
      await this.connect();
    } catch (error) {
      this.stopped = true;
      this.phase = 'stopped';
      this.generation++;
      await this.audio.stop();
      throw error;
    }
    this.maxTimer = setTimeout(() => this.finish('timeout'), MAX_CONVERSATION_MS);
  }

  async stop(): Promise<void> {
    await this.finish('user');
  }

  sendText(text: string): void {
    const trimmed = text.trim();
    if (!trimmed || !this.session || !this.ready) return;
    this.finishUserEntry();
    this.emitUser(trimmed);
    this.finishUserEntry();
    this.awaitingReply = true;
    this.session.sendRealtimeInput({ text: trimmed });
  }

  setMuted(muted: boolean): void {
    this.audio.setMuted(muted);
    if (muted && this.session && this.ready) this.session.sendRealtimeInput({ audioStreamEnd: true });
  }

  /** Estado atual para o rosto e a interface (chamado a cada quadro). */
  get state(): ConversationState {
    if (this.phase === 'stopped') return 'idle';
    if (this.phase === 'error') return 'error';
    if (this.phase === 'connecting') return 'connecting';
    if (this.audio.playing) return 'speaking';
    if (this.phase === 'reconnecting') return 'reconnecting';
    if (this.toolsRunning > 0) return 'thinking';
    if (performance.now() - this.lastVoiceAt < 350) return 'user_speaking';
    if (this.awaitingReply) return 'thinking';
    return 'listening';
  }

  // ── Conexão ──────────────────────────────────────────────────────────

  private async connect(): Promise<void> {
    const generation = ++this.generation;
    this.ready = false;
    const { token, model } = await fetchToken(this.options.settings.password);
    if (generation !== this.generation || this.stopped) return;

    const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: 'v1alpha' } });
    const config: LiveConnectConfig = {
      responseModalities: [Modality.AUDIO],
      systemInstruction: buildSystemPrompt(this.options.settings),
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.options.settings.voice } } },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      contextWindowCompression: { slidingWindow: {} },
      sessionResumption: this.resumeHandle ? { handle: this.resumeHandle } : {},
      tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
    };

    const session = await ai.live.connect({
      model,
      config,
      callbacks: {
        onmessage: (message) => {
          if (generation === this.generation) this.onMessage(message);
        },
        onerror: (event) => {
          if (generation === this.generation) console.warn('Erro no WebSocket do Gemini', event);
        },
        onclose: (event) => {
          if (generation === this.generation) this.onUnexpectedClose(event);
        },
      },
    });
    if (generation !== this.generation || this.stopped) {
      session.close();
      return;
    }
    this.session = session;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.requestReconnect(), PROACTIVE_RECONNECT_MS);
  }

  private onUnexpectedClose(event: CloseEvent): void {
    if (this.stopped) return;
    console.warn('Conexão com o Gemini fechou', event.code, event.reason);
    if (event.code === 1008 || event.code === 1007) {
      // Erro de configuração (modelo, voz, token): tentar de novo não resolve.
      this.fail(`O Gemini recusou a conexão: ${event.reason || `código ${event.code}`}`);
      return;
    }
    void this.reconnect();
  }

  /** Troca de conexão no próximo momento calmo (sem fala do modelo nem ferramenta rodando). */
  private requestReconnect(): void {
    this.reconnectRequested = true;
    this.maybeReconnectNow();
  }

  private maybeReconnectNow(): void {
    if (!this.reconnectRequested || this.audio.playing || this.toolsRunning > 0 || this.awaitingReply) return;
    this.reconnectRequested = false;
    void this.reconnect();
  }

  private async reconnect(): Promise<void> {
    if (this.stopped || this.phase === 'reconnecting') return;
    this.phase = 'reconnecting';
    this.ready = false;
    const old = this.session;
    this.session = null;
    this.generation++; // ignora eventos atrasados da conexão antiga
    try {
      old?.close();
    } catch {
      // já estava fechada
    }

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length && !this.stopped; attempt++) {
      try {
        await this.connect();
        return; // phase vira "active" no setupComplete
      } catch (error) {
        if (error instanceof TokenError && error.status === 401) {
          this.fail('Senha incorreta. Abra as configurações e confira a senha do app.');
          return;
        }
        console.warn(`Reconexão falhou (tentativa ${attempt + 1})`, error);
        if (attempt === RETRY_DELAYS_MS.length) break;
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
    if (!this.stopped) this.fail('Perdi a conexão com o Gemini. Toque no botão para tentar de novo.');
  }

  private fail(message: string): void {
    this.phase = 'error';
    this.options.callbacks.onError?.(message);
    void this.finish('error');
  }

  private async finish(reason: 'user' | 'goodbye' | 'error' | 'timeout'): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (reason !== 'error') this.phase = 'stopped';
    this.generation++;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.maxTimer);
    try {
      this.session?.close();
    } catch {
      // ignorado
    }
    this.session = null;
    this.finishUserEntry();
    this.finishAiEntry();
    await this.audio.stop();
    this.options.callbacks.onEnded?.(reason);
  }

  // ── Áudio do microfone ───────────────────────────────────────────────

  private onMicChunk(pcm: Int16Array, level: number): void {
    if (level > VOICE_LEVEL && !this.audio.playing) this.lastVoiceAt = performance.now();
    const data = int16ToBase64(pcm);
    if (!this.session || !this.ready) {
      this.pending.push(data);
      if (this.pending.length > MAX_PENDING_CHUNKS) this.pending.shift();
      return;
    }
    this.sendAudio(data);
  }

  private sendAudio(data: string): void {
    this.session?.sendRealtimeInput({ audio: { data, mimeType: 'audio/pcm;rate=16000' } });
  }

  // ── Mensagens do servidor ────────────────────────────────────────────

  private onMessage(message: LiveServerMessage): void {
    if (message.setupComplete) {
      const resumed = this.phase === 'reconnecting';
      this.phase = 'active';
      this.ready = true;
      const queued = this.pending;
      this.pending = [];
      queued.forEach((chunk) => this.sendAudio(chunk));
      if (resumed && !this.resumeHandle) this.options.callbacks.onNotice?.('Reconectei, mas a conversa recomeçou do zero.');
    }

    const update = message.sessionResumptionUpdate;
    if (update?.resumable && update.newHandle) this.resumeHandle = update.newHandle;

    if (message.goAway) this.requestReconnect();

    const content = message.serverContent;
    if (content) {
      if (content.interrupted) {
        // A pessoa começou a falar por cima: corta a voz na hora.
        this.audio.clearPlayback();
        if (this.aiEntry) this.aiEntry.interrupted = true;
        this.finishAiEntry();
        this.awaitingReply = false;
      }

      const userText = content.inputTranscription?.text;
      if (userText) {
        this.emitUser(userText);
        this.awaitingReply = true;
      }

      for (const part of content.modelTurn?.parts ?? []) {
        const inline = part.inlineData;
        if (inline?.data && inline.mimeType?.startsWith('audio/')) {
          this.audio.play(base64ToFloat32(inline.data), sampleRateFromMime(inline.mimeType));
          this.awaitingReply = false;
        }
      }

      const aiText = content.outputTranscription?.text;
      if (aiText) {
        this.finishUserEntry();
        this.emitAi(aiText);
      }

      if (content.turnComplete) {
        this.audio.endOfTurn();
        this.finishUserEntry();
        this.finishAiEntry();
        this.awaitingReply = false;
        this.maybeReconnectNow();
        if (this.endAfterReply && !this.audio.playing) this.onPlaybackDrained();
      }
    }

    if (message.toolCallCancellation?.ids) {
      message.toolCallCancellation.ids.forEach((id) => this.cancelledCalls.add(id));
    }

    const calls = message.toolCall?.functionCalls;
    if (calls?.length) void this.runTools(calls);
  }

  private async runTools(calls: NonNullable<NonNullable<LiveServerMessage['toolCall']>['functionCalls']>) {
    const session = this.session;
    this.toolsRunning += calls.length;
    this.awaitingReply = true;
    this.finishUserEntry();
    const responses = await Promise.all(
      calls.map(async (call) => {
        const name = call.name ?? '';
        this.options.callbacks.onTool?.(name, 'running');
        const response = await runTool(call, {
          searchEnabled: this.options.searchEnabled,
          password: this.options.settings.password,
          onEndConversation: () => (this.endAfterReply = true),
        });
        this.options.callbacks.onTool?.(name, response.response && 'error' in response.response ? 'error' : 'done');
        this.toolsRunning--;
        return response;
      }),
    );
    this.awaitingSince = performance.now(); // agora espera a resposta falada
    const pending = responses.filter((r) => !r.id || !this.cancelledCalls.has(r.id));
    if (pending.length && session && session === this.session) {
      session.sendToolResponse({ functionResponses: pending });
    }
    if (this.endAfterReply) {
      // Se a despedida não vier em áudio, encerra mesmo assim.
      setTimeout(() => {
        if (!this.audio.playing) void this.finish('goodbye');
      }, 6000);
    }
    this.maybeReconnectNow();
  }

  private onPlaybackDrained(): void {
    if (this.endAfterReply) {
      setTimeout(() => void this.finish('goodbye'), 300);
      return;
    }
    this.maybeReconnectNow();
  }

  // ── Transcrição ──────────────────────────────────────────────────────

  private emitUser(text: string): void {
    if (!this.userEntry) this.userEntry = { id: this.nextEntryId++, role: 'user', text: '', done: false };
    this.userEntry.text += text;
    this.options.callbacks.onTranscript?.({ ...this.userEntry });
  }

  private emitAi(text: string): void {
    if (!this.aiEntry) this.aiEntry = { id: this.nextEntryId++, role: 'ai', text: '', done: false };
    this.aiEntry.text += text;
    this.options.callbacks.onTranscript?.({ ...this.aiEntry });
  }

  private finishUserEntry(): void {
    if (!this.userEntry) return;
    this.userEntry.done = true;
    this.options.callbacks.onTranscript?.({ ...this.userEntry });
    this.userEntry = null;
  }

  private finishAiEntry(): void {
    if (!this.aiEntry) return;
    this.aiEntry.done = true;
    this.options.callbacks.onTranscript?.({ ...this.aiEntry });
    this.aiEntry = null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
