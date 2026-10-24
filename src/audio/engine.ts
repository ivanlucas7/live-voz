// Motor de áudio: microfone → blocos PCM 16 kHz, e voz do modelo → alto-falante.
//
// Usa um único AudioContext na taxa nativa do aparelho (o iOS e o Firefox se
// comportam melhor assim) e AudioWorklets, que rodam fora do thread da página.

import { OUTPUT_SAMPLE_RATE, resampleLinear, rms } from './pcm';

export interface AudioEngineEvents {
  onMicChunk: (pcm: Int16Array, level: number) => void;
  onPlayingChange?: (playing: boolean) => void;
  onDrained?: () => void;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private capture: AudioWorkletNode | null = null;
  private player: AudioWorkletNode | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserData: Float32Array<ArrayBuffer> = new Float32Array(1024);
  private muted = false;
  playing = false;
  micLevel = 0;

  constructor(private readonly events: AudioEngineEvents) {}

  /** Precisa ser chamado dentro de um clique/toque (regra de autoplay dos navegadores). */
  async start(): Promise<void> {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    // Pede o microfone e carrega os worklets em paralelo.
    const [stream] = await Promise.all([
      navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      }),
      ctx.audioWorklet.addModule('/worklets/capture-processor.js'),
      ctx.audioWorklet.addModule('/worklets/player-processor.js'),
    ]);
    this.stream = stream;
    if (ctx.state === 'suspended') await ctx.resume();

    const source = ctx.createMediaStreamSource(stream);
    const capture = new AudioWorkletNode(ctx, 'capture-processor');
    capture.port.onmessage = (event: MessageEvent<{ pcm: Int16Array; level: number }>) => {
      this.micLevel = event.data.level;
      if (!this.muted) this.events.onMicChunk(event.data.pcm, event.data.level);
    };
    // O worklet só roda se estiver ligado ao destino; o ganho zero evita ouvir o próprio microfone.
    const sink = ctx.createGain();
    sink.gain.value = 0;
    source.connect(capture).connect(sink).connect(ctx.destination);
    this.capture = capture;

    const player = new AudioWorkletNode(ctx, 'player-processor', {
      outputChannelCount: [1],
      processorOptions: { prebufferMs: 120 },
    });
    player.port.onmessage = (event: MessageEvent<{ type: string; playing?: boolean }>) => {
      if (event.data.type === 'playing') {
        this.playing = Boolean(event.data.playing);
        this.events.onPlayingChange?.(this.playing);
      } else if (event.data.type === 'drained') {
        this.events.onDrained?.();
      }
    };
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0;
    player.connect(analyser).connect(ctx.destination);
    this.player = player;
    this.analyser = analyser;
  }

  /** Enfileira um pedaço da voz do modelo (Float32 na taxa informada). */
  play(samples: Float32Array, sampleRate = OUTPUT_SAMPLE_RATE): void {
    if (!this.player || !this.ctx) return;
    const data = resampleLinear(samples, sampleRate, this.ctx.sampleRate);
    this.player.port.postMessage({ type: 'push', samples: data }, [data.buffer]);
  }

  /** Avisa que a resposta terminou: toca o que sobrou no buffer. */
  endOfTurn(): void {
    this.player?.port.postMessage({ type: 'end' });
  }

  /** Para a fala imediatamente (interrupção). */
  clearPlayback(): void {
    this.player?.port.postMessage({ type: 'clear' });
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.stream?.getAudioTracks().forEach((track) => (track.enabled = !muted));
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Volume do que está saindo no alto-falante agora, de 0 a 1 (move a boca). */
  outputLevel(): number {
    if (!this.analyser || !this.playing) return 0;
    this.analyser.getFloatTimeDomainData(this.analyserData);
    return rms(this.analyserData);
  }

  async resume(): Promise<void> {
    if (this.ctx?.state === 'suspended') await this.ctx.resume();
  }

  async stop(): Promise<void> {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.capture?.disconnect();
    this.player?.disconnect();
    this.stream = null;
    this.capture = null;
    this.player = null;
    this.analyser = null;
    this.playing = false;
    this.micLevel = 0;
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx && ctx.state !== 'closed') await ctx.close();
  }
}
