import type { Config } from '../config';
import { createOllamaChatModel, createOllamaEmbedder } from './ollama';
import { createQdrantVectorStore } from './qdrant';
import type { Providers } from './types';

/** Production wiring: real providers behind the same interfaces the tests fake. */
export function createProviders(config: Config): Providers {
  return {
    embedder: createOllamaEmbedder({
      baseUrl: config.OLLAMA_URL,
      model: config.EMBEDDING_MODEL,
      dimensions: config.EMBEDDING_DIMENSIONS,
    }),
    chatModel: createOllamaChatModel({ baseUrl: config.OLLAMA_URL, model: config.CHAT_MODEL }),
    vectorStore: createQdrantVectorStore({
      url: config.QDRANT_URL,
      vectorSize: config.EMBEDDING_DIMENSIONS,
      collection: config.QDRANT_COLLECTION,
    }),
  };
}
