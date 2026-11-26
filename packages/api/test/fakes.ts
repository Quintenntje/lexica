import { summarizeDocuments } from '../src/providers/summarize';
import type {
  ChatModel,
  ChunkRecord,
  Embedder,
  ProviderHealth,
  VectorStore,
} from '../src/providers/types';

/**
 * In-memory fakes for the provider interfaces. Tests inject these into the app
 * factory so the API can be exercised over HTTP without Docker, Qdrant or Ollama.
 */

const FAKE_DIMENSIONS = 64;

/**
 * Deterministic bag-of-words embedding: each word adds 1 to a bucket chosen by
 * hashing it, then the vector is normalised. Texts sharing words get similar vectors.
 */
function embedText(text: string): number[] {
  const vector = new Array<number>(FAKE_DIMENSIONS).fill(0);
  for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    let hash = 0;
    for (const char of word) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    vector[hash % FAKE_DIMENSIONS]! += 1;
  }
  const norm = Math.hypot(...vector) || 1;
  return vector.map((v) => v / norm);
}

export function fakeEmbedder(health: Partial<ProviderHealth> = {}): Embedder {
  const model = health.model ?? 'fake-embed';
  return {
    model,
    dimensions: FAKE_DIMENSIONS,
    async checkHealth() {
      return { provider: 'fake', model, reachable: true, modelPresent: true, ...health };
    },
    async embedDocuments(texts) {
      return texts.map(embedText);
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

/** Array-backed vector store. `chunks` exposes what the pipeline handed to the store. */
export interface FakeVectorStore extends VectorStore {
  readonly chunks: readonly ChunkRecord[];
}

export function fakeVectorStore(reachable = true): FakeVectorStore {
  let chunks: ChunkRecord[] = [];
  return {
    get chunks() {
      return chunks;
    },
    async checkHealth() {
      return { provider: 'fake', reachable };
    },
    async init() {},
    async upsert(records) {
      chunks = [...chunks, ...records];
    },
    async deleteDocument(documentId) {
      chunks = chunks.filter((c) => c.documentId !== documentId);
    },
    async listDocuments() {
      if (!reachable) throw new Error('fake vector store is unreachable');
      return summarizeDocuments(chunks);
    },
  };
}
