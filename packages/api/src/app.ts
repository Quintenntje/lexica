import { Hono } from 'hono';
import type { Providers } from './providers/types';
import { DEFAULT_MIN_RELEVANCE_SCORE } from './pipeline/relevance';
import { chatRoutes, type ChatOptions } from './routes/chat';
import { documentRoutes } from './routes/documents';
import { apiError } from './routes/errors';
import { healthRoutes } from './routes/health';

/**
 * App factory. The app receives its providers instead of creating them, so
 * production passes Ollama/Qdrant and tests pass in-memory fakes.
 */
export type AppOptions = Partial<ChatOptions>;

export function createApp(
  providers: Providers,
  { minRelevanceScore = DEFAULT_MIN_RELEVANCE_SCORE }: AppOptions = {},
) {
  const app = new Hono();

  app.route('/api/health', healthRoutes(providers));
  app.route('/api/documents', documentRoutes(providers));
  app.route('/api/chat', chatRoutes(providers, { minRelevanceScore }));

  app.notFound((c) => apiError(c, 404, 'NOT_FOUND', `No route for ${c.req.path}`));

  app.onError((err, c) => {
    console.error(err);
    return apiError(c, 500, 'INTERNAL_ERROR', 'Something went wrong on the server.');
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
