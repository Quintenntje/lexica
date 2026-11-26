import type { ChatModel, Embedder, ProviderHealth, VectorStore } from '../src/providers/types';

/**
 * In-memory fakes for the provider interfaces. Tests inject these into the app
 * factory so the API can be exercised over HTTP without Docker, Qdrant or Ollama.
 */

export function fakeEmbedder(health: Partial<ProviderHealth> = {}): Embedder {
  const model = health.model ?? 'fake-embed';
  return {
    model,
    async checkHealth() {
      return { provider: 'fake', model, reachable: true, modelPresent: true, ...health };
    },
  };
}

export function fakeChatModel(health: Partial<ProviderHealth> = {}): ChatModel {
  const model = health.model ?? 'fake-chat';
  return {
    model,
    async checkHealth() {
      return { provider: 'fake', model, reachable: true, modelPresent: true, ...health };
    },
  };
}

export function fakeVectorStore(reachable = true): VectorStore {
  return {
    async checkHealth() {
      return { provider: 'fake', reachable };
    },
  };
}
