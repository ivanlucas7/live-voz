// Previsão do tempo via Open-Meteo: gratuito, sem chave e chamado direto do navegador.

const WMO_PT: Record<number, string> = {
  0: 'céu limpo',
  1: 'predomínio de sol',
  2: 'parcialmente nublado',
  3: 'nublado',
  45: 'neblina',
  48: 'neblina com geada',
  51: 'garoa fraca',
  53: 'garoa',
  55: 'garoa forte',
  56: 'garoa congelante',
  57: 'garoa congelante forte',
  61: 'chuva fraca',
  63: 'chuva',
  65: 'chuva forte',
  66: 'chuva congelante',
  67: 'chuva congelante forte',
  71: 'neve fraca',
  73: 'neve',
  75: 'neve forte',
  77: 'grãos de neve',
  80: 'pancadas de chuva fracas',
  81: 'pancadas de chuva',
  82: 'pancadas de chuva fortes',
  85: 'pancadas de neve',
  86: 'pancadas de neve fortes',
  95: 'trovoadas',
  96: 'trovoadas com granizo',
  99: 'trovoadas com granizo forte',
};

export function describeWeatherCode(code: number | undefined): string {
  return code === undefined ? 'sem dados' : (WMO_PT[code] ?? 'condição desconhecida');
}

interface GeoResult {
  name: string;
  admin1?: string;
  country?: string;
  latitude: number;
  longitude: number;
}

interface Forecast {
  current: {
    time: string;
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    wind_speed_10m: number;
    weather_code: number;
  };
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: (number | null)[];
  };
  hourly: {
    time: string[];
    precipitation_probability: (number | null)[];
  };
}

export interface WeatherReport {
  local: string;
  agora: { temperatura: number; sensacao: number; condicao: string; umidade: number; vento_kmh: number };
  hoje: DayReport;
  amanha: DayReport;
}

interface DayReport {
  data: string;
  condicao: string;
  minima: number;
  maxima: number;
  chance_de_chuva: number | null;
  chance_de_chuva_a_tarde: number | null;
}

const cache = new Map<string, { report: WeatherReport; at: number }>();
const CACHE_TTL_MS = 30 * 60_000;

/** "São José dos Campos, SP" → "São José dos Campos" (o geocoder não entende a sigla do estado). */
export function cleanCityName(city: string): string {
  return city.split(/,| - /)[0].trim();
}

function round(value: number): number {
  return Math.round(value);
}

/** Maior chance de chuva entre 12h e 18h de um dia. */
function afternoonRain(hourly: Forecast['hourly'], day: string): number | null {
  let best: number | null = null;
  hourly.time.forEach((time, i) => {
    const hour = Number(time.slice(11, 13));
    const value = hourly.precipitation_probability[i];
    if (time.startsWith(day) && hour >= 12 && hour <= 18 && value !== null && value !== undefined) {
      best = Math.max(best ?? 0, value);
    }
  });
  return best;
}

export function buildReport(place: GeoResult, forecast: Forecast): WeatherReport {
  const day = (i: number): DayReport => {
    const date = forecast.daily.time[i];
    return {
      data: date,
      condicao: describeWeatherCode(forecast.daily.weather_code[i]),
      minima: round(forecast.daily.temperature_2m_min[i]),
      maxima: round(forecast.daily.temperature_2m_max[i]),
      chance_de_chuva: forecast.daily.precipitation_probability_max[i] ?? null,
      chance_de_chuva_a_tarde: afternoonRain(forecast.hourly, date),
    };
  };
  const c = forecast.current;
  return {
    local: [place.name, place.admin1, place.country].filter(Boolean).join(', '),
    agora: {
      temperatura: round(c.temperature_2m),
      sensacao: round(c.apparent_temperature),
      condicao: describeWeatherCode(c.weather_code),
      umidade: round(c.relative_humidity_2m),
      vento_kmh: round(c.wind_speed_10m),
    },
    hoje: day(0),
    amanha: day(1),
  };
}

export async function getWeather(city: string, fetchImpl: typeof fetch = fetch): Promise<WeatherReport> {
  const name = cleanCityName(city);
  if (!name) throw new Error('Faltou o nome da cidade.');

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const key = `${name.toLowerCase()}|${today}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.report;

  const signal = AbortSignal.timeout(8000);
  const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?count=1&language=pt&format=json&name=${encodeURIComponent(name)}`;
  const geo = (await (await fetchImpl(geoUrl, { signal })).json()) as { results?: GeoResult[] };
  const place = geo.results?.[0];
  if (!place) throw new Error(`Não encontrei a cidade "${name}".`);

  const params = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    hourly: 'precipitation_probability',
    timezone: 'auto',
    forecast_days: '2',
  });
  const response = await fetchImpl(`https://api.open-meteo.com/v1/forecast?${params}`, { signal });
  if (!response.ok) throw new Error('O serviço de previsão do tempo não respondeu.');
  const report = buildReport(place, (await response.json()) as Forecast);
  cache.set(key, { report, at: Date.now() });
  return report;
}
