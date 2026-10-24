// Preferências salvas no navegador (voz, instruções extras e senha do app).

import { DEFAULT_ASSISTANT_NAME, DEFAULT_VOICE } from './shared/prompt';

export { buildSystemPrompt, VOICES } from './shared/prompt';

export interface Settings {
  voice: string;
  name: string;
  extraInstructions: string;
  password: string;
}

export const DEFAULT_SETTINGS: Settings = {
  voice: DEFAULT_VOICE,
  name: DEFAULT_ASSISTANT_NAME,
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
