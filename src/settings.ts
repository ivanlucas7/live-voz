// Preferências salvas no navegador (voz, instruções extras e senha do app).

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

export interface Settings {
  voice: string;
  name: string;
  extraInstructions: string;
  password: string;
}

export const DEFAULT_SETTINGS: Settings = {
  voice: 'Aoede',
  name: 'Lia',
  extraInstructions: '',
  password: '',
};

const STORAGE_KEY = 'live-voz:settings';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // modo privado ou armazenamento bloqueado: segue sem salvar
  }
}

/** Instruções do sistema. Curtas de propósito: prompt longo piora a obediência do modelo de voz. */
export function buildSystemPrompt(settings: Pick<Settings, 'name' | 'extraInstructions'>, now = new Date()): string {
  const date = now.toLocaleString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });
  const name = settings.name.trim() || DEFAULT_SETTINGS.name;
  const lines = [
    `Você é ${name}, uma assistente de voz que conversa em tempo real em português do Brasil.`,
    `Agora é ${date} (horário de Brasília).`,
    'Fale como uma pessoa numa conversa: tom natural, coloquial e simpático.',
    'Seja breve: em geral uma a três frases. Vá direto ao ponto e sempre termine a frase.',
    'Nada de markdown, listas, emojis ou símbolos: tudo o que você diz é ouvido, não lido.',
    'Cumprimente só no começo da conversa. Lembre do que já foi dito e use isso quando fizer sentido.',
    'Se não entendeu ou o áudio cortou, peça para repetir em poucas palavras.',
    'Para clima, use get_weather. Para notícias, fatos recentes ou algo que você não sabe, use web_search uma vez por pergunta e resuma o resultado.',
    'Enquanto uma ferramenta roda, não invente a resposta. Se ela falhar, diga isso de forma simples.',
    'Se a pessoa pedir algo longo de propósito, como ler um texto ou contar uma história, pode falar mais.',
    'Quando a pessoa se despedir ou pedir para encerrar, despeça-se em uma frase e chame end_conversation.',
  ];
  const extra = settings.extraInstructions.trim();
  if (extra) lines.push(`Instruções do usuário: ${extra}`);
  return lines.join('\n');
}
