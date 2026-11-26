import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SAMPLES_DIR } from '../src/pipeline/seed';
import { ask, listDocuments, sectionsFor, testApp, uploadDocument } from './http';

/**
 * How documents are split into passages, observed the way a user sees it: a
 * file is uploaded (`POST /api/documents`), and the passages a question
 * retrieves come back as the chat stream's `data-source` parts, each with its
 * citation label, page and text. (The exact chunk text is pinned down once in
 * chunker.test.ts.)
 */

describe('a plain-text contract', () => {
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

  it('is split along upper-case article headings and numbered clauses', async () => {
    const { app } = testApp();
    const summary = await uploadDocument(app, 'consulting.txt', contract);
    expect(summary.chunkCount).toBe(4);

    // With four passages stored, every question retrieves all of them.
    const { sources } = await ask(app, 'Can either party terminate the agreement?');

    expect(sources.map((s) => s.section).sort()).toEqual([
      'Art. 3.1 — TERMINATION',
      'Art. 3.2 — TERMINATION',
      'Art. IV — GOVERNING LAW',
      'Preamble',
    ]);
    expect(sources.find((s) => s.section === 'Art. 3.1 — TERMINATION')).toMatchObject({
      documentName: 'consulting.txt',
      page: null,
      text: '3.1 Either party may terminate on 30 days notice.',
    });
  });
});

describe('a number at the start of a line', () => {
  it('is not mistaken for a clause of another article', async () => {
    const { app } = testApp();
    const contract = [
      'Article 4 — Fees',
      '4.1 The Customer pays a fixed fee of',
      '2.5 million euros per year.',
    ].join('\n');

    const summary = await uploadDocument(app, 'fees.txt', contract);

    expect(summary.chunkCount).toBe(1);
    const { sources } = await ask(app, 'What fee does the customer pay per year?');
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ section: 'Art. 4.1 — Fees' });
    expect(sources[0]!.text).toContain('2.5 million euros per year.');
  });
});

describe('a clause longer than the chunk size limit', () => {
  // 30 numbered sentences of ~95 characters: ~2,900 characters in one clause.
  const sentences = Array.from(
    { length: 30 },
    (_, i) =>
      `Sentence ${String(i + 1).padStart(2, '0')} sets out a further obligation of the supplier under this clause.`,
  );
  const contract = `## Article 5 — Obligations\n\n5.1 **Supplier duties.** ${sentences.join(' ')}\n\n5.2 **Customer duties.** The customer pays on time.\n`;

  it('is split into overlapping passages that keep the clause label and stay within the limit', async () => {
    const { app } = testApp();
    const summary = await uploadDocument(app, 'long.md', contract);

    // At least three pieces of the supplier clause, plus the customer clause.
    expect(summary.chunkCount).toBeGreaterThanOrEqual(4);
    expect(summary.chunkCount).toBeLessThanOrEqual(5);
    const { sources } = await ask(
      app,
      'What obligations does the supplier have under this clause?',
    );
    expect(sources).toHaveLength(summary.chunkCount);

    const supplier = sources.filter((s) => s.section === 'Art. 5.1 — Supplier duties');
    expect(supplier).toHaveLength(summary.chunkCount - 1);
    for (const piece of supplier) expect(piece.text.length).toBeLessThanOrEqual(1200);
    // Nothing is lost: every sentence appears whole in at least one piece.
    for (const sentence of sentences) {
      expect(supplier.some((piece) => piece.text.includes(sentence))).toBe(true);
    }
    // Overlap: a sentence at the end of one piece is repeated at the start of the next,
    // so more sentences are found whole than there are distinct sentences.
    const whole = supplier.flatMap((piece) => sentences.filter((s) => piece.text.includes(s)));
    expect(whole.length).toBeGreaterThan(sentences.length);
  });
});

describe('a re-uploaded document', () => {
  it('replaces its passages instead of duplicating them', async () => {
    const { app } = testApp();
    await uploadDocument(
      app,
      'term.md',
      '## Article 1 — Term\n\n1.1 One year.\n\n1.2 Renewal yearly.\n',
    );
    await uploadDocument(app, 'term.md', '## Article 1 — Term\n\n1.1 Two years.\n');

    expect(await listDocuments(app)).toMatchObject([{ name: 'term.md', chunkCount: 1 }]);
    const { sources } = await ask(app, 'How long is the term?');
    expect(sources.map((s) => s.text)).toEqual(['1.1 Two years.']);
  });
});

describe('the sample contracts', () => {
  it('are indexed along their clause structure', async () => {
    const { app } = testApp();
    for (const name of [
      'employment-agreement-osterby-robotics.md',
      'mutual-nda-quillmere-tessellate.md',
      'saas-terms-larkspur-ledger.md',
    ]) {
      await uploadDocument(app, name, new Uint8Array(await readFile(join(SAMPLES_DIR, name))));
    }

    expect(await sectionsFor(app, 'Can the NDA be terminated for convenience?')).toContain(
      'Art. 5.2 — Termination for convenience',
    );
    const governingLaw = (await ask(app, 'Which governing law applies to the NDA?')).sources;
    expect(governingLaw).toContainEqual(
      expect.objectContaining({
        documentName: 'mutual-nda-quillmere-tessellate.md',
        section: 'Art. 9.1 — Governing law',
      }),
    );
  });
});
