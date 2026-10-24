// Captura do microfone: reamostra para 16 kHz (média por janela, que já filtra
// agudos), converte para PCM 16-bit e envia blocos de 40 ms ao thread principal.
// Roda no thread de áudio, então a página travar não corta a captura.

const TARGET_RATE = 16000;
const CHUNK_SAMPLES = 640; // 40 ms a 16 kHz

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET_RATE;
    this.nextBoundary = this.ratio;
    this.position = 0;
    this.acc = 0;
    this.count = 0;
    this.chunk = new Int16Array(CHUNK_SAMPLES);
    this.filled = 0;
    this.energy = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      this.acc += channel[i];
      this.count++;
      this.position++;
      if (this.position >= this.nextBoundary) {
        this.nextBoundary += this.ratio;
        const value = Math.max(-1, Math.min(1, this.acc / this.count));
        this.acc = 0;
        this.count = 0;
        this.energy += value * value;
        this.chunk[this.filled++] = value < 0 ? value * 0x8000 : value * 0x7fff;
        if (this.filled === CHUNK_SAMPLES) {
          const level = Math.sqrt(this.energy / CHUNK_SAMPLES);
          this.port.postMessage({ pcm: this.chunk, level }, [this.chunk.buffer]);
          this.chunk = new Int16Array(CHUNK_SAMPLES);
          this.filled = 0;
          this.energy = 0;
        }
      }
    }
    // Evita perda de precisão em sessões longas.
    if (this.position > 1e9) {
      this.position -= 1e9;
      this.nextBoundary -= 1e9;
    }
    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
