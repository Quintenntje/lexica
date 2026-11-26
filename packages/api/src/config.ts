import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** Runtime configuration, read from environment variables (see `.env.example`). */
const configSchema = z.object({
  OLLAMA_URL: z.url().default('http://localhost:11434'),
  QDRANT_URL: z.url().default('http://localhost:6333'),
  /** Qdrant collection holding the chunks. */
  QDRANT_COLLECTION: z.string().min(1).default('lexica_chunks'),
  EMBEDDING_MODEL: z.string().min(1).default('nomic-embed-text'),
  /** Vector size of the embedding model (nomic-embed-text: 768). Sizes the Qdrant collection. */
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(768),
  CHAT_MODEL: z.string().min(1).default('qwen2.5:3b'),
  API_PORT: z.coerce.number().int().positive().default(8787),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/** Loads the repo-root .env if present; real environment variables take precedence. */
export function loadEnvFile(): void {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
  } catch {
    // No .env file: fall back to the environment and the defaults above.
  }
}
