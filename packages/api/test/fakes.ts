import { fuseRankings } from '../src/providers/fusion';
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

/** `reachable: false` makes every embedding request fail, as when Ollama is down. */
export function fakeEmbedder(health: Partial<ProviderHealth> = {}): Embedder {
  const model = health.model ?? 'fake-embed';
  const reachable = health.reachable ?? true;
  const embed = (text: string) => {
    if (!reachable) throw new Error('fake embedder is unreachable');
    return embedText(text);
  };
  return {
    model,
    dimensions: FAKE_DIMENSIONS,
    async checkHealth() {
      return { provider: 'fake', model, reachable: true, modelPresent: true, ...health };
    },
    async embedDocuments(texts) {
      return texts.map(embed);
    },
    async embedQuery(text) {
      return embed(text);
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

/** A few of the English stop words Qdrant's BM25 drops, so "the" or "is" alone is no keyword match. */
const STOP_WORDS = new Set(
  'a an and are as at be by can do does for from has have how i in is it its may my of on or that the this to under what when which who will with'.split(
    ' ',
  ),
);

/** Lowercased words; like Qdrant's BM25 tokenizer, clause numbers such as "7.2" stay one token. */
function keywords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+(?:\.[0-9]+)*/g) ?? []).filter(
    (word) => !STOP_WORDS.has(word),
  );
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

export interface FakeVectorStoreOptions {
  /** False: every call fails (except the health check, which reports it), as when Qdrant is down. */
  reachable?: boolean;
  /** Only keyword matching is switched off; retrieval then ranks by semantic similarity alone. */
  keywordSearch?: boolean;
}

/** Array-backed vector store; a test can replace any method (e.g. make `upsert` fail) on the returned object. */
export function fakeVectorStore({
  reachable = true,
  keywordSearch = true,
}: FakeVectorStoreOptions = {}): VectorStore {
  let chunks: ChunkRecord[] = [];
  const available = () => {
    if (!reachable) throw new Error('fake vector store is unreachable');
  };
  return {
    async checkHealth() {
      return { provider: 'fake', reachable };
    },
    async init() {
      available();
      return { rebuilt: false };
    },
    async upsert(records) {
      available();
      const ids = new Set(records.map((r) => r.id));
      chunks = [...chunks.filter((c) => !ids.has(c.id)), ...records];
    },
    async deleteDocument(documentId, { keep = [] } = {}) {
      available();
      chunks = chunks.filter((c) => c.documentId !== documentId || keep.includes(c.id));
    },
    async listDocuments() {
      available();
      return summarizeDocuments(chunks);
    },
    async search(vector, { limit, text }) {
      available();
      const similarity = new Map(chunks.map((c) => [c.id, cosine(vector, c.vector)]));
      const semantic = chunks
        .map((c) => c.id)
        .sort((a, b) => similarity.get(b)! - similarity.get(a)!)
        .slice(0, PREFETCH_LIMIT);
      const keywordScores = keywordSearch
        ? bm25(
            text,
            chunks.map((c) => c.keywordText),
          )
        : new Map<number, number>();
      const keyword = [...keywordScores.keys()]
        .sort((a, b) => keywordScores.get(b)! - keywordScores.get(a)!)
        .map((i) => chunks[i]!.id)
        .slice(0, PREFETCH_LIMIT);

      return fuseRankings([semantic, keyword])
        .slice(0, limit)
        .map((id, position) => {
          // A hit carries the payload, never the stored vector or keyword text.
          const payload: ChunkPayload & { id: string } & Partial<ChunkRecord> = {
            ...chunks.find((c) => c.id === id)!,
          };
          delete payload.vector;
          delete payload.keywordText;
          const keywordIndex = keyword.indexOf(id);
          return {
            ...payload,
            score: similarity.get(id)!,
            rank: position + 1,
            keywordRank: keywordIndex === -1 ? null : keywordIndex + 1,
          };
        });
    },
    async drop() {
      chunks = [];
    },
  };
}
