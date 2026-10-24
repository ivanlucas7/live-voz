// Roda os AudioWorklets (JS puro em public/) num sandbox que imita o thread de áudio.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

type Message = Record<string, unknown>;

function loadWorklet(file: string, sampleRate: number, options: unknown = {}) {
  const registered: Record<string, new (opts: unknown) => unknown> = {};
  class AudioWorkletProcessor {
    port = {
      sent: [] as Message[],
      onmessage: null as ((event: { data: Message }) => void) | null,
      postMessage(message: Message) {
        this.sent.push(message);
      },
    };
  }
  runInNewContext(readFileSync(`public/worklets/${file}`, 'utf8'), {
    AudioWorkletProcessor,
    sampleRate,
    registerProcessor: (name: string, ctor: new (opts: unknown) => unknown) => (registered[name] = ctor),
    Math,
    Int16Array,
  });
  const [ctor] = Object.values(registered);
  return new ctor(options) as {
    port: { sent: Message[]; onmessage: (event: { data: Message }) => void };
    process: (inputs: Float32Array[][], outputs?: Float32Array[][]) => boolean;
  };
}

describe('capture-processor', () => {
  it('converte 48 kHz em blocos de 640 amostras a 16 kHz', () => {
    const node = loadWorklet('capture-processor.js', 48_000);
    const input = new Float32Array(128).fill(0.5);
    for (let i = 0; i < 15; i++) node.process([[input]]); // 1920 amostras = 40 ms
    expect(node.port.sent).toHaveLength(1);
    const { pcm, level } = node.port.sent[0] as { pcm: Int16Array; level: number };
    expect(pcm).toHaveLength(640);
    expect(pcm[100]).toBe(Math.trunc(0.5 * 0x7fff)); // Int16Array trunca
    expect(level).toBeCloseTo(0.5, 2);
  });

  it('funciona com 44,1 kHz (taxa fracionária)', () => {
    const node = loadWorklet('capture-processor.js', 44_100);
    const input = new Float32Array(128);
    for (let i = 0; i < 1000; i++) node.process([[input]]); // ~2,9 s
    const total = node.port.sent.length * 640;
    expect(Math.abs(total - (128_000 / 44_100) * 16_000)).toBeLessThan(640);
  });
});

describe('player-processor', () => {
  const RATE = 48_000;
  const make = () => loadWorklet('player-processor.js', RATE, { processorOptions: { prebufferMs: 100 } });
  const tick = (node: ReturnType<typeof make>) => {
    const out = [[new Float32Array(128)]];
    node.process([], out);
    return out[0][0];
  };
  const push = (node: ReturnType<typeof make>, seconds: number, value = 0.3) =>
    node.port.onmessage({ data: { type: 'push', samples: new Float32Array(Math.round(seconds * RATE)).fill(value) } });

  it('espera o buffer mínimo antes de tocar', () => {
    const node = make();
    push(node, 0.05);
    expect(tick(node)[0]).toBe(0);
    push(node, 0.06);
    expect(tick(node)[0]).toBeCloseTo(0.3);
    expect(node.port.sent).toContainEqual(expect.objectContaining({ type: 'playing', playing: true }));
  });

  it('no fim da resposta toca o resto e avisa que esvaziou', () => {
    const node = make();
    push(node, 0.02);
    node.port.onmessage({ data: { type: 'end' } });
    let played = 0;
    for (let i = 0; i < 20; i++) played += tick(node).filter((v) => v !== 0).length;
    expect(played).toBe(0.02 * RATE);
    expect(node.port.sent).toContainEqual({ type: 'drained' });
    expect(node.port.sent).toContainEqual(expect.objectContaining({ type: 'playing', playing: false }));
  });

  it('avisa o fim mesmo se o áudio acabou antes do aviso', () => {
    const node = make();
    push(node, 0.2);
    for (let i = 0; i < 100; i++) tick(node);
    node.port.onmessage({ data: { type: 'end' } });
    expect(node.port.sent).toContainEqual({ type: 'drained' });
  });

  it('clear corta a fala na hora (interrupção)', () => {
    const node = make();
    push(node, 1);
    tick(node);
    node.port.onmessage({ data: { type: 'clear' } });
    expect(tick(node).every((v) => v === 0)).toBe(true);
    expect(node.port.sent.at(-1)).toEqual(expect.objectContaining({ type: 'playing', playing: false }));
  });

  it('depois de um engasgo espera encher de novo em vez de picotar', () => {
    const node = make();
    push(node, 0.11);
    for (let i = 0; i < 50; i++) tick(node); // acaba o áudio sem "end": engasgo
    push(node, 0.03);
    expect(tick(node)[0]).toBe(0); // ainda abaixo do buffer mínimo
    push(node, 0.08);
    expect(tick(node)[0]).toBeCloseTo(0.3);
  });
});
