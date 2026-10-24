// Reprodução da voz do modelo com buffer anti-engasgo.
//
// O Gemini manda o áudio mais rápido que o tempo real, em pedaços irregulares.
// Antes de começar a tocar (ou depois de um engasgo da rede), o player espera
// juntar um pouco de áudio. No fim da resposta ("end"), toca o que sobrou.
// "clear" esvazia tudo na hora: é o que faz a interrupção cortar a fala já.

class PlayerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const prebufferMs = (options.processorOptions && options.processorOptions.prebufferMs) || 120;
    this.prebuffer = Math.round((prebufferMs / 1000) * sampleRate);
    this.queue = [];
    this.offset = 0;
    this.buffered = 0;
    this.primed = false;
    this.ending = false;
    this.playing = false;
    this.underruns = 0;

    this.port.onmessage = (event) => {
      const msg = event.data;
      if (msg.type === 'push') {
        this.queue.push(msg.samples);
        this.buffered += msg.samples.length;
      } else if (msg.type === 'end') {
        if (this.buffered === 0) {
          // Já tocou tudo antes do aviso de fim chegar.
          this.primed = false;
          this.setPlaying(false);
          this.port.postMessage({ type: 'drained' });
        } else {
          this.ending = true;
        }
      } else if (msg.type === 'clear') {
        this.queue = [];
        this.offset = 0;
        this.buffered = 0;
        this.primed = false;
        this.ending = false;
        this.setPlaying(false);
      }
    };
  }

  setPlaying(playing) {
    if (this.playing === playing) return;
    this.playing = playing;
    this.port.postMessage({ type: 'playing', playing, underruns: this.underruns });
  }

  process(_inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;

    if (!this.primed && (this.buffered >= this.prebuffer || (this.ending && this.buffered > 0))) {
      this.primed = true;
    }

    let written = 0;
    if (this.primed) {
      while (written < out.length && this.queue.length > 0) {
        const head = this.queue[0];
        const take = Math.min(out.length - written, head.length - this.offset);
        out.set(head.subarray(this.offset, this.offset + take), written);
        written += take;
        this.offset += take;
        this.buffered -= take;
        if (this.offset >= head.length) {
          this.queue.shift();
          this.offset = 0;
        }
      }
    }
    for (let i = written; i < out.length; i++) out[i] = 0;
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);

    if (written > 0) {
      this.setPlaying(true);
    }
    if (this.primed && this.buffered === 0) {
      if (this.ending) {
        // Fim normal da resposta.
        this.ending = false;
        this.primed = false;
        this.setPlaying(false);
        this.port.postMessage({ type: 'drained' });
      } else if (written < out.length) {
        // Faltou áudio no meio da fala: volta a esperar o buffer encher.
        this.underruns++;
        this.primed = false;
      }
    }
    return true;
  }
}

registerProcessor('player-processor', PlayerProcessor);
