import { serve } from '@hono/node-server';
import { createApp } from './app';
import { loadConfig, loadEnvFile } from './config';
import { createProviders } from './providers';

loadEnvFile();
const config = loadConfig();
const providers = createProviders(config);
const app = createApp(providers);

// Create the Qdrant collection on startup if it is missing. If Qdrant is not up
// yet, the API still starts (health shows it) and the store retries on first use.
providers.vectorStore.init().catch((err: unknown) => {
  console.warn(`Vector store not ready yet: ${err instanceof Error ? err.message : String(err)}`);
});

serve({ fetch: app.fetch, port: config.API_PORT }, (info) => {
  console.log(`Lexica API listening on http://localhost:${info.port}`);
});
