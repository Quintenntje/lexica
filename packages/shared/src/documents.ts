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

/** The file type of a file name, from its extension (any case), or undefined if Lexica cannot index it. */
export function fileTypeFromName(name: string): FileType | undefined {
  const dot = name.lastIndexOf('.');
  const result = fileTypeSchema.safeParse(dot === -1 ? '' : name.slice(dot + 1).toLowerCase());
  return result.success ? result.data : undefined;
}
export type DocumentSummary = z.infer<typeof documentSummarySchema>;
export type ListDocumentsResponse = z.infer<typeof listDocumentsResponseSchema>;

/** Largest file `POST /api/documents` accepts (20 MB). */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** Extensions the upload endpoint accepts, as used in a file input's `accept` attribute. */
export const UPLOAD_ACCEPT = '.pdf,.md,.txt';
