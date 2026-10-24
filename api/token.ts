// POST /api/token — gera um token efêmero do Gemini Live para o navegador.
//
// A GOOGLE_API_KEY nunca sai do servidor. O navegador recebe um token de uso
// único, que só abre uma sessão nova durante 1 minuto e expira em 30 minutos.
// O token leva o modelo e a configuração da sessão (voz, prompt, ferramentas,
// retomada): com token, o Gemini usa essa configuração e não a do navegador.
// Cada (re)conexão pede um token novo.

import { GoogleGenAI } from '@google/genai';
import { buildLiveConfig, type SessionRequest } from '../src/shared/liveConfig.js';
import { env, envNumber, geminiModel, isAuthorized, json, unauthorized } from './_lib/config.js';

type TokenClient = Pick<GoogleGenAI, 'authTokens'>;

let clientFactory = (apiKey: string): TokenClient =>
  new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1alpha' } });

/** Só para testes: troca o cliente do SDK por um falso. */
export function setClientFactory(factory: (apiKey: string) => TokenClient): void {
  clientFactory = factory;
}

export async function POST(request: Request): Promise<Response> {
  if (!isAuthorized(request)) return unauthorized();

  const apiKey = env('GOOGLE_API_KEY');
  if (!apiKey) {
    return json({ error: 'GOOGLE_API_KEY não configurada no servidor.' }, 503);
  }

  let session: SessionRequest = {};
  try {
    const body: unknown = await request.json();
    if (body && typeof body === 'object') session = body as SessionRequest;
  } catch {
    // sem corpo: usa voz e prompt padrão
  }

  const model = geminiModel();
  const now = Date.now();
  const expireMinutes = envNumber('TOKEN_EXPIRE_MINUTES', 30);

  try {
    const token = await clientFactory(apiKey).authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(now + expireMinutes * 60_000).toISOString(),
        newSessionExpireTime: new Date(now + 60_000).toISOString(),
        // Sem lockAdditionalFields: a sessão usa exatamente esta configuração.
        liveConnectConstraints: { model, config: buildLiveConfig(session, new Date(now)) },
        httpOptions: { apiVersion: 'v1alpha' },
      },
    });
    if (!token.name) throw new Error('resposta sem token');
    return json({ token: token.name, model, expireTime: token.expireTime ?? null });
  } catch (error) {
    console.error('Falha ao criar token efêmero:', error);
    return json({ error: 'Não consegui gerar o token do Gemini. Confira a GOOGLE_API_KEY.' }, 502);
  }
}
