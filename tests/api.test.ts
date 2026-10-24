import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as health } from '../api/health';
import { clearSearchCache, isLongform, POST as search } from '../api/search';
import { POST as token, setClientFactory } from '../api/token';

const ENV_KEYS = ['GOOGLE_API_KEY', 'APP_PASSWORD', 'OPENROUTER_API_KEY', 'GEMINI_MODEL'];

function req(path: string, init: RequestInit = {}) {
  return new Request(`http://localhost${path}`, { method: 'POST', ...init });
}

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  clearSearchCache();
});

afterEach(() => vi.unstubAllGlobals());

describe('/api/health', () => {
  it('informa o que está configurado sem expor segredos', async () => {
    process.env.GOOGLE_API_KEY = 'segredo';
    process.env.APP_PASSWORD = 'abc';
    const body = await health().json();
    expect(body).toEqual({
      ok: true,
      model: 'gemini-3.1-flash-live-preview',
      hasGoogleKey: true,
      searchProvider: 'google',
      passwordRequired: true,
    });
    expect(JSON.stringify(body)).not.toContain('segredo');
  });
});

describe('/api/token', () => {
  const create = vi.fn();
  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue({ name: 'auth_tokens/xyz', expireTime: '2026-10-24T05:00:00Z' });
    setClientFactory(() => ({ authTokens: { create } }) as never);
  });

  it('gera token de uso único com o modelo e a configuração da sessão', async () => {
    process.env.GOOGLE_API_KEY = 'k';
    process.env.GEMINI_MODEL = 'modelo-x';
    const res = await token(
      req('/api/token', {
        body: JSON.stringify({ voice: 'Charon', name: 'Bia', extraInstructions: 'Fale rápido.', resumeHandle: 'h-1' }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ token: 'auth_tokens/xyz', model: 'modelo-x' });
    const config = create.mock.calls[0][0].config;
    expect(config.uses).toBe(1);
    expect(config.lockAdditionalFields).toBeUndefined();
    expect(Date.parse(config.newSessionExpireTime)).toBeLessThan(Date.now() + 61_000);
    const { model, config: live } = config.liveConnectConstraints;
    expect(model).toBe('modelo-x');
    // Sem isto o Gemini assume TEXT e recusa os modelos de voz.
    expect(live.responseModalities).toEqual(['AUDIO']);
    expect(live.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Charon');
    expect(live.systemInstruction).toContain('Você é Bia');
    expect(live.systemInstruction).toContain('Fale rápido.');
    expect(live.sessionResumption).toEqual({ handle: 'h-1' });
    // Sem OpenRouter: Busca Google embutida, sem a função web_search.
    expect(live.tools[0].functionDeclarations.map((f: { name: string }) => f.name)).toEqual(['get_weather', 'end_conversation']);
    expect(live.tools[1]).toEqual({ googleSearch: {} });
    expect(live.inputAudioTranscription).toEqual({});
  });

  it('com OPENROUTER_API_KEY usa a função web_search no lugar da Busca Google', async () => {
    process.env.GOOGLE_API_KEY = 'k';
    process.env.OPENROUTER_API_KEY = 'or';
    await token(req('/api/token'));
    const live = create.mock.calls[0][0].config.liveConnectConstraints.config;
    expect(live.tools).toHaveLength(1);
    expect(live.tools[0].functionDeclarations.map((f: { name: string }) => f.name)).toContain('web_search');
    expect((await health().json()).searchProvider).toBe('openrouter');
  });

  it('search: false tira a busca do token', async () => {
    process.env.GOOGLE_API_KEY = 'k';
    await token(req('/api/token', { body: JSON.stringify({ search: false }) }));
    const live = create.mock.calls[0][0].config.liveConnectConstraints.config;
    expect(live.tools).toEqual([{ functionDeclarations: expect.any(Array) }]);
    expect(live.tools[0].functionDeclarations.map((f: { name: string }) => f.name)).toEqual(['get_weather', 'end_conversation']);
  });

  it('usa padrões quando o corpo falta ou traz voz inválida', async () => {
    process.env.GOOGLE_API_KEY = 'k';
    await token(req('/api/token'));
    await token(req('/api/token', { body: JSON.stringify({ voice: 'NaoExiste', resumeHandle: 42 }) }));
    for (const [{ config }] of create.mock.calls) {
      const live = config.liveConnectConstraints.config;
      expect(live.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Aoede');
      expect(live.systemInstruction).toContain('Você é Lia');
      expect(live.sessionResumption).toEqual({});
    }
  });

  it('exige a senha quando APP_PASSWORD está definida', async () => {
    process.env.GOOGLE_API_KEY = 'k';
    process.env.APP_PASSWORD = 'certa';
    expect((await token(req('/api/token'))).status).toBe(401);
    expect((await token(req('/api/token', { headers: { 'x-app-password': 'errada' } }))).status).toBe(401);
    expect((await token(req('/api/token', { headers: { 'x-app-password': 'certa' } }))).status).toBe(200);
  });

  it('avisa quando falta a chave do Google', async () => {
    expect((await token(req('/api/token'))).status).toBe(503);
    expect(create).not.toHaveBeenCalled();
  });

  it('devolve 502 quando o Google recusa', async () => {
    process.env.GOOGLE_API_KEY = 'k';
    create.mockRejectedValue(new Error('chave inválida'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await token(req('/api/token'))).status).toBe(502);
  });
});

describe('/api/search', () => {
  const body = (query: unknown) => JSON.stringify({ query });

  it('fica desligada sem OPENROUTER_API_KEY', async () => {
    expect((await search(req('/api/search', { body: body('x') }))).status).toBe(503);
  });

  it('busca, devolve o resumo e guarda em cache', async () => {
    process.env.OPENROUTER_API_KEY = 'or';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'O Brasil venceu por 2 a 1.' } }] })),
    );
    vi.stubGlobal('fetch', fetchMock);

    const first = await search(req('/api/search', { body: body('Quem ganhou o jogo?') }));
    expect(await first.json()).toMatchObject({ answer: 'O Brasil venceu por 2 a 1.', ms: expect.any(Number) });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.plugins).toEqual([{ id: 'web', max_results: 3 }]);
    expect(sent.reasoning).toEqual({ effort: 'low' });
    expect(sent.messages[0].content).toContain('Hoje é');

    const second = await search(req('/api/search', { body: body('quem ganhou o jogo?') }));
    expect(await second.json()).toMatchObject({ cached: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('não guarda erro em cache', async () => {
    process.env.OPENROUTER_API_KEY = 'or';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] })));
    vi.stubGlobal('fetch', fetchMock);
    expect((await search(req('/api/search', { body: body('a') }))).status).toBe(502);
    expect((await search(req('/api/search', { body: body('a') }))).status).toBe(200);
  });

  it('trata resposta vazia como erro', async () => {
    process.env.OPENROUTER_API_KEY = 'or';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }))));
    expect((await search(req('/api/search', { body: body('a') }))).status).toBe(502);
  });

  it('recusa busca sem texto', async () => {
    process.env.OPENROUTER_API_KEY = 'or';
    expect((await search(req('/api/search', { body: body('  ') }))).status).toBe(400);
    expect((await search(req('/api/search', { body: 'não é json' }))).status).toBe(400);
  });

  it('reconhece pedido de texto longo', () => {
    expect(isLongform('leia três parágrafos de Dom Casmurro')).toBe(true);
    expect(isLongform('qual a capital da França?')).toBe(false);
  });
});
