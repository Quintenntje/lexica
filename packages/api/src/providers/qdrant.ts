import { randomUUID } from 'node:crypto';
import { QdrantClient } from '@qdrant/js-client-rest';
import { summarizeDocuments } from './summarize';
import type { ChunkPayload, VectorStore } from './types';

const HEALTH_TIMEOUT_MS = 2000;
const SCROLL_PAGE_SIZE = 256;

/**
 * RAG stage 4 — STORE (Qdrant implementation).
 *
 * All chunks live in one collection: one point per chunk, holding the chunk's
 * vector plus its text and citation metadata as payload. Cosine distance
 * matches how embedding models are trained to compare texts. `documentId` is
 * indexed so deleting or filtering one document's chunks stays fast.
 */
export function createQdrantVectorStore(options: {
  url: string;
  vectorSize: number;
  collection: string;
}): VectorStore {
  const client = new QdrantClient({ url: options.url, checkCompatibility: false });
  const { collection } = options;

  // Created once per process; a failed attempt (e.g. Qdrant not up yet) is retried on next use.
  let ready: Promise<void> | undefined;
  const ensureCollection = () => {
    ready ??= createCollectionIfMissing().catch((err: unknown) => {
      ready = undefined;
      throw err;
    });
    return ready;
  };

  async function createCollectionIfMissing() {
    const { exists } = await client.collectionExists(collection);
    if (exists) {
      const info = await client.getCollection(collection);
      const vectors = info.config.params.vectors;
      const size = vectors && 'size' in vectors ? vectors.size : undefined;
      if (size !== options.vectorSize) {
        throw new Error(
          `Qdrant collection "${collection}" has vector size ${String(size)}, but the embedder produces ${options.vectorSize}. ` +
            `Delete the collection (or change EMBEDDING_MODEL/EMBEDDING_DIMENSIONS) and seed again.`,
        );
      }
      return;
    }
    await client.createCollection(collection, {
      vectors: { size: options.vectorSize, distance: 'Cosine' },
    });
    await client.createPayloadIndex(collection, {
      field_name: 'documentId',
      field_schema: 'keyword',
      wait: true,
    });
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

    init: ensureCollection,

    async upsert(chunks) {
      if (chunks.length === 0) return;
      await ensureCollection();
      await client.upsert(collection, {
        wait: true, // return only once the points are searchable
        points: chunks.map(({ vector, ...payload }) => ({
          // Qdrant point ids must be UUIDs or integers; our own ids live in the payload.
          id: randomUUID(),
          vector,
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

    // RAG stage 5 — RETRIEVE: nearest neighbours of the question vector.
    async search(vector, { limit }) {
      await ensureCollection();
      const { points } = await client.query(collection, {
        query: vector,
        limit,
        with_payload: true,
      });
      return points.map((p) => ({
        ...(p.payload as unknown as ChunkPayload),
        id: String(p.id),
        score: p.score,
      }));
    },
  };
}
