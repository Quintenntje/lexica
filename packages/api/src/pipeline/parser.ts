import type { FileType } from '@lexica/shared';
import { extractText, getDocumentProxy } from 'unpdf';
import { DocumentRejectedError } from './errors';

/**
 * RAG stage 1 — PARSE.
 *
 * Turns an uploaded file into plain text. The output is a list of pages so that
 * page-aware formats (PDF) can keep page numbers all the way to the citation.
 * Markdown and plain text have no pages, so they become a single page with
 * `page: null`.
 *
 * Files that are empty, unreadable or contain no text are rejected with a
 * `DocumentRejectedError`, so the user gets a clear message instead of an
 * empty document in the list.
 */

export interface ParsedPage {
  /** 1-based page number, or null when the format has no pages. */
  page: number | null;
  text: string;
}

/** Extraction runs on the event loop, so absurdly long PDFs are refused up front. */
const MAX_PDF_PAGES = 500;

export async function parseDocument(data: Uint8Array, fileType: FileType): Promise<ParsedPage[]> {
  if (data.byteLength === 0) {
    throw new DocumentRejectedError('EMPTY_DOCUMENT', 'The file is empty.');
  }
  const pages = fileType === 'pdf' ? await parsePdf(data) : parseText(data);
  if (pages.every((p) => !p.text.trim())) {
    throw new DocumentRejectedError(
      'EMPTY_DOCUMENT',
      fileType === 'pdf'
        ? 'This PDF contains no extractable text. Scanned PDFs need OCR, which Lexica does not support.'
        : 'The file contains no text.',
    );
  }
  return pages;
}

function parseText(data: Uint8Array): ParsedPage[] {
  // TextDecoder drops a leading byte order mark. Windows line endings are
  // normalised so the chunker only has to deal with "\n".
  const text = new TextDecoder('utf-8').decode(data).replace(/\r\n?/g, '\n');
  return [{ page: null, text }];
}

/**
 * PDFs are parsed page by page (unpdf, a serverless build of Mozilla's PDF.js)
 * so every chunk can cite the page it starts on. Each visual line becomes its
 * own line of text, which is what the chunker's heading detection expects.
 */
async function parsePdf(data: Uint8Array): Promise<ParsedPage[]> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // PDF.js takes ownership of the buffer it is given, so hand it a copy.
    pdf = await getDocumentProxy(data.slice());
  } catch {
    throw new DocumentRejectedError(
      'UNPARSEABLE_FILE',
      'Could not read this PDF. The file may be damaged or not a real PDF.',
    );
  }
  try {
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new DocumentRejectedError(
        'UNPARSEABLE_FILE',
        `This PDF has ${pdf.numPages} pages; Lexica accepts at most ${MAX_PDF_PAGES}.`,
      );
    }
    const { text } = await extractText(pdf, { mergePages: false });
    return text.map((pageText, i) => ({ page: i + 1, text: pageText }));
  } finally {
    // Frees PDF.js resources (in PDF.js 6 `destroy` lives on the loading task, not the proxy).
    await pdf.loadingTask.destroy();
  }
}
