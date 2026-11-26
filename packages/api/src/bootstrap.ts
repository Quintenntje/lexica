import { createApp } from './app';
import { loadConfig, loadEnvFile } from './config';
import { createProviders } from './providers';

/**
 * Production wiring shared by the server and the CLI commands: reads the
 * configuration (repo-root .env, then the environment), creates the real
 * providers and the app. `env` overrides single variables, e.g. the eval's
 * temporary Qdrant collection.
 */
export function bootstrap(env: NodeJS.ProcessEnv = {}) {
  loadEnvFile();
  const config = loadConfig({ ...process.env, ...env });
  const providers = createProviders(config);
  const app = createApp(providers, { minRelevanceScore: config.MIN_RELEVANCE_SCORE });
  return { config, providers, app };
}
