import { describe, expect, it } from 'vitest';
import { listDocumentsResponseSchema } from '@lexica/shared';
import { createApp } from '../src/app';
import { indexDocument } from '../src/pipeline/indexer';
import { fakeChatModel, fakeEmbedder, fakeVectorStore } from './fakes';

function setup() {
  const providers = {
    embedder: fakeEmbedder(),
    chatModel: fakeChatModel(),
    vectorStore: fakeVectorStore(),
  };
  return { providers, app: createApp(providers) };
}

const encode = (text: string) => new TextEncoder().encode(text);

/** A small contract: a preamble, then two articles with numbered, titled clauses. */
const SMALL_CONTRACT = `# Sample Services Agreement

This agreement is made between Acme Example Ltd and Example Client B.V.

## Article 1 — Definitions

1.1 **Services.** "Services" means the consulting services described in Schedule 1.

1.2 **Fees.** "Fees" means the amounts payable for the Services.

## Article 2 — Termination

2.1 **Termination for convenience.** Either party may terminate this agreement on thirty (30) days' written notice.
`;

async function listDocuments(app: ReturnType<typeof createApp>) {
  const res = await app.request('/api/documents');
  expect(res.status).toBe(200);
  return listDocumentsResponseSchema.parse(await res.json()).documents;
}

describe('GET /api/documents', () => {
  it('returns an empty list when nothing is indexed', async () => {
    const { app } = setup();
    expect(await listDocuments(app)).toEqual([]);
  });

  it('lists an indexed document with its name, file type, chunk count and date', async () => {
    const { app, providers } = setup();
    const before = Date.now();

    await indexDocument(providers, {
      name: 'services.md',
      fileType: 'md',
      data: encode(SMALL_CONTRACT),
    });

    const documents = await listDocuments(app);
    expect(documents).toEqual([
      {
        id: expect.any(String),
        name: 'services.md',
        fileType: 'md',
        chunkCount: 4,
        createdAt: expect.any(String),
      },
    ]);
    expect(Date.parse(documents[0]!.createdAt)).toBeGreaterThanOrEqual(before - 1000);
  });
});

describe('GET /api/documents when the vector store is down', () => {
  it('returns 503 with the shared error shape', async () => {
    const app = createApp({
      embedder: fakeEmbedder(),
      chatModel: fakeChatModel(),
      vectorStore: fakeVectorStore(false),
    });
    const res = await app.request('/api/documents');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: { code: 'VECTOR_STORE_UNAVAILABLE', message: expect.any(String) },
    });
  });
});
