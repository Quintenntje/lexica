import { z } from 'zod';

/** File types Lexica can index. */
export const fileTypeSchema = z.enum(['pdf', 'md', 'txt']);

/**
 * One indexed document, as listed on the Documents page. There is no separate
 * documents table: the API derives this summary from the chunks in the vector store.
 */
export const documentSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  fileType: fileTypeSchema,
  /** Number of chunks (passages) the document was split into. */
  chunkCount: z.number().int().nonnegative(),
  /** ISO 8601 timestamp of when the document was indexed. */
  createdAt: z.iso.datetime(),
});

/** Response of `GET /api/documents`. */
export const listDocumentsResponseSchema = z.object({
  documents: z.array(documentSummarySchema),
});

export type FileType = z.infer<typeof fileTypeSchema>;
export type DocumentSummary = z.infer<typeof documentSummarySchema>;
export type ListDocumentsResponse = z.infer<typeof listDocumentsResponseSchema>;
