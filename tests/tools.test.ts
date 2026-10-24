import { describe, expect, it, vi } from 'vitest';
import { runTool, TOOL_DECLARATIONS } from '../src/tools';
import { buildReport, cleanCityName, describeWeatherCode, getWeather } from '../src/tools/weather';
import { buildSystemPrompt } from '../src/settings';

const place = { name: 'Campinas', admin1: 'São Paulo', country: 'Brasil', latitude: -22.9, longitude: -47.06 };
const forecast = {
  current: { time: '2026-10-24T10:00', temperature_2m: 24.4, apparent_temperature: 25.6, relative_humidity_2m: 60, wind_speed_10m: 11.2, weather_code: 2 },
  daily: {
    time: ['2026-10-24', '2026-10-25'],
    weather_code: [3, 63],
    temperature_2m_max: [29.6, 22.1],
    temperature_2m_min: [17.2, 16.4],
    precipitation_probability_max: [20, 90],
  },
  hourly: {
    time: ['2026-10-24T09:00', '2026-10-24T14:00', '2026-10-24T17:00', '2026-10-25T15:00'],
    precipitation_probability: [5, 30, 45, 80],
  },
};

function weatherFetch() {
  return vi.fn(async (url: string) =>
    new Response(JSON.stringify(url.includes('geocoding') ? { results: [place] } : forecast)),
  ) as unknown as typeof fetch;
}

describe('clima', () => {
  it('monta o relatório em português', () => {
    const report = buildReport(place, forecast);
    expect(report.local).toBe('Campinas, São Paulo, Brasil');
    expect(report.agora).toEqual({ temperatura: 24, sensacao: 26, condicao: 'parcialmente nublado', umidade: 60, vento_kmh: 11 });
    expect(report.hoje).toMatchObject({ maxima: 30, minima: 17, chance_de_chuva: 20, chance_de_chuva_a_tarde: 45 });
    expect(report.amanha).toMatchObject({ condicao: 'chuva', chance_de_chuva_a_tarde: 80 });
  });

  it('limpa o nome da cidade', () => {
    expect(cleanCityName('São José dos Campos, SP')).toBe('São José dos Campos');
    expect(cleanCityName('Embu-Guaçu')).toBe('Embu-Guaçu');
  });

  it('traduz códigos do tempo', () => {
    expect(describeWeatherCode(95)).toBe('trovoadas');
    expect(describeWeatherCode(1234)).toBe('condição desconhecida');
  });

  it('usa cache para a mesma cidade no mesmo dia', async () => {
    const fetchMock = weatherFetch();
    await getWeather('Cidade Cache', fetchMock);
    await getWeather('cidade cache', fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(2); // geocoding + previsão, só uma vez
  });

  it('avisa quando não acha a cidade', async () => {
    const fetchMock = vi.fn(async () => new Response('{}')) as unknown as typeof fetch;
    await expect(getWeather('Xyzabc', fetchMock)).rejects.toThrow('Não encontrei');
  });
});

describe('runTool', () => {
  const base = { searchEnabled: true, password: 'p', onEndConversation: vi.fn() };

  it('declara as três ferramentas', () => {
    expect(TOOL_DECLARATIONS.map((t) => t.name)).toEqual(['get_weather', 'web_search', 'end_conversation']);
  });

  it('executa o clima e devolve com o id da chamada', async () => {
    const res = await runTool({ id: '1', name: 'get_weather', args: { city: 'Campinas' } }, { ...base, fetchImpl: weatherFetch() });
    expect(res.id).toBe('1');
    expect((res.response as { output: { local: string } }).output.local).toContain('Campinas');
  });

  it('chama /api/search com a senha', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ answer: 'resposta' }))) as unknown as typeof fetch;
    const res = await runTool({ id: '2', name: 'web_search', args: { query: 'notícias' } }, { ...base, fetchImpl });
    expect(res.response).toEqual({ output: 'resposta' });
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers['x-app-password']).toBe('p');
  });

  it('devolve erro legível quando a busca falha ou está desligada', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: 'A busca demorou demais.' }), { status: 504 })) as unknown as typeof fetch;
    expect((await runTool({ name: 'web_search', args: { query: 'x' } }, { ...base, fetchImpl })).response).toEqual({ error: 'A busca demorou demais.' });
    expect((await runTool({ name: 'web_search', args: { query: 'x' } }, { ...base, searchEnabled: false })).response).toHaveProperty('error');
  });

  it('encerra a conversa quando pedido', async () => {
    const onEndConversation = vi.fn();
    await runTool({ name: 'end_conversation', args: {} }, { ...base, onEndConversation });
    expect(onEndConversation).toHaveBeenCalled();
  });

  it('responde erro para ferramenta desconhecida', async () => {
    expect((await runTool({ name: 'hermes_memory_recall' }, base)).response).toHaveProperty('error');
  });
});

describe('prompt', () => {
  it('inclui nome, data e instruções extras', () => {
    const prompt = buildSystemPrompt({ name: 'Bia', extraInstructions: 'Me chame de Ivan.' }, new Date('2026-10-24T15:30:00Z'));
    expect(prompt).toContain('Você é Bia');
    expect(prompt).toContain('24 de outubro de 2026');
    expect(prompt).toContain('12:30');
    expect(prompt).toContain('Me chame de Ivan.');
    expect(prompt).not.toMatch(/hermes/i);
  });
});
