import type { FileType } from '@lexica/shared';

/**
 * RAG stage 1 — PARSE.
 *
 * Turns an uploaded file into plain text. The output is a list of pages so that
 * page-aware formats (PDF) can keep page numbers all the way to the citation.
 * Markdown and plain text have no pages, so they become a single page with
 * `page: null`.
 */

export interface ParsedPage {
  /** 1-based page number, or null when the format has no pages. */
  page: number | null;
  text: string;
}

export class UnsupportedFileTypeError extends Error {
  constructor(fileType: string) {
    super(`Files of type "${fileType}" cannot be parsed yet.`);
    this.name = 'UnsupportedFileTypeError';
  }
}

export async function parseDocument(data: Uint8Array, fileType: FileType): Promise<ParsedPage[]> {
  switch (fileType) {
    case 'md':
    case 'txt': {
      // Normalise Windows line endings so the chunker only has to deal with "\n".
      const text = new TextDecoder('utf-8').decode(data).replace(/\r\n?/g, '\n');
      return [{ page: null, text }];
    }
    default:
      // PDF parsing arrives with the upload ticket.
      throw new UnsupportedFileTypeError(fileType);
  }
}
