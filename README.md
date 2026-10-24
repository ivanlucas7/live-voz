# Live Voz

Conversa por voz em tempo real, em português, com o **Gemini Live** do Google, e um rosto animado que mexe a boca enquanto fala. Funciona no navegador do PC, do tablet e do celular.

- Resposta em cerca de meio segundo: o navegador fala direto com o Gemini, sem servidor no meio do áudio.
- Dá para interromper a qualquer momento: a fala para na hora.
- O rosto pisca, olha em volta e muda de cor conforme o momento: ouvindo, pensando, falando ou com erro.
- Ferramentas: previsão do tempo (Open-Meteo, sem chave) e busca na internet (Busca Google do próprio Gemini, com a mesma chave).
- Diga "tchau" e ela se despede e encerra sozinha.
- A conversa continua sem cortes depois do limite de 10 min por conexão do Gemini.
- Transcrição da conversa e campo para digitar, se preferir.
- Senha opcional para ninguém usar sua cota.

Para ver só o rosto, sem chave nenhuma, abra o site com `?demo` no fim do endereço.

## Como funciona

```
Navegador (rosto + microfone + alto-falante)
  │ 1. pede um token          ┌──────────────────────────┐
  ├──────────────────────────▶│ Vercel: /api/token       │── usa a GOOGLE_API_KEY
  │                           │         /api/search      │── só se houver OPENROUTER_API_KEY
  │ 2. conversa por voz       └──────────────────────────┘
  └──────────────────────────▶ Gemini Live (WebSocket)
```

A Vercel não mantém WebSocket aberto. Então o navegador conecta direto no Gemini com um **token temporário**, gerado a cada conversa pela função `/api/token`. A sua chave do Google fica só na Vercel. O token já leva a configuração da conversa (voz, prompt e ferramentas), serve para abrir uma única conversa, só pode ser usado no primeiro minuto e expira em 30 minutos. Tudo isso é automático, você não precisa gerar nada.

## Colocar no ar na Vercel (uma vez só)

1. Pegue uma chave em [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
2. Em [vercel.com/new](https://vercel.com/new), clique em **Import** no repositório `live-voz`. A Vercel reconhece o projeto sozinha (Vite), não mude nada no build.
3. Antes de clicar em Deploy, abra **Environment Variables** e adicione:

   | Nome | Obrigatória | Para quê |
   |---|---|---|
   | `GOOGLE_API_KEY` | sim | Chave do Gemini |
   | `APP_PASSWORD` | recomendada | Senha que o app pede. Sem ela, qualquer pessoa com o link usa sua cota |
   | `OPENROUTER_API_KEY` | não | Troca a Busca Google embutida pela busca do OpenRouter ([openrouter.ai/keys](https://openrouter.ai/keys)). Sem ela, a busca usa o Google e funciona do mesmo jeito |
   | `OPENROUTER_MODEL` | não | Modelo da busca (padrão `openai/gpt-5.6-luna`) |
   | `GEMINI_MODEL` | não | Modelo de voz (padrão `gemini-3.1-flash-live-preview`) |

4. Clique em **Deploy**. Em um minuto sai o endereço `https://live-voz-….vercel.app`.
5. Abra no celular, toque no ⚙️ para digitar a senha (se configurou) e toque no microfone.

Se mudar uma variável depois, vá em **Deployments → ⋯ → Redeploy** para ela valer.

Cada pull request ganha um link de prévia próprio da Vercel, então dá para testar mudanças no celular antes de aprovar.

## Rodar no computador

Precisa do Node 20 ou mais novo.

```bash
npm install
cp .env.example .env   # cole a GOOGLE_API_KEY
npm run dev            # abre em http://localhost:5173
```

O `npm run dev` já serve as funções de `api/` igual à Vercel. O microfone funciona em `localhost`; em outro endereço o navegador exige HTTPS.

```bash
npm test           # testes automáticos
npm run build      # checa os tipos e gera a versão de produção em dist/
```

## Estrutura

```
api/                    Funções da Vercel
  token.ts              Gera o token temporário do Gemini
  search.ts             Busca na internet via OpenRouter, com cache e tempo máximo
  health.ts             Diz ao app o que está configurado
src/
  main.ts               Interface: botões, transcrição, configurações, tela sempre ligada
  live/conversation.ts  Sessão com o Gemini: áudio, ferramentas, interrupção, reconexão
  audio/engine.ts       Microfone e alto-falante (WebAudio)
  audio/pcm.ts          Conversões de áudio
  face/animator.ts      Expressões do rosto e sincronia da boca com o volume da voz
  face/renderer.ts      Desenho do rosto no canvas
  tools/                Ferramentas: clima e busca
  settings.ts           Voz, nome, instruções extras e prompt do sistema
  demo.ts               Modo demonstração (?demo)
public/worklets/        Captura e reprodução de áudio fora do thread da página
tests/                  Testes (Vitest)
```

## O que mudou em relação ao projeto antigo

- **Sem servidor no meio do áudio.** O proxy FastAPI saiu. O navegador conecta direto no Gemini com token temporário, o que corta um salto de rede e cabe na Vercel.
- **Menos travamentos.** Captura e reprodução rodam em AudioWorklets, fora do thread da página. O player junta 120 ms de áudio antes de tocar e, se a rede engasgar, espera encher de novo em vez de picotar.
- **Interrupção imediata.** Quando o Gemini avisa que a pessoa interrompeu, o buffer é esvaziado na hora.
- **Reconexão mais esperta.** Troca de conexão aos 9 min ou quando o Gemini avisa que vai desligar (`goAway`), sempre num momento em que ela não está falando. O áudio do microfone desse intervalo é guardado e enviado depois. Quedas de rede tentam de novo 3 vezes.
- **Conversa com memória.** A regra antiga de "isolamento de turno" foi removida: agora ela lembra do que foi dito antes, como numa conversa normal.
- **Rosto animado, layout responsivo e modo demonstração.**
- **Sem Hermes.**

## Limitações conhecidas

- Enquanto uma ferramenta roda, o Gemini fica em silêncio. O rosto mostra que está pensando.
- No iPhone, com o microfone ligado, o som pode sair mais baixo. É uma limitação do Safari com WebAudio.
- O cancelamento de eco é o do próprio navegador. Em caixa de som alta, use fone se ela começar a se interromper sozinha.
- Os modelos Live do Gemini ainda são "preview". Se o Google renomear o modelo, troque `GEMINI_MODEL` na Vercel.
