// Prompt e vozes, usados pelo navegador e pela função /api/token.
// Imports com extensão .js: este arquivo também roda no Node da Vercel.

export const VOICES = [
  { id: 'Aoede', label: 'Aoede (feminina, leve)' },
  { id: 'Kore', label: 'Kore (feminina, firme)' },
  { id: 'Leda', label: 'Leda (feminina, jovem)' },
  { id: 'Zephyr', label: 'Zephyr (feminina, clara)' },
  { id: 'Charon', label: 'Charon (masculina, grave)' },
  { id: 'Puck', label: 'Puck (masculina, animada)' },
  { id: 'Fenrir', label: 'Fenrir (masculina, intensa)' },
  { id: 'Orus', label: 'Orus (masculina, firme)' },
] as const;

export const VOICE_IDS: readonly string[] = VOICES.map((voice) => voice.id);
export const DEFAULT_VOICE = 'Aoede';
export const DEFAULT_ASSISTANT_NAME = 'Lia';

/** Instruções do sistema. Curtas de propósito: prompt longo piora a obediência do modelo de voz. */
export function buildSystemPrompt(settings: { name: string; extraInstructions: string }, now = new Date()): string {
  const date = now.toLocaleString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });
  const name = settings.name.trim() || DEFAULT_ASSISTANT_NAME;
  const lines = [
    `Você é ${name}, uma assistente de voz que conversa em tempo real em português do Brasil.`,
    `Agora é ${date} (horário de Brasília).`,
    'Fale como uma pessoa numa conversa: tom natural, coloquial e simpático.',
    'Seja breve: em geral uma a três frases. Vá direto ao ponto e sempre termine a frase.',
    'Nada de markdown, listas, emojis ou símbolos: tudo o que você diz é ouvido, não lido.',
    'Cumprimente só no começo da conversa. Lembre do que já foi dito e use isso quando fizer sentido.',
    'Se não entendeu ou o áudio cortou, peça para repetir em poucas palavras.',
    'Para clima, use get_weather. Para notícias, jogos, horários, endereços, fatos recentes ou algo que você não sabe, busque na internet uma vez por pergunta e resuma o resultado.',
    'Enquanto uma ferramenta roda, não invente a resposta. Se ela falhar, diga isso de forma simples.',
    'Se a pessoa pedir algo longo de propósito, como ler um texto ou contar uma história, pode falar mais.',
    'Quando a pessoa se despedir ou pedir para encerrar, despeça-se em uma frase e chame end_conversation.',
  ];
  const extra = settings.extraInstructions.trim();
  if (extra) lines.push(`Instruções do usuário: ${extra}`);
  return lines.join('\n');
}
