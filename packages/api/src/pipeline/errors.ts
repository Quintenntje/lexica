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
