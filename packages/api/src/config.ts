import { z } from 'zod';

/** Runtime configuration, read from environment variables (see `.env.example`). */
const configSchema = z.object({
  OLLAMA_URL: z.url().default('http://localhost:11434'),
  QDRANT_URL: z.url().default('http://localhost:6333'),
  EMBEDDING_MODEL: z.string().min(1).default('nomic-embed-text'),
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
