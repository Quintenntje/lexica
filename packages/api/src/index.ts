import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { loadConfig } from './config';
import { createOllamaChatModel, createOllamaEmbedder } from './providers/ollama';
import { createQdrantVectorStore } from './providers/qdrant';

// Load the repo-root .env if present; real environment variables take precedence.
try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // No .env file: fall back to the environment and the defaults in config.ts.
}

const config = loadConfig();

// Production wiring: real providers behind the same interfaces the tests fake.
const app = createApp({
  embedder: createOllamaEmbedder({ baseUrl: config.OLLAMA_URL, model: config.EMBEDDING_MODEL }),
  chatModel: createOllamaChatModel({ baseUrl: config.OLLAMA_URL, model: config.CHAT_MODEL }),
  vectorStore: createQdrantVectorStore({ url: config.QDRANT_URL }),
});

serve({ fetch: app.fetch, port: config.API_PORT }, (info) => {
  console.log(`Lexica API listening on http://localhost:${info.port}`);
});
