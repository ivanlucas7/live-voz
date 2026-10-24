// Configuração da sessão do Gemini Live.
//
// Ela vai dentro do token efêmero (em /api/token): com token, o Gemini usa a
// configuração travada no token e ignora a que o navegador manda. Por isso
// voz, prompt, ferramentas e retomada de sessão são definidos no servidor.

import { Modality, type LiveConnectConfig } from '@google/genai';
import { buildTools, type SearchProvider } from './declarations.js';
import { buildSystemPrompt, DEFAULT_ASSISTANT_NAME, DEFAULT_VOICE, VOICE_IDS } from './prompt.js';

export interface SessionRequest {
  voice?: unknown;
  name?: unknown;
  extraInstructions?: unknown;
  resumeHandle?: unknown;
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function buildLiveConfig(
  request: SessionRequest,
  search: SearchProvider = 'google',
  now = new Date(),
): LiveConnectConfig {
  const voice = typeof request.voice === 'string' && VOICE_IDS.includes(request.voice) ? request.voice : DEFAULT_VOICE;
  const resumeHandle = text(request.resumeHandle, 2000);
  return {
    responseModalities: [Modality.AUDIO],
    systemInstruction: buildSystemPrompt(
      {
        name: text(request.name, 30) || DEFAULT_ASSISTANT_NAME,
        extraInstructions: text(request.extraInstructions, 600),
      },
      now,
    ),
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    contextWindowCompression: { slidingWindow: {} },
    sessionResumption: resumeHandle ? { handle: resumeHandle } : {},
    tools: buildTools(search),
  };
}
