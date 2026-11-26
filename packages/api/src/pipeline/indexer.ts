import { createHash, randomUUID } from 'node:crypto';
import type { DocumentSummary, FileType } from '@lexica/shared';
import { summarizeDocuments } from '../providers/summarize';
import type { ChunkRecord, Providers } from '../providers/types';
import { chunkDocument, type TextChunk } from './chunker';
import { DocumentRejectedError, ProviderUnavailableError } from './errors';
import { parseDocument } from './parser';

/**
 * The indexing pipeline: PARSE → CHUNK → EMBED → STORE.
 *
 * Shared by the seed command and the upload endpoint, so sample
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
 * The text a chunk is found by with keyword (BM25) search: the passage plus
 * where it sits (article, clause), so "Art. 7.2" or "Governing law" match.
 */
function keywordText(chunk: TextChunk): string {
  return [...chunk.context, chunk.section, '', chunk.text].join('\n');
}

/**
 * The text that is embedded for semantic search: the keyword text plus the
 * document name. A clause like "Either party may terminate on 30 days' notice"
 * says nothing about which contract it belongs to; the name lets a question
 * such as "notice period in the NDA" land near it. (It stays out of the
 * keyword text, where it would match every chunk of the document equally.)
 */
function embeddingText(documentName: string, chunk: TextChunk): string {
  return `${documentName}\n${keywordText(chunk)}`;
}

export async function indexDocument(
  { embedder, vectorStore }: Providers,
  input: IndexInput,
): Promise<DocumentSummary> {
  // 1. PARSE: bytes → text, per page where the format has pages.
  const pages = await parseDocument(input.data, input.fileType);

  // 2. CHUNK: split along article/clause structure, then cap the size (see chunker.ts).
  const chunks = chunkDocument(pages);
  if (chunks.length === 0) {
    throw new DocumentRejectedError('EMPTY_DOCUMENT', `"${input.name}" contains no text to index.`);
  }

  // 3. EMBED: one vector per chunk, batched.
  const texts = chunks.map((chunk) => embeddingText(input.name, chunk));
  const vectors: number[][] = [];
  try {
    for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
      vectors.push(...(await embedder.embedDocuments(texts.slice(i, i + EMBED_BATCH_SIZE))));
    }
  } catch (err) {
    throw new ProviderUnavailableError('EMBEDDER_UNAVAILABLE', err);
  }

  // 4. STORE: each chunk carries the metadata a citation needs (document, section, page).
  const documentId = documentIdFor(input.name);
  const createdAt = new Date().toISOString();
  const records: ChunkRecord[] = chunks.map((chunk, chunkIndex) => ({
    id: randomUUID(),
    documentId,
    documentName: input.name,
    fileType: input.fileType,
    section: chunk.section,
    page: chunk.page,
    chunkIndex,
    text: chunk.text,
    createdAt,
    vector: vectors[chunkIndex]!,
    keywordText: keywordText(chunk),
  }));
  try {
    // The new version is stored before the earlier one is removed, so a failed
    // upsert leaves the earlier version in place instead of losing the document.
    // (If only the removal fails, both versions remain until the next upload.)
    await vectorStore.upsert(records);
    await vectorStore.deleteDocument(documentId, { keep: records.map((r) => r.id) });
  } catch (err) {
    throw new ProviderUnavailableError('VECTOR_STORE_UNAVAILABLE', err);
  }

  return summarizeDocuments(records)[0]!;
}
