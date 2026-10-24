import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite';

/**
 * Em desenvolvimento (`npm run dev`), serve as funções de api/ pelo próprio Vite,
 * imitando a Vercel. Assim não é preciso instalar a CLI da Vercel para testar.
 */
function localApi(): Plugin {
  return {
    name: 'local-vercel-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/api', async (req, res, next) => {
        const name = (req.url ?? '').split('?')[0].replace(/^\/+|\/+$/g, '');
        if (!/^[a-z-]+$/.test(name)) return next();
        try {
          const mod = (await server.ssrLoadModule(`/api/${name}.ts`)) as Record<string, unknown>;
          const handler = mod[req.method ?? 'GET'];
          if (typeof handler !== 'function') {
            res.statusCode = 405;
            res.end('Method Not Allowed');
            return;
          }
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const headers = new Headers();
          for (const [key, value] of Object.entries(req.headers)) {
            if (typeof value === 'string') headers.set(key, value);
          }
          const request = new Request(`http://localhost${req.originalUrl ?? req.url}`, {
            method: req.method,
            headers,
            body: chunks.length && req.method !== 'GET' ? Buffer.concat(chunks) : undefined,
          });
          const response = (await handler(request)) as Response;
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (error) {
          if ((error as { code?: string }).code === 'ERR_LOAD_URL') return next();
          console.error(error);
          res.statusCode = 500;
          res.end('Erro interno');
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Coloca as variáveis do .env em process.env para as funções de api/.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''));
  return {
    plugins: [localApi()],
    test: {
      environment: 'node',
    },
  };
});
