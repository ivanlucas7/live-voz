// GET /api/health — o frontend usa para saber se precisa pedir senha e se a busca está ligada.

import { env, geminiModel, json, passwordRequired, searchProvider } from './_lib/config.js';

export function GET(): Response {
  return json({
    ok: true,
    model: geminiModel(),
    hasGoogleKey: env('GOOGLE_API_KEY') !== '',
    searchProvider: searchProvider(),
    passwordRequired: passwordRequired(),
  });
}
