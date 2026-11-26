import { randomUUID } from 'node:crypto';
import { QdrantClient } from '@qdrant/js-client-rest';
import { summarizeDocuments } from './summarize';
import type { ChunkPayload, VectorStore } from './types';

const HEALTH_TIMEOUT_MS = 2000;
const SCROLL_PAGE_SIZE = 256;

/** Named vectors of each point: the dense embedding and the BM25 keyword vector. */
const DENSE = 'dense';
const KEYWORDS = 'bm25';
/** Candidates taken from each ranking (semantic, keyword) before they are fused. */
const PREFETCH_LIMIT = 20;

/**
 * Qdrant computes BM25 sparse vectors itself from text (English stemming and
 * stop words by default), at upsert and at query time alike.
 */
const bm25 = (text: string) => ({ text, model: 'qdrant/bm25' });

/**
 * RAG stage 4 — STORE (Qdrant implementation).
 *
 * All chunks live in one collection: one point per chunk, holding two vectors
 * plus the chunk's text and citation metadata as payload:
 * - `dense`: the embedding, compared by cosine distance (how embedding models
 *   are trained to compare texts); finds passages with a similar meaning.
 * - `bm25`: a sparse keyword vector with IDF weighting; finds passages that
 *   contain the exact words, such as "force majeure" or "7.2".
 * `documentId` is indexed so deleting or filtering one document's chunks stays fast.
 *
 * Collections from before hybrid search (one unnamed dense vector) cannot be
 * converted in place: `init({ rebuildIfOutdated: true })` (used by the seed
 * command) recreates them; otherwise using one is an error that says to reseed.
 */
export function createQdrantVectorStore(options: {
  url: string;
  vectorSize: number;
  collection: string;
}): VectorStore {
  const client = new QdrantClient({ url: options.url, checkCompatibility: false });
  const { collection } = options;

  // Prepared once per process; a failed attempt (e.g. Qdrant not up yet) is retried on next use.
  let ready: Promise<{ rebuilt: boolean }> | undefined;
  const ensureCollection = (rebuildIfOutdated = false) => {
    ready ??= prepareCollection(rebuildIfOutdated).catch((err: unknown) => {
      ready = undefined;
      throw err;
    });
    return ready;
  };

  async function prepareCollection(rebuildIfOutdated: boolean) {
    const { exists } = await client.collectionExists(collection);
    if (exists) {
      const problem = layoutProblem(await client.getCollection(collection));
      if (!problem) return { rebuilt: false };
      if (!rebuildIfOutdated) {
        throw new Error(
          `Qdrant collection "${collection}" ${problem}. Run \`npm run seed\` to rebuild it ` +
            `(this deletes the stored chunks: upload your own documents again afterwards).`,
        );
      }
      await client.deleteCollection(collection);
    }
    await client.createCollection(collection, {
      vectors: { [DENSE]: { size: options.vectorSize, distance: 'Cosine' } },
      sparse_vectors: { [KEYWORDS]: { modifier: 'idf' } }, // BM25 needs Qdrant to apply IDF
    });
    await client.createPayloadIndex(collection, {
      field_name: 'documentId',
      field_schema: 'keyword',
      wait: true,
    });
    return { rebuilt: exists };
  }

  /** Why an existing collection does not fit this store, or undefined if it does. */
  function layoutProblem(info: Awaited<ReturnType<typeof client.getCollection>>) {
    const { vectors, sparse_vectors } = info.config.params;
    const dense = vectors && !('size' in vectors) ? vectors[DENSE] : undefined;
    if (!dense || !sparse_vectors?.[KEYWORDS]) {
      return `uses an older layout without the "${DENSE}" and "${KEYWORDS}" vectors that hybrid search needs`;
    }
    if (dense.size !== options.vectorSize) {
      return `has vector size ${dense.size}, but the embedder produces ${options.vectorSize} (EMBEDDING_DIMENSIONS)`;
    }
    return undefined;
  }

  const byDocument = (documentId: string) => ({
    must: [{ key: 'documentId', match: { value: documentId } }],
  });

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

    init: (initOptions) => ensureCollection(initOptions?.rebuildIfOutdated),

    async upsert(chunks) {
      if (chunks.length === 0) return;
      await ensureCollection();
      await client.upsert(collection, {
        wait: true, // return only once the points are searchable
        points: chunks.map(({ vector, searchText, ...payload }) => ({
          // Qdrant point ids must be UUIDs or integers; our own ids live in the payload.
          id: randomUUID(),
          vector: { [DENSE]: vector, [KEYWORDS]: bm25(searchText) },
          payload: { ...payload },
        })),
      });
    },

    async deleteDocument(documentId) {
      await ensureCollection();
      await client.delete(collection, { wait: true, filter: byDocument(documentId) });
    },

    async listDocuments() {
      await ensureCollection();
      // Walk all points (payload only, no vectors) and group them by document.
      const payloads: ChunkPayload[] = [];
      let offset: string | number | undefined;
      do {
        const page = await client.scroll(collection, {
          limit: SCROLL_PAGE_SIZE,
          offset,
          with_vector: false,
          with_payload: ['documentId', 'documentName', 'fileType', 'createdAt'],
        });
        payloads.push(...page.points.map((p) => p.payload as unknown as ChunkPayload));
        const next = page.next_page_offset;
        offset = typeof next === 'string' || typeof next === 'number' ? next : undefined;
      } while (offset !== undefined);
      return summarizeDocuments(payloads);
    },

    // RAG stage 5 — RETRIEVE: semantic and keyword matches, fused by rank.
    async search(vector, { limit, text }) {
      await ensureCollection();
      if (text === undefined) {
        const { points } = await client.query(collection, {
          query: vector,
          using: DENSE,
          limit,
          with_payload: true,
        });
        return points.map((p, i) => ({
          ...(p.payload as unknown as ChunkPayload),
          id: String(p.id),
          score: p.score,
          rank: i + 1,
        }));
      }

      // Both rankings run inside Qdrant and are merged by reciprocal rank fusion:
      // a point scores 1 / (k + rank) in each ranking it appears in, summed.
      const prefetchLimit = Math.max(PREFETCH_LIMIT, limit);
      const { points } = await client.query(collection, {
        prefetch: [
          { query: vector, using: DENSE, limit: prefetchLimit },
          { query: bm25(text), using: KEYWORDS, limit: prefetchLimit },
        ],
        query: { fusion: 'rrf' },
        limit,
        with_payload: true,
      });
      if (points.length === 0) return [];

      // Fused scores only say how high a point ranked, not how relevant it is,
      // so look up each hit's cosine similarity: that stays the reported score.
      const ids = points.map((p) => p.id);
      const dense = await client.query(collection, {
        query: vector,
        using: DENSE,
        filter: { must: [{ has_id: ids }] },
        params: { exact: true }, // scores every listed point, none skipped by the index
        limit: ids.length,
        with_payload: false,
      });
      const cosine = new Map(dense.points.map((p) => [String(p.id), p.score]));
      return points.map((p, i) => ({
        ...(p.payload as unknown as ChunkPayload),
        id: String(p.id),
        score: cosine.get(String(p.id)) ?? 0,
        rank: i + 1,
      }));
    },
  };
}
