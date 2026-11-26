import { summarizeDocuments } from '../src/providers/summarize';
import type {
  ChatInput,
  ChatModel,
  ChunkPayload,
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
    async embedQuery(text) {
      return embedText(text);
    },
  };
}

/** Scripted chat model. `calls` records every prompt it received, so tests can assert on it. */
export interface FakeChatModel extends ChatModel {
  readonly calls: readonly ChatInput[];
}

/** Replies with `reply`, one stream delta per element, whatever it is asked. */
export function fakeChatModel(
  health: Partial<ProviderHealth> = {},
  reply: string[] = ['According to ', 'the contract ', '[1].'],
): FakeChatModel {
  const model = health.model ?? 'fake-chat';
  const calls: ChatInput[] = [];
  return {
    model,
    calls,
    async checkHealth() {
      return { provider: 'fake', model, reachable: true, modelPresent: true, ...health };
    },
    async *stream(input) {
      calls.push(input);
      yield* reply;
    },
  };
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return dot / (Math.hypot(...a) * Math.hypot(...b) || 1);
}

/** Lowercased words; like Qdrant's BM25 tokenizer, clause numbers such as "7.2" stay one token. */
function keywords(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+(?:\.[0-9]+)*/g) ?? [];
}

/** BM25 score of every chunk for the query (k1 = 1.2, b = 0.75); chunks sharing no term are left out. */
function bm25(query: string, texts: string[]): Map<number, number> {
  const docs = texts.map(keywords);
  const avgLength = docs.reduce((sum, d) => sum + d.length, 0) / (docs.length || 1);
  const scores = new Map<number, number>();
  for (const term of new Set(keywords(query))) {
    const containing = docs.filter((d) => d.includes(term)).length;
    if (containing === 0) continue;
    const idf = Math.log(1 + (docs.length - containing + 0.5) / (containing + 0.5));
    docs.forEach((doc, i) => {
      const tf = doc.filter((t) => t === term).length;
      if (tf === 0) return;
      const weight = (tf * 2.2) / (tf + 1.2 * (0.25 + (0.75 * doc.length) / avgLength));
      scores.set(i, (scores.get(i) ?? 0) + idf * weight);
    });
  }
  return scores;
}

/** Candidates taken from each ranking before fusion, as the Qdrant store does. */
const PREFETCH_LIMIT = 20;

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
    async init() {
      return { rebuilt: false };
    },
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
    async search(vector, { limit, text }) {
      if (!reachable) throw new Error('fake vector store is unreachable');
      const similarity = chunks.map((c) => cosine(vector, c.vector));
      const byDistance = chunks.map((_, i) => i).sort((a, b) => similarity[b]! - similarity[a]!);
      let ranked = byDistance;
      if (text !== undefined) {
        // Reciprocal rank fusion like Qdrant's { fusion: 'rrf' }: sum of 1 / (k + rank) over both rankings.
        const keywordScores = bm25(
          text,
          chunks.map((c) => c.searchText),
        );
        const byKeyword = [...keywordScores.keys()].sort(
          (a, b) => keywordScores.get(b)! - keywordScores.get(a)!,
        );
        const fused = new Map<number, number>();
        for (const ranking of [byDistance, byKeyword]) {
          ranking.slice(0, PREFETCH_LIMIT).forEach((i, rank) => {
            fused.set(i, (fused.get(i) ?? 0) + 1 / (2 + rank));
          });
        }
        ranked = [...fused.keys()].sort((a, b) => fused.get(b)! - fused.get(a)!);
      }
      return ranked.slice(0, limit).map((i, position) => {
        const payload: ChunkPayload & Partial<ChunkRecord> = { ...chunks[i]! };
        delete payload.vector;
        delete payload.searchText;
        return {
          ...payload,
          id: `${payload.documentId}:${payload.chunkIndex}`,
          score: similarity[i]!,
          rank: position + 1,
        };
      });
    },
  };
}
