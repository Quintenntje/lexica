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

export function createOllamaEmbedder(options: { baseUrl: string; model: string }): Embedder {
  return {
    model: options.model,
    checkHealth: () => checkOllamaModel(options.baseUrl, options.model),
  };
}

export function createOllamaChatModel(options: { baseUrl: string; model: string }): ChatModel {
  return {
    model: options.model,
    checkHealth: () => checkOllamaModel(options.baseUrl, options.model),
  };
}
