import { describe, expect, it } from 'vitest';
import { documentSummarySchema } from '@lexica/shared';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createApp, type App } from '../src/app';
import { fakeEmbedder, fakeVectorStore } from './fakes';
import { ask, FAKE_MIN_RELEVANCE, listDocuments, testApp, upload, uploadDocument } from './http';

/**
 * Uploading and deleting documents over HTTP. Every assertion goes through the
 * API: the status and body, the document list, and the passages a question
 * retrieves (the chat stream's `data-source` parts).
 */

/** Section, page and document of every passage a question retrieves (all of them for small documents). */
async function passages(app: App, question: string) {
  const { sources } = await ask(app, question);
  return sources.map((s) => [s.section, s.page, s.documentName]).sort();
}

/** Builds a PDF in memory: one entry per page, each a list of text lines. */
async function makePdf(pages: string[][]): Promise<Uint8Array<ArrayBuffer>> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = doc.addPage([595, 842]); // A4 in points
    lines.forEach((line, i) => page.drawText(line, { x: 50, y: 780 - i * 20, size: 12, font }));
  }
  return new Uint8Array(await doc.save());
}

const NDA_MD = `# Mutual NDA

## Article 1 — Definitions

1.1 **Confidential Information.** Any information disclosed by either party.

## Article 7 — Termination

7.2 **Termination for convenience.** Either party may terminate on thirty (30) days' notice.
`;

const TERM_V1 = '## Article 1 — Term\n\n1.1 One year.\n\n1.2 Renewal yearly.\n';
const TERM_V2 = '## Article 1 — Term\n\n1.1 Two years.\n';

describe('POST /api/documents with a Markdown file', () => {
  it('indexes it along its clauses and returns the document summary', async () => {
    const { app } = testApp();

    const res = await upload(app, new File([NDA_MD], 'nda.md', { type: 'text/markdown' }));

    expect(res.status).toBe(201);
    const summary = documentSummarySchema.parse(await res.json());
    expect(summary).toMatchObject({ name: 'nda.md', fileType: 'md', chunkCount: 3 });
    expect(await listDocuments(app)).toEqual([summary]);
    expect(await passages(app, 'Can either party terminate?')).toEqual([
      ['Art. 1.1 — Confidential Information', null, 'nda.md'],
      ['Art. 7.2 — Termination for convenience', null, 'nda.md'],
      ['Preamble', null, 'nda.md'],
    ]);
  });
});

describe('POST /api/documents with a PDF file', () => {
  it('keeps the page each clause starts on', async () => {
    const { app } = testApp();
    const pdf = await makePdf([
      [
        'MUTUAL NON-DISCLOSURE AGREEMENT',
        'Article 1 - Definitions',
        '1.1 "Confidential Information" means any information',
        'disclosed by either party.',
      ],
      [
        'Article 7 - Termination',
        '7.2 Either party may terminate this Agreement on',
        'thirty (30) days written notice.',
      ],
    ]);

    const res = await upload(app, new File([pdf], 'nda.pdf', { type: 'application/pdf' }));

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ name: 'nda.pdf', fileType: 'pdf', chunkCount: 3 });
    expect(await passages(app, 'How much notice is needed to terminate?')).toEqual([
      ['Art. 1.1 — Definitions', 1, 'nda.pdf'],
      ['Art. 7.2 — Termination', 2, 'nda.pdf'],
      ['Preamble', 1, 'nda.pdf'],
    ]);
    const { sources } = await ask(app, 'How much notice is needed to terminate?');
    expect(sources.find((s) => s.page === 2)!.text).toContain('thirty (30) days written notice.');
  });
});

describe('POST /api/documents with a plain-text file', () => {
  it('indexes it along its clauses', async () => {
    const { app } = testApp();
    const text = [
      'CONSULTING AGREEMENT',
      '',
      'ARTICLE 3 - TERMINATION',
      '3.1 Either party may terminate on 30 days notice.',
    ].join('\r\n');

    const res = await upload(app, new File([text], 'consulting.txt'));

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ name: 'consulting.txt', fileType: 'txt' });
    expect(await passages(app, 'Can either party terminate?')).toEqual([
      ['Art. 3.1 — TERMINATION', null, 'consulting.txt'],
      ['Preamble', null, 'consulting.txt'],
    ]);
  });
});

describe('POST /api/documents rejects', () => {
  async function expectRejected(res: Response, status: number, code: string) {
    expect(res.status).toBe(status);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body).toEqual({ error: { code, message: expect.any(String) } });
    expect(body.error.message.length).toBeGreaterThan(10);
    return body.error.message;
  }

  it('an unsupported file type', async () => {
    const { app } = testApp();
    const res = await upload(app, new File(['<w:document/>'], 'contract.docx'));
    const message = await expectRejected(res, 415, 'UNSUPPORTED_FILE_TYPE');
    expect(message).toContain('.pdf');
    expect(await listDocuments(app)).toEqual([]);
  });

  it('a request without a file', async () => {
    const { app } = testApp();
    const form = new FormData();
    form.append('file', 'just a string');
    const res = await app.request('/api/documents', { method: 'POST', body: form });
    await expectRejected(res, 400, 'VALIDATION_ERROR');
  });

  it('a request that is not multipart form data', async () => {
    const { app } = testApp();
    const res = await app.request('/api/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: 'nda.md' }),
    });
    await expectRejected(res, 400, 'VALIDATION_ERROR');
  });

  it('an empty file', async () => {
    const { app } = testApp();
    await expectRejected(await upload(app, new File([], 'empty.md')), 422, 'EMPTY_DOCUMENT');
  });

  it('a text file with only whitespace', async () => {
    const { app } = testApp();
    const res = await upload(app, new File(['  \n\n\t\n'], 'blank.txt'));
    await expectRejected(res, 422, 'EMPTY_DOCUMENT');
  });

  it('an empty PDF file', async () => {
    const { app } = testApp();
    await expectRejected(await upload(app, new File([], 'empty.pdf')), 422, 'EMPTY_DOCUMENT');
  });

  it('a file with a .pdf extension that is not a PDF', async () => {
    const { app } = testApp();
    const res = await upload(app, new File(['not a pdf'], 'fake.pdf'));
    await expectRejected(res, 422, 'UNPARSEABLE_FILE');
    expect(await listDocuments(app)).toEqual([]);
  });

  it('a PDF without extractable text (e.g. a scan)', async () => {
    const { app } = testApp();
    const res = await upload(app, new File([await makePdf([[], []])], 'scan.pdf'));
    const message = await expectRejected(res, 422, 'EMPTY_DOCUMENT');
    expect(message).toMatch(/scanned/i);
  });

  it('a file larger than 20 MB', async () => {
    const { app } = testApp();
    const big = new File([new Uint8Array(20 * 1024 * 1024 + 1).fill(65)], 'huge.txt');
    await expectRejected(await upload(app, big), 413, 'FILE_TOO_LARGE');
  });
});

describe('POST /api/documents file types', () => {
  it('are recognised by extension in any case', async () => {
    const { app } = testApp();
    const res = await upload(app, new File([NDA_MD], 'NDA.MD'));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ name: 'NDA.MD', fileType: 'md' });
  });
});

describe('POST /api/documents when a service is down', () => {
  it('returns 503 naming the embedding model when Ollama is unreachable', async () => {
    const { app } = testApp({ embedder: fakeEmbedder({ reachable: false }) });

    const res = await upload(app, new File([NDA_MD], 'nda.md'));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: { code: 'EMBEDDER_UNAVAILABLE', message: expect.stringMatching(/Ollama/) },
    });
  });

  it('returns 503 naming the vector store when Qdrant is unreachable', async () => {
    const { app } = testApp({ vectorStore: fakeVectorStore({ reachable: false }) });

    const res = await upload(app, new File([NDA_MD], 'nda.md'));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: { code: 'VECTOR_STORE_UNAVAILABLE', message: expect.stringMatching(/Qdrant/) },
    });
  });
});

describe('re-uploading a document with the same name', () => {
  it('replaces its chunks instead of duplicating the document', async () => {
    const { app } = testApp();

    const first = await uploadDocument(app, 'term.md', TERM_V1);
    const res = await upload(app, new File([TERM_V2], 'term.md'));

    expect(res.status).toBe(201);
    const second = documentSummarySchema.parse(await res.json());
    expect(second).toMatchObject({ id: first.id, chunkCount: 1 });
    expect(await listDocuments(app)).toEqual([second]);
    const { sources } = await ask(app, 'How long is the term?');
    expect(sources.map((s) => s.text)).toEqual(['1.1 Two years.']);
  });

  it('keeps the earlier version when storing the new one fails', async () => {
    const { app, embedder, chatModel, vectorStore } = testApp();
    const first = await uploadDocument(app, 'term.md', TERM_V1);
    // The same stored data, but every write fails, as when Qdrant goes down mid-upload.
    const failingWrites = createApp(
      {
        embedder,
        chatModel,
        vectorStore: { ...vectorStore, upsert: () => Promise.reject(new Error('Qdrant down')) },
      },
      { minRelevanceScore: FAKE_MIN_RELEVANCE },
    );

    const res = await upload(failingWrites, new File([TERM_V2], 'term.md'));

    expect(res.status).toBe(503);
    expect(await listDocuments(app)).toEqual([first]);
    const { sources } = await ask(app, 'How long is the term?');
    expect(sources.map((s) => s.text).sort()).toEqual(['1.1 One year.', '1.2 Renewal yearly.']);
  });

  it('leaves other documents untouched', async () => {
    const { app } = testApp();
    await uploadDocument(app, 'nda.md', NDA_MD);
    await uploadDocument(app, 'term.md', TERM_V1);
    await uploadDocument(app, 'term.md', TERM_V2);

    const documents = await listDocuments(app);
    expect(documents.map((d) => [d.name, d.chunkCount]).sort()).toEqual([
      ['nda.md', 3],
      ['term.md', 1],
    ]);
  });
});

describe('DELETE /api/documents/:id', () => {
  it('removes the document from the list and from retrieval, leaving others in place', async () => {
    const { app } = testApp();
    const nda = await uploadDocument(app, 'nda.md', NDA_MD);
    await uploadDocument(app, 'term.md', TERM_V2);
    const question = 'Can either party terminate for convenience?';
    expect((await ask(app, question)).sources.map((s) => s.documentName)).toContain('nda.md');

    const res = await app.request(`/api/documents/${nda.id}`, { method: 'DELETE' });

    expect(res.status).toBe(204);
    expect((await listDocuments(app)).map((d) => d.name)).toEqual(['term.md']);
    // Nothing of the deleted document is left for retrieval to find.
    const { sources } = await ask(app, question);
    expect(sources.map((s) => s.documentName)).toEqual(['term.md']);
  });

  it('returns 404 in the shared error shape for an unknown document', async () => {
    const { app } = testApp();
    const res = await app.request('/api/documents/00000000-0000-0000-0000-000000000000', {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: 'DOCUMENT_NOT_FOUND', message: expect.any(String) },
    });
  });
});
