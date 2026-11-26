import type { ModelHealth } from '@lexica/shared';
import type { ChatModel, Embedder } from './types';

const HEALTH_TIMEOUT_MS = 2000;

/** Ollama names untagged models `<name>:latest`, so `nomic-embed-text` matches `nomic-embed-text:latest`. */
function sameModel(installed: string, wanted: string): boolean {
  const withTag = (name: string) => (name.includes(':') ? name : `${name}:latest`);
  return withTag(installed) === withTag(wanted);
}

/** Asks Ollama which models are pulled (`GET /api/tags`) and whether `model` is one of them. */
async function checkOllamaModel(baseUrl: string, model: string): Promise<ModelHealth> {
  const health = { provider: 'ollama', model, reachable: false, modelPresent: false };
  try {
    const res = await fetch(new URL('/api/tags', baseUrl), {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (!res.ok) return health;
    const { models = [] } = (await res.json()) as { models?: { name: string }[] };
    return {
      ...health,
      reachable: true,
      modelPresent: models.some((m) => sameModel(m.name, model)),
    };
  } catch {
    return health;
  }
}

/**
 * RAG stage 3 — EMBED (Ollama implementation).
 *
 * nomic-embed-text expects a task prefix: `search_document: ` for passages that
 * are stored and `search_query: ` for questions. Using matching prefixes puts
 * questions and the passages that answer them close together in vector space.
 */
export function createOllamaEmbedder(options: {
  baseUrl: string;
  model: string;
  dimensions: number;
}): Embedder {
  return {
    model: options.model,
    dimensions: options.dimensions,
    checkHealth: () => checkOllamaModel(options.baseUrl, options.model),
    async embedDocuments(texts) {
      const res = await fetch(new URL('/api/embed', options.baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: options.model,
          input: texts.map((t) => `search_document: ${t}`),
        }),
      });
      if (!res.ok) throw new Error(`Ollama embed failed (${res.status}): ${await res.text()}`);
      const { embeddings } = (await res.json()) as { embeddings: number[][] };
      if (
        embeddings.length !== texts.length ||
        embeddings.some((v) => v.length !== options.dimensions)
      ) {
        throw new Error(
          `Ollama returned unexpected embeddings: expected ${texts.length} vectors of ${options.dimensions} dimensions.`,
        );
      }
      return embeddings;
    },
  };
}

export function createOllamaChatModel(options: { baseUrl: string; model: string }): ChatModel {
  return {
    model: options.model,
    checkHealth: () => checkOllamaModel(options.baseUrl, options.model),
  };
}
