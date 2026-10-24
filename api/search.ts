// POST /api/search — busca na web via OpenRouter (plugin "web"), resumida para ser falada.
//
// Function calling no Gemini Live é síncrono: enquanto a busca roda, o modelo
// fica em silêncio. Por isso há um orçamento de tempo curto e um cache que
// absorve a mesma pergunta repetida no mesmo turno.

import { DEFAULT_SEARCH_MODEL, env, envNumber, isAuthorized, json, unauthorized } from './_lib/config.js';

const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, { answer: string; at: number }>();

const LONGFORM_HINTS = /\b(leia|ler|parágrafos?|capítulo|trecho|história completa|conte uma história)\b/i;

export function isLongform(query: string): boolean {
  return LONGFORM_HINTS.test(query);
}

export function todayPtBr(date = new Date()): string {
  return date.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Sao_Paulo',
  });
}

export function clearSearchCache(): void {
  cache.clear();
}

export async function POST(request: Request): Promise<Response> {
  if (!isAuthorized(request)) return unauthorized();

  const key = env('OPENROUTER_API_KEY');
  if (!key) return json({ error: 'A busca na web não está configurada (falta OPENROUTER_API_KEY).' }, 503);

  let query = '';
  try {
    const body = (await request.json()) as { query?: unknown };
    query = typeof body.query === 'string' ? body.query.trim().slice(0, 500) : '';
  } catch {
    // corpo inválido cai no erro abaixo
  }
  if (!query) return json({ error: 'Faltou o texto da busca.' }, 400);

  const cacheKey = query.toLowerCase();
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return json({ answer: hit.answer, cached: true });
  }

  const longform = isLongform(query);
  const budgetMs = longform
    ? envNumber('SEARCH_LONGFORM_BUDGET_SECONDS', 60) * 1000
    : envNumber('SEARCH_BUDGET_SECONDS', 12) * 1000;
  const sizeRule = longform
    ? 'O usuário pediu um texto longo para ouvir. Entregue o texto completo pedido, sem resumir e sem comentários seus.'
    : 'Responda em no máximo 3 frases curtas, só com a informação pedida.';

  const startedAt = Date.now();
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(budgetMs),
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: env('OPENROUTER_MODEL', DEFAULT_SEARCH_MODEL),
        // Menos páginas = menos texto para o modelo ler = resposta mais rápida.
        plugins: [{ id: 'web', max_results: longform ? 5 : 3 }],
        // Pouco raciocínio: para resumir uma busca em voz alta, velocidade vale mais.
        // Modelos sem raciocínio ignoram este campo.
        reasoning: { effort: longform ? 'medium' : 'low' },
        // Modelos de raciocínio gastam tokens antes da resposta; teto baixo devolve conteúdo vazio.
        max_tokens: longform ? 4000 : 800,
        messages: [
          {
            role: 'system',
            content:
              `Hoje é ${todayPtBr()}. Você é um assistente de busca e responde em português do Brasil. ` +
              `${sizeRule} Use a data de hoje como referência para "hoje", "amanhã" e "fim de semana". ` +
              'Não use markdown, listas, emojis nem links: o texto será lido em voz alta.',
          },
          { role: 'user', content: query },
        ],
      }),
    });
    if (!response.ok) {
      return json({ error: `A busca falhou (HTTP ${response.status}).` }, 502);
    }
    const body = (await response.json()) as {
      choices?: { message?: { content?: string }; finish_reason?: string }[];
    };
    const answer = body.choices?.[0]?.message?.content?.trim();
    if (!answer) return json({ error: 'A busca voltou sem resposta.' }, 502);

    cache.set(cacheKey, { answer, at: Date.now() });
    const ms = Date.now() - startedAt;
    console.log(`Busca em ${ms} ms: ${query.slice(0, 80)}`);
    return json({ answer, ms });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
    return json({ error: timedOut ? 'A busca demorou demais.' : 'A busca falhou.' }, timedOut ? 504 : 502);
  }
}
