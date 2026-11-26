import { describe, expect, it } from 'vitest';
import { documentSummarySchema, listDocumentsResponseSchema } from '@lexica/shared';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createApp } from '../src/app';
import { fakeChatModel, fakeEmbedder, fakeVectorStore } from './fakes';

/**
 * Uploading and deleting documents over HTTP. Every assertion goes through the
 * API (status, body, the document list) or what the pipeline handed to the
 * fake vector store, never through internal functions.
 */

function setup() {
  const vectorStore = fakeVectorStore();
  const providers = { embedder: fakeEmbedder(), chatModel: fakeChatModel(), vectorStore };
  return { vectorStore, app: createApp(providers) };
}

type App = ReturnType<typeof createApp>;

function upload(app: App, file: File) {
  const form = new FormData();
  form.append('file', file);
  return app.request('/api/documents', { method: 'POST', body: form });
}

async function listDocuments(app: App) {
  const res = await app.request('/api/documents');
  expect(res.status).toBe(200);
  return listDocumentsResponseSchema.parse(await res.json()).documents;
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

describe('POST /api/documents with a Markdown file', () => {
  it('indexes it along its clauses and returns the document summary', async () => {
    const { app, vectorStore } = setup();

    const res = await upload(app, new File([NDA_MD], 'nda.md', { type: 'text/markdown' }));

    expect(res.status).toBe(201);
    const summary = documentSummarySchema.parse(await res.json());
    expect(summary).toMatchObject({ name: 'nda.md', fileType: 'md', chunkCount: 3 });
    expect(vectorStore.chunks.map((c) => [c.section, c.page])).toEqual([
      ['Preamble', null],
      ['Art. 1.1 — Confidential Information', null],
      ['Art. 7.2 — Termination for convenience', null],
    ]);
    expect(await listDocuments(app)).toEqual([summary]);
  });
});

describe('POST /api/documents with a PDF file', () => {
  it('keeps the page each clause starts on', async () => {
    const { app, vectorStore } = setup();
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
    expect(vectorStore.chunks.map((c) => [c.section, c.page, c.fileType])).toEqual([
      ['Preamble', 1, 'pdf'],
      ['Art. 1.1 — Definitions', 1, 'pdf'],
      ['Art. 7.2 — Termination', 2, 'pdf'],
    ]);
    expect(vectorStore.chunks[2]!.text).toContain('thirty (30) days written notice.');
  });
});

describe('POST /api/documents with a plain-text file', () => {
  it('indexes it along its clauses', async () => {
    const { app, vectorStore } = setup();
    const text = [
      'CONSULTING AGREEMENT',
      '',
      'ARTICLE 3 - TERMINATION',
      '3.1 Either party may terminate on 30 days notice.',
    ].join('\r\n');

    const res = await upload(app, new File([text], 'consulting.txt'));

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ name: 'consulting.txt', fileType: 'txt' });
    expect(vectorStore.chunks.map((c) => [c.section, c.page, c.fileType])).toEqual([
      ['Preamble', null, 'txt'],
      ['Art. 3.1 — TERMINATION', null, 'txt'],
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
    const { app, vectorStore } = setup();
    const res = await upload(app, new File(['<w:document/>'], 'contract.docx'));
    const message = await expectRejected(res, 415, 'UNSUPPORTED_FILE_TYPE');
    expect(message).toContain('.pdf');
    expect(vectorStore.chunks).toEqual([]);
  });

  it('a request without a file', async () => {
    const { app } = setup();
    const form = new FormData();
    form.append('file', 'just a string');
    const res = await app.request('/api/documents', { method: 'POST', body: form });
    await expectRejected(res, 400, 'VALIDATION_ERROR');
  });

  it('a request that is not multipart form data', async () => {
    const { app } = setup();
    const res = await app.request('/api/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: 'nda.md' }),
    });
    await expectRejected(res, 400, 'VALIDATION_ERROR');
  });

  it('an empty file', async () => {
    const { app } = setup();
    await expectRejected(await upload(app, new File([], 'empty.md')), 422, 'EMPTY_DOCUMENT');
  });

  it('a text file with only whitespace', async () => {
    const { app } = setup();
    const res = await upload(app, new File(['  \n\n\t\n'], 'blank.txt'));
    await expectRejected(res, 422, 'EMPTY_DOCUMENT');
  });

  it('an empty PDF file', async () => {
    const { app } = setup();
    await expectRejected(await upload(app, new File([], 'empty.pdf')), 422, 'EMPTY_DOCUMENT');
  });

  it('a file with a .pdf extension that is not a PDF', async () => {
    const { app, vectorStore } = setup();
    const res = await upload(app, new File(['not a pdf'], 'fake.pdf'));
    await expectRejected(res, 422, 'UNPARSEABLE_FILE');
    expect(vectorStore.chunks).toEqual([]);
  });

  it('a PDF without extractable text (e.g. a scan)', async () => {
    const { app } = setup();
    const res = await upload(app, new File([await makePdf([[], []])], 'scan.pdf'));
    const message = await expectRejected(res, 422, 'EMPTY_DOCUMENT');
    expect(message).toMatch(/scanned/i);
  });

  it('a file larger than 20 MB', async () => {
    const { app } = setup();
    const big = new File([new Uint8Array(20 * 1024 * 1024 + 1).fill(65)], 'huge.txt');
    await expectRejected(await upload(app, big), 413, 'FILE_TOO_LARGE');
  });
});

describe('re-uploading a document with the same name', () => {
  it('replaces its chunks instead of duplicating the document', async () => {
    const { app, vectorStore } = setup();
    const v1 = '## Article 1 — Term\n\n1.1 One year.\n\n1.2 Renewal yearly.\n';
    const v2 = '## Article 1 — Term\n\n1.1 Two years.\n';

    const first = documentSummarySchema.parse(
      await (await upload(app, new File([v1], 'term.md'))).json(),
    );
    const res = await upload(app, new File([v2], 'term.md'));

    expect(res.status).toBe(201);
    const second = documentSummarySchema.parse(await res.json());
    expect(second).toMatchObject({ id: first.id, chunkCount: 1 });
    expect(await listDocuments(app)).toEqual([second]);
    expect(vectorStore.chunks.map((c) => c.text)).toEqual(['1.1 Two years.']);
  });

  it('leaves other documents untouched', async () => {
    const { app } = setup();
    await upload(app, new File([NDA_MD], 'nda.md'));
    await upload(app, new File(['## Article 1 — Term\n\n1.1 One year.\n'], 'term.md'));
    await upload(app, new File(['## Article 1 — Term\n\n1.1 Two years.\n'], 'term.md'));

    const documents = await listDocuments(app);
    expect(documents.map((d) => [d.name, d.chunkCount]).sort()).toEqual([
      ['nda.md', 3],
      ['term.md', 1],
    ]);
  });
});

describe('DELETE /api/documents/:id', () => {
  it('removes the document and all of its chunks, leaving others in place', async () => {
    const { app, vectorStore } = setup();
    const nda = documentSummarySchema.parse(
      await (await upload(app, new File([NDA_MD], 'nda.md'))).json(),
    );
    await upload(app, new File(['## Article 1 — Term\n\n1.1 One year.\n'], 'term.md'));

    const res = await app.request(`/api/documents/${nda.id}`, { method: 'DELETE' });

    expect(res.status).toBe(204);
    expect((await listDocuments(app)).map((d) => d.name)).toEqual(['term.md']);
    // Nothing of the deleted document is left for retrieval to find.
    expect(vectorStore.chunks.filter((c) => c.documentName === 'nda.md')).toEqual([]);
    expect(vectorStore.chunks.length).toBeGreaterThan(0);
  });

  it('returns 404 in the shared error shape for an unknown document', async () => {
    const { app } = setup();
    const res = await app.request('/api/documents/00000000-0000-0000-0000-000000000000', {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: 'DOCUMENT_NOT_FOUND', message: expect.any(String) },
    });
  });
});
