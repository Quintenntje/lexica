/**
 * The file itself is the problem (empty, unreadable, no text), as opposed to a
 * server or dependency failure. The upload route turns this into a 422 with a
 * message the user can act on.
 */
export class DocumentRejectedError extends Error {
  readonly code: 'EMPTY_DOCUMENT' | 'UNPARSEABLE_FILE';

  constructor(code: DocumentRejectedError['code'], message: string) {
    super(message);
    this.name = 'DocumentRejectedError';
    this.code = code;
  }
}

/**
 * A service the pipeline depends on (the embedding model or the vector store)
 * could not be reached or failed. The routes turn this into a 503 that says
 * which service to check, instead of a generic 500.
 */
export class ProviderUnavailableError extends Error {
  readonly code: 'EMBEDDER_UNAVAILABLE' | 'VECTOR_STORE_UNAVAILABLE';

  constructor(code: ProviderUnavailableError['code'], cause: unknown) {
    super(
      code === 'EMBEDDER_UNAVAILABLE'
        ? 'Could not reach the embedding model. Is Ollama running with the models pulled (npm run setup)?'
        : 'Could not reach the vector store. Is Qdrant running (npm run setup)?',
      { cause },
    );
    this.name = 'ProviderUnavailableError';
    this.code = code;
  }
}
