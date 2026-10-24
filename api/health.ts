// GET /api/health — o frontend usa para saber se precisa pedir senha e se a busca está ligada.

import { env, geminiModel, json, passwordRequired } from './_lib/config.js';

export function GET(): Response {
  return json({
    ok: true,
    model: geminiModel(),
    hasGoogleKey: env('GOOGLE_API_KEY') !== '',
    searchEnabled: env('OPENROUTER_API_KEY') !== '',
    passwordRequired: passwordRequired(),
  });
}
