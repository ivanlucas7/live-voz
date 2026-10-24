// Ferramentas que o modelo pode chamar durante a conversa, e quem as executa.
//
// No Gemini Live a chamada de ferramenta é síncrona: o modelo fica em silêncio
// até receber a resposta. Por isso cada ferramenta tem um tempo máximo.

import { Type, type FunctionCall, type FunctionDeclaration, type FunctionResponse } from '@google/genai';
import { getWeather } from './weather';

export const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'get_weather',
    description:
      'Previsão do tempo de uma cidade: agora, hoje e amanhã (temperatura, chance de chuva, inclusive à tarde). ' +
      'Use sempre que perguntarem sobre clima, chuva, frio, calor ou temperatura.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        city: { type: Type.STRING, description: 'Nome da cidade, por exemplo "Belo Horizonte".' },
      },
      required: ['city'],
    },
  },
  {
    name: 'web_search',
    description:
      'Busca na internet e devolve um resumo curto. Use para notícias, resultados de jogos, preços, eventos e fatos recentes. ' +
      'Não use para clima. Faça no máximo uma busca por pergunta.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'A pergunta completa, em português.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'end_conversation',
    description: 'Encerra a conversa. Chame depois de se despedir, quando a pessoa disser tchau ou pedir para parar.',
    parameters: { type: Type.OBJECT, properties: {} },
  },
];

export const TOOL_LABELS: Record<string, string> = {
  get_weather: 'Vendo a previsão do tempo',
  web_search: 'Buscando na internet',
  end_conversation: 'Encerrando',
};

export interface ToolContext {
  searchEnabled: boolean;
  password: string;
  onEndConversation: () => void;
  fetchImpl?: typeof fetch;
}

export async function runTool(call: FunctionCall, ctx: ToolContext): Promise<FunctionResponse> {
  const name = call.name ?? '';
  const args = (call.args ?? {}) as Record<string, unknown>;
  const respond = (response: Record<string, unknown>): FunctionResponse => ({ id: call.id, name, response });

  try {
    switch (name) {
      case 'get_weather':
        return respond({ output: await getWeather(String(args.city ?? ''), ctx.fetchImpl) });
      case 'web_search':
        if (!ctx.searchEnabled) return respond({ error: 'A busca na internet não está configurada neste app.' });
        return respond({ output: await webSearch(String(args.query ?? ''), ctx) });
      case 'end_conversation':
        ctx.onEndConversation();
        return respond({ output: 'ok' });
      default:
        return respond({ error: `Ferramenta desconhecida: ${name}` });
    }
  } catch (error) {
    return respond({ error: error instanceof Error ? error.message : 'A ferramenta falhou.' });
  }
}

async function webSearch(query: string, ctx: ToolContext): Promise<string> {
  const fetchImpl = ctx.fetchImpl ?? fetch;
  const response = await fetchImpl('/api/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-app-password': ctx.password },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(65_000),
  });
  const body = (await response.json().catch(() => ({}))) as { answer?: string; error?: string };
  if (!response.ok || !body.answer) throw new Error(body.error ?? 'A busca falhou.');
  return body.answer;
}
