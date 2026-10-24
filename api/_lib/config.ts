// Configuração lida das variáveis de ambiente da Vercel (ou do .env local).
// Arquivos em api/_lib não viram rotas: a Vercel ignora pastas com "_".

import { timingSafeEqual } from 'node:crypto';

export const DEFAULT_MODEL = 'gemini-3.1-flash-live-preview';
export const DEFAULT_SEARCH_MODEL = 'openai/gpt-5.6-luna';

export function env(name: string, fallback = ''): string {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? fallback : value.trim();
}

export function envNumber(name: string, fallback: number): number {
  const parsed = Number(env(name));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function geminiModel(): string {
  return env('GEMINI_MODEL', DEFAULT_MODEL);
}

/** Com chave do OpenRouter usa /api/search; sem ela, a Busca Google embutida no Gemini. */
export function searchProvider(): 'google' | 'openrouter' {
  return env('OPENROUTER_API_KEY') ? 'openrouter' : 'google';
}

export function passwordRequired(): boolean {
  return env('APP_PASSWORD') !== '';
}

/** Compara a senha do cabeçalho com APP_PASSWORD sem vazar tempo de comparação. */
export function isAuthorized(request: Request): boolean {
  const expected = env('APP_PASSWORD');
  if (!expected) return true;
  const given = request.headers.get('x-app-password') ?? '';
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export function unauthorized(): Response {
  return json({ error: 'Senha incorreta ou ausente.' }, 401);
}
