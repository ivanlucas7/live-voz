// Modo demonstração (?demo na URL): anima o rosto passando por todos os estados,
// com uma "fala" sintética, sem microfone nem chave do Gemini. Bom para ver o
// visual no celular antes de configurar a Vercel.

import type { ConversationState } from './live/conversation';

const SCRIPT: { state: ConversationState; seconds: number }[] = [
  { state: 'listening', seconds: 2.5 },
  { state: 'user_speaking', seconds: 2 },
  { state: 'thinking', seconds: 1.8 },
  { state: 'speaking', seconds: 5 },
  { state: 'listening', seconds: 2 },
  { state: 'speaking', seconds: 3.5 },
];
const TOTAL = SCRIPT.reduce((sum, step) => sum + step.seconds, 0);

export class DemoDriver {
  sample(time: number): { state: ConversationState; level: number } {
    let t = time % TOTAL;
    for (const step of SCRIPT) {
      if (t < step.seconds) {
        return { state: step.state, level: step.state === 'speaking' ? syntheticSpeech(time) : 0 };
      }
      t -= step.seconds;
    }
    return { state: 'listening', level: 0 };
  }
}

/** Volume que imita sílabas (~5 por segundo) com pequenas pausas entre palavras. */
export function syntheticSpeech(time: number): number {
  const syllable = Math.max(0, Math.sin(time * Math.PI * 5));
  const words = Math.sin(time * 1.7) > -0.6 ? 1 : 0.1;
  const variation = 0.6 + 0.4 * Math.sin(time * 2.3 + 1);
  return 0.18 * syllable * words * variation;
}
