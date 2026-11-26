import { Hono } from 'hono';
import type { ApiError } from '@lexica/shared';
import type { Providers } from './providers/types';
import { documentRoutes } from './routes/documents';
import { healthRoutes } from './routes/health';

/**
 * App factory. The app receives its providers instead of creating them, so
 * production passes Ollama/Qdrant and tests pass in-memory fakes.
 */
export function createApp(providers: Providers) {
  const app = new Hono();

  app.route('/api/health', healthRoutes(providers));
  app.route('/api/documents', documentRoutes(providers));

  app.notFound((c) =>
    c.json<ApiError>({ error: { code: 'NOT_FOUND', message: `No route for ${c.req.path}` } }, 404),
  );

  app.onError((err, c) => {
    console.error(err);
    return c.json<ApiError>(
      { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on the server.' } },
      500,
    );
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
