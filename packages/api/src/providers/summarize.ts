import type { DocumentSummary } from '@lexica/shared';
import type { ChunkPayload } from './types';

type SummaryFields = Pick<ChunkPayload, 'documentId' | 'documentName' | 'fileType' | 'createdAt'>;

/**
 * Derives the document list from stored chunks: one entry per document id,
 * with the number of chunks counted. Newest documents first, then by name.
 */
export function summarizeDocuments(chunks: Iterable<SummaryFields>): DocumentSummary[] {
  const documents = new Map<string, DocumentSummary>();
  for (const chunk of chunks) {
    const existing = documents.get(chunk.documentId);
    if (existing) {
      existing.chunkCount += 1;
    } else {
      documents.set(chunk.documentId, {
        id: chunk.documentId,
        name: chunk.documentName,
        fileType: chunk.fileType,
        chunkCount: 1,
        createdAt: chunk.createdAt,
      });
    }
  }
  return [...documents.values()].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || a.name.localeCompare(b.name),
  );
}
