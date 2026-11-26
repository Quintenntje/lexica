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
  async function embed(input: string[]): Promise<number[][]> {
    const res = await fetch(new URL('/api/embed', options.baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: options.model, input }),
    });
    if (!res.ok) throw new Error(`Ollama embed failed (${res.status}): ${await res.text()}`);
    const { embeddings } = (await res.json()) as { embeddings: number[][] };
    if (
      embeddings.length !== input.length ||
      embeddings.some((v) => v.length !== options.dimensions)
    ) {
      throw new Error(
        `Ollama returned unexpected embeddings: expected ${input.length} vectors of ${options.dimensions} dimensions.`,
      );
    }
    return embeddings;
  }

  return {
    model: options.model,
    dimensions: options.dimensions,
    checkHealth: () => checkOllamaModel(options.baseUrl, options.model),
    embedDocuments: (texts) => embed(texts.map((t) => `search_document: ${t}`)),
    embedQuery: async (text) => (await embed([`search_query: ${text}`]))[0]!,
  };
}

/**
 * RAG stage 6 — GENERATE (Ollama implementation).
 *
 * `POST /api/chat` with `stream: true` answers with NDJSON: one JSON object per
 * line, each carrying the next few characters of the answer. They are yielded
 * as they arrive, so the browser sees the answer being written.
 */
export function createOllamaChatModel(options: { baseUrl: string; model: string }): ChatModel {
  return {
    model: options.model,
    checkHealth: () => checkOllamaModel(options.baseUrl, options.model),
    async *stream({ system, messages, signal }) {
      const res = await fetch(new URL('/api/chat', options.baseUrl), {
        method: 'POST',
        signal, // the stop button aborts the request, which stops generation in Ollama
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: options.model,
          stream: true,
          messages: [{ role: 'system', content: system }, ...messages],
          // Low temperature keeps answers close to the passages; the context
          // window must fit the passages plus the question (Ollama's default is smaller).
          options: { temperature: 0.1, num_ctx: 8192 },
        }),
      });
      if (!res.ok || !res.body) {
        throw new Error(`Ollama chat failed (${res.status}): ${await res.text()}`);
      }

      const decoder = new TextDecoder();
      let buffer = '';
      for await (const bytes of res.body) {
        buffer += decoder.decode(bytes, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          const part = JSON.parse(line) as {
            message?: { content?: string };
            done?: boolean;
            error?: string;
          };
          if (part.error) throw new Error(part.error);
          if (part.message?.content) yield part.message.content;
          if (part.done) return;
        }
      }
    },
  };
}
