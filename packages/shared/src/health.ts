import { z } from 'zod';

/** Status of a model provider (embedder or chat model), e.g. Ollama. */
export const modelHealthSchema = z.object({
  provider: z.string(),
  model: z.string(),
  /** The provider's server answered. */
  reachable: z.boolean(),
  /** The configured model is available on the provider (e.g. pulled into Ollama). */
  modelPresent: z.boolean(),
});

/** Status of the vector store, e.g. Qdrant. */
export const vectorStoreHealthSchema = z.object({
  provider: z.string(),
  reachable: z.boolean(),
});

/** Response of `GET /api/health`. */
export const healthResponseSchema = z.object({
  /** `ok` only when every dependency is reachable and every model is present. */
  status: z.enum(['ok', 'degraded']),
  vectorStore: vectorStoreHealthSchema,
  embedder: modelHealthSchema,
  chatModel: modelHealthSchema,
});

export type ModelHealth = z.infer<typeof modelHealthSchema>;
export type VectorStoreHealth = z.infer<typeof vectorStoreHealthSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
