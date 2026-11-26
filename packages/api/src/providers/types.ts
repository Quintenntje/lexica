import type { ModelHealth, VectorStoreHealth } from '@lexica/shared';

/**
 * Provider interfaces: the seam between the RAG pipeline and the outside world.
 *
 * Production wires in Ollama and Qdrant; tests wire in in-memory fakes; a cloud
 * provider could be swapped in without touching the pipeline. Each interface
 * only grows the methods a ticket actually needs (embedding, streaming chat,
 * upsert/search/delete arrive with the pipeline tickets).
 */

export type ProviderHealth = ModelHealth;

/** Turns texts into fixed-size vectors (e.g. Ollama `nomic-embed-text`, 768 dims). */
export interface Embedder {
  readonly model: string;
  checkHealth(): Promise<ModelHealth>;
}

/** Generates a streamed answer from a system prompt and messages (e.g. Ollama `qwen2.5:3b`). */
export interface ChatModel {
  readonly model: string;
  checkHealth(): Promise<ModelHealth>;
}

/** Stores chunk vectors with payload and searches them by similarity (e.g. Qdrant). */
export interface VectorStore {
  checkHealth(): Promise<VectorStoreHealth>;
}

export interface Providers {
  embedder: Embedder;
  chatModel: ChatModel;
  vectorStore: VectorStore;
}
