import type { VectorStore } from './types';

const HEALTH_TIMEOUT_MS = 2000;

export function createQdrantVectorStore(options: { url: string }): VectorStore {
  return {
    async checkHealth() {
      try {
        // Qdrant's built-in health probe answers 200 when the server is up.
        const res = await fetch(new URL('/healthz', options.url), {
          signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
        });
        return { provider: 'qdrant', reachable: res.ok };
      } catch {
        return { provider: 'qdrant', reachable: false };
      }
    },
  };
}
