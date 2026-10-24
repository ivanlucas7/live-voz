import { describe, expect, it } from 'vitest';
import { base64ToFloat32, floatToInt16, int16ToBase64, resampleLinear, rms, sampleRateFromMime } from '../src/audio/pcm';

describe('pcm', () => {
  it('ida e volta Int16 → base64 → Float32 preserva o sinal', () => {
    const original = new Int16Array([0, 1000, -1000, 32767, -32768]);
    const back = base64ToFloat32(int16ToBase64(original));
    expect(Array.from(back, (v) => Math.round(v * 0x8000))).toEqual([0, 1000, -1000, 32767, -32768]);
  });

  it('codifica blocos grandes sem estourar a pilha', () => {
    const big = new Int16Array(200_000).fill(123);
    expect(base64ToFloat32(int16ToBase64(big))).toHaveLength(200_000);
  });

  it('floatToInt16 limita valores fora de [-1, 1]', () => {
    expect(Array.from(floatToInt16(new Float32Array([2, -2, 0])))).toEqual([32767, -32768, 0]);
  });

  it('reamostra 24 kHz para 48 kHz dobrando o tamanho', () => {
    const out = resampleLinear(new Float32Array([0, 1, 0, -1]), 24_000, 48_000);
    expect(out).toHaveLength(8);
    expect(out[1]).toBeCloseTo(0.5);
  });

  it('não mexe quando as taxas são iguais', () => {
    const data = new Float32Array([1, 2]);
    expect(resampleLinear(data, 24_000, 24_000)).toBe(data);
  });

  it('calcula RMS', () => {
    expect(rms(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5);
    expect(rms(new Float32Array())).toBe(0);
  });

  it('lê a taxa do mimeType', () => {
    expect(sampleRateFromMime('audio/pcm;rate=24000')).toBe(24_000);
    expect(sampleRateFromMime('audio/pcm')).toBe(24_000);
  });
});
