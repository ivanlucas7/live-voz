// Conversões de áudio entre o WebAudio (Float32) e o formato do Gemini Live (PCM 16-bit, base64).

export const INPUT_SAMPLE_RATE = 16_000;
export const OUTPUT_SAMPLE_RATE = 24_000;

export function int16ToBase64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

export function base64ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const length = binary.length >> 1;
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const lo = binary.charCodeAt(i * 2);
    const hi = binary.charCodeAt(i * 2 + 1);
    let value = (hi << 8) | lo;
    if (value >= 0x8000) value -= 0x10000;
    out[i] = value / 0x8000;
  }
  return out;
}

export function floatToInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/** Volume RMS de um bloco, de 0 a 1. */
export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/** Lê a taxa de amostragem de um mimeType como "audio/pcm;rate=24000". */
export function sampleRateFromMime(mimeType: string | undefined, fallback = OUTPUT_SAMPLE_RATE): number {
  const match = mimeType?.match(/rate=(\d+)/);
  return match ? Number(match[1]) : fallback;
}

/** Reamostragem linear simples, usada só quando o navegador não aceita o AudioContext a 24 kHz. */
export function resampleLinear(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || samples.length === 0) return samples;
  const ratio = fromRate / toRate;
  const length = Math.max(1, Math.round(samples.length / ratio));
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const pos = i * ratio;
    const left = Math.floor(pos);
    const right = Math.min(left + 1, samples.length - 1);
    const frac = pos - left;
    out[i] = samples[left] * (1 - frac) + samples[right] * frac;
  }
  return out;
}
