// Ferramentas que o modelo pode chamar. Usado pelo navegador e pela função /api/token.

import { Type, type FunctionDeclaration, type Tool } from '@google/genai';

/**
 * De onde vem a busca na internet:
 * - "google": a Busca Google embutida no Gemini (usa a mesma GOOGLE_API_KEY);
 * - "openrouter": a função web_search, via /api/search (precisa de OPENROUTER_API_KEY).
 */
export type SearchProvider = 'google' | 'openrouter';

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

export function buildTools(search: SearchProvider): Tool[] {
  const functionDeclarations = TOOL_DECLARATIONS.filter((tool) => search === 'openrouter' || tool.name !== 'web_search');
  return search === 'google' ? [{ functionDeclarations }, { googleSearch: {} }] : [{ functionDeclarations }];
}
