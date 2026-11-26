import { createHash } from 'node:crypto';
import type { DocumentSummary, FileType } from '@lexica/shared';
import type { ChunkRecord, Providers } from '../providers/types';
import { chunkDocument, type TextChunk } from './chunker';
import { parseDocument } from './parser';

/**
 * The indexing pipeline: PARSE → CHUNK → EMBED → STORE.
 *
 * Shared by the seed command and (later) the upload endpoint, so sample
 * contracts and uploaded files go through exactly the same steps.
 */

export interface IndexInput {
  /** File name, e.g. "mutual-nda.md". Re-indexing the same name replaces the earlier version. */
  name: string;
  fileType: FileType;
  data: Uint8Array;
}

/** Embedding requests are sent in batches to keep each Ollama call small. */
const EMBED_BATCH_SIZE = 32;

/**
 * The document id is derived from the name, so indexing a file with the same
 * name again maps to the same id and can replace the old chunks.
 */
export function documentIdFor(name: string): string {
  const hex = createHash('sha256').update(name).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * The text that is embedded for a chunk: the passage plus where it sits
 * (document, article, clause). A clause like "Either party may terminate on
 * 30 days' notice" says nothing about which contract it belongs to; adding the
 * headings lets a question such as "notice period in the NDA" match it.
 */
function embeddingText(documentName: string, chunk: TextChunk): string {
  return [documentName, ...chunk.context, chunk.section, '', chunk.text].join('\n');
}

export async function indexDocument(
  { embedder, vectorStore }: Providers,
  input: IndexInput,
): Promise<DocumentSummary> {
  // 1. PARSE: bytes → text, per page where the format has pages.
  const pages = await parseDocument(input.data, input.fileType);

  // 2. CHUNK: split along article/clause structure, then cap the size (see chunker.ts).
  const chunks = chunkDocument(pages);
  if (chunks.length === 0) throw new Error(`"${input.name}" contains no text to index.`);

  // 3. EMBED: one vector per chunk, batched.
  const vectors: number[][] = [];
  for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
    vectors.push(
      ...(await embedder.embedDocuments(batch.map((c) => embeddingText(input.name, c)))),
    );
  }

  // 4. STORE: replace any earlier version of this document, then upsert the new chunks.
  // Each chunk carries the metadata a citation needs (document, section, page).
  const documentId = documentIdFor(input.name);
  const createdAt = new Date().toISOString();
  const records: ChunkRecord[] = chunks.map((chunk, chunkIndex) => ({
    documentId,
    documentName: input.name,
    fileType: input.fileType,
    section: chunk.section,
    page: chunk.page,
    chunkIndex,
    text: chunk.text,
    createdAt,
    vector: vectors[chunkIndex]!,
  }));
  await vectorStore.deleteDocument(documentId);
  await vectorStore.upsert(records);

  return {
    id: documentId,
    name: input.name,
    fileType: input.fileType,
    chunkCount: records.length,
    createdAt,
  };
}
