import { describe, expect, it } from 'vitest';
import { listDocumentsResponseSchema } from '@lexica/shared';
import { createApp } from '../src/app';
import { indexDocument } from '../src/pipeline/indexer';
import { seedSampleContracts } from '../src/pipeline/seed';
import { fakeChatModel, fakeEmbedder, fakeVectorStore } from './fakes';

/**
 * The indexing pipeline is shared by the seed command and the upload endpoint.
 * These tests drive it with in-memory fakes and assert what it handed to the
 * vector store (the same way chat tests assert the prompt handed to the chat
 * model), plus what the documents endpoint then reports over HTTP.
 */

function setup() {
  const vectorStore = fakeVectorStore();
  const providers = { embedder: fakeEmbedder(), chatModel: fakeChatModel(), vectorStore };
  return { providers, vectorStore, app: createApp(providers) };
}

const encode = (text: string) => new TextEncoder().encode(text);

describe('indexing a Markdown contract', () => {
  const contract = [
    '# Sample Services Agreement',
    '',
    'This agreement is made between Acme Example Ltd and Example Client B.V.',
    '',
    '## Article 1 — Definitions',
    '',
    '1.1 **Services.** "Services" means the consulting services described in Schedule 1.',
    '',
    '1.2 **Fees.** "Fees" means the amounts payable',
    'for the Services, excluding VAT.',
    '',
    '## Article 2 — Liability',
    '',
    'This article limits what either party can claim.',
    '',
    '2.1 Neither party is liable for indirect loss.',
    '',
    '## Schedule 1',
    '',
    'Weekly advisory sessions.',
    '',
  ].join('\n');

  it('creates one chunk per clause, labelled with its article and clause number', async () => {
    const { providers, vectorStore } = setup();
    await indexDocument(providers, { name: 'services.md', fileType: 'md', data: encode(contract) });

    expect(vectorStore.chunks.map((c) => [c.section, c.text])).toEqual([
      [
        'Preamble',
        'Sample Services Agreement\n\nThis agreement is made between Acme Example Ltd and Example Client B.V.',
      ],
      [
        'Art. 1.1 — Services',
        '1.1 **Services.** "Services" means the consulting services described in Schedule 1.',
      ],
      [
        'Art. 1.2 — Fees',
        '1.2 **Fees.** "Fees" means the amounts payable\nfor the Services, excluding VAT.',
      ],
      [
        'Art. 2 — Liability',
        'Article 2 — Liability\n\nThis article limits what either party can claim.',
      ],
      // A clause without a bold title borrows the title of its article.
      ['Art. 2.1 — Liability', '2.1 Neither party is liable for indirect loss.'],
      ['Schedule 1', 'Schedule 1\n\nWeekly advisory sessions.'],
    ]);
  });

  it('stores the document metadata on every chunk', async () => {
    const { providers, vectorStore } = setup();
    const summary = await indexDocument(providers, {
      name: 'services.md',
      fileType: 'md',
      data: encode(contract),
    });

    expect(vectorStore.chunks).toHaveLength(6);
    vectorStore.chunks.forEach((chunk, index) => {
      expect(chunk).toMatchObject({
        documentId: summary.id,
        documentName: 'services.md',
        fileType: 'md',
        page: null,
        chunkIndex: index,
        createdAt: summary.createdAt,
      });
      expect(chunk.vector).toHaveLength(providers.embedder.dimensions);
    });
  });
});

describe('indexing a plain-text contract', () => {
  it('recognises upper-case article headings and numbered clauses', async () => {
    const { providers, vectorStore } = setup();
    const contract = [
      'CONSULTING AGREEMENT',
      '',
      'ARTICLE 3 - TERMINATION',
      '3.1 Either party may terminate on 30 days notice.',
      '3.2 Termination does not affect accrued rights.',
      '',
      'ARTICLE IV: GOVERNING LAW',
      'This agreement is governed by the laws of Ireland.',
    ].join('\r\n');

    await indexDocument(providers, {
      name: 'consulting.txt',
      fileType: 'txt',
      data: encode(contract),
    });

    expect(vectorStore.chunks.map((c) => [c.section, c.fileType])).toEqual([
      ['Preamble', 'txt'],
      ['Art. 3.1 — TERMINATION', 'txt'],
      ['Art. 3.2 — TERMINATION', 'txt'],
      ['Art. IV — GOVERNING LAW', 'txt'],
    ]);
    expect(vectorStore.chunks[1]!.text).toBe('3.1 Either party may terminate on 30 days notice.');
  });

  it('does not mistake a number at the start of a line for a clause of another article', async () => {
    const { providers, vectorStore } = setup();
    const contract = [
      'Article 4 — Fees',
      '4.1 The Customer pays a fixed fee of',
      '2.5 million euros per year.',
    ].join('\n');

    await indexDocument(providers, { name: 'fees.txt', fileType: 'txt', data: encode(contract) });

    expect(vectorStore.chunks.map((c) => c.section)).toEqual(['Art. 4.1 — Fees']);
    expect(vectorStore.chunks[0]!.text).toContain('2.5 million euros');
  });
});

describe('indexing a clause longer than the chunk size limit', () => {
  // 30 numbered sentences of ~95 characters: ~2,900 characters in one clause.
  const sentences = Array.from(
    { length: 30 },
    (_, i) =>
      `Sentence ${String(i + 1).padStart(2, '0')} sets out a further obligation of the supplier under this clause.`,
  );
  const contract = `## Article 5 — Obligations\n\n5.1 **Supplier duties.** ${sentences.join(' ')}\n\n5.2 **Customer duties.** The customer pays on time.\n`;

  it('splits it into several chunks that keep the clause label and stay within the limit', async () => {
    const { providers, vectorStore } = setup();
    await indexDocument(providers, { name: 'long.md', fileType: 'md', data: encode(contract) });

    const supplier = vectorStore.chunks.filter((c) => c.section === 'Art. 5.1 — Supplier duties');
    expect(supplier.length).toBeGreaterThanOrEqual(3);
    for (const chunk of supplier) expect(chunk.text.length).toBeLessThanOrEqual(1200);
    expect(vectorStore.chunks.map((c) => c.chunkIndex)).toEqual(
      vectorStore.chunks.map((_, i) => i),
    );
    expect(vectorStore.chunks.at(-1)!.section).toBe('Art. 5.2 — Customer duties');

    // Nothing is lost: every sentence appears whole in at least one chunk.
    for (const sentence of sentences) {
      expect(supplier.some((c) => c.text.includes(sentence))).toBe(true);
    }
  });

  it('repeats a small overlap between consecutive pieces', async () => {
    const { providers, vectorStore } = setup();
    await indexDocument(providers, { name: 'long.md', fileType: 'md', data: encode(contract) });

    const supplier = vectorStore.chunks.filter((c) => c.section === 'Art. 5.1 — Supplier duties');
    for (let i = 1; i < supplier.length; i++) {
      const previousEnd = supplier[i - 1]!.text.slice(-40);
      expect(supplier[i]!.text.slice(0, 200)).toContain(previousEnd);
    }
  });
});

describe('re-indexing a document with the same name', () => {
  it('replaces its chunks instead of duplicating them', async () => {
    const { providers, vectorStore, app } = setup();
    const v1 = '## Article 1 — Term\n\n1.1 One year.\n\n1.2 Renewal yearly.\n';
    const v2 = '## Article 1 — Term\n\n1.1 Two years.\n';

    await indexDocument(providers, { name: 'term.md', fileType: 'md', data: encode(v1) });
    await indexDocument(providers, { name: 'term.md', fileType: 'md', data: encode(v2) });

    expect(vectorStore.chunks.map((c) => c.text)).toEqual(['1.1 Two years.']);
    const res = await app.request('/api/documents');
    const { documents } = listDocumentsResponseSchema.parse(await res.json());
    expect(documents).toMatchObject([{ name: 'term.md', chunkCount: 1 }]);
  });
});

describe('seeding the sample contracts', () => {
  it('indexes the three fictional contracts along their clause structure', async () => {
    const { providers, vectorStore, app } = setup();

    await seedSampleContracts(providers);

    const res = await app.request('/api/documents');
    const { documents } = listDocumentsResponseSchema.parse(await res.json());
    expect(documents.map((d) => [d.name, d.fileType]).sort()).toEqual([
      ['employment-agreement-osterby-robotics.md', 'md'],
      ['mutual-nda-quillmere-tessellate.md', 'md'],
      ['saas-terms-larkspur-ledger.md', 'md'],
    ]);

    const ndaSections = vectorStore.chunks
      .filter((c) => c.documentName === 'mutual-nda-quillmere-tessellate.md')
      .map((c) => c.section);
    expect(ndaSections).toContain('Art. 5.2 — Termination for convenience');
    expect(ndaSections).toContain('Art. 9.1 — Governing law');
    expect(ndaSections[0]).toBe('Preamble');
  });

  it('can be run twice without duplicating documents', async () => {
    const { providers, vectorStore } = setup();
    await seedSampleContracts(providers);
    const count = vectorStore.chunks.length;
    await seedSampleContracts(providers);
    expect(vectorStore.chunks).toHaveLength(count);
  });
});
