import { z } from 'zod';

/** Every error code the API sends. The web app can switch on these. */
export const apiErrorCodeSchema = z.enum([
  /** The request is malformed (bad JSON, missing file, empty question). */
  'VALIDATION_ERROR',
  /** No route matches the path. */
  'NOT_FOUND',
  /** An unexpected server error. */
  'INTERNAL_ERROR',
  'FILE_TOO_LARGE',
  'UNSUPPORTED_FILE_TYPE',
  /** The file holds no text to index (empty, whitespace only, a scanned PDF). */
  'EMPTY_DOCUMENT',
  /** The file cannot be read (e.g. a damaged PDF). */
  'UNPARSEABLE_FILE',
  'DOCUMENT_NOT_FOUND',
  /** Qdrant cannot be reached. */
  'VECTOR_STORE_UNAVAILABLE',
  /** Ollama's embedding model cannot be reached. */
  'EMBEDDER_UNAVAILABLE',
  /** A question could not be searched: Qdrant or Ollama is down. */
  'RETRIEVAL_UNAVAILABLE',
]);

/** Every API error uses this one JSON shape, so the web app can handle them uniformly. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string(),
  }),
});

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
