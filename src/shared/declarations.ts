// Ferramentas que o modelo pode chamar. Usado pelo navegador e pela função /api/token.

import { Type, type FunctionDeclaration } from '@google/genai';

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
