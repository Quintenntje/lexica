import { describe, expect, it } from 'vitest';
import { chunkDocument } from '../src/pipeline/chunker';

/**
 * The one direct chunker test the spec allows: the exact text of every chunk
 * is hard to observe over HTTP, so this pins it down once. Everything else
 * about chunking is tested through upload and chat (indexing.test.ts).
 */
describe('chunkDocument', () => {
  it('splits a contract into one chunk per clause, with article/clause labels and the exact text', () => {
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

    expect(chunkDocument([{ page: null, text: contract }])).toEqual([
      {
        section: 'Preamble',
        context: [],
        page: null,
        text: 'Sample Services Agreement\n\nThis agreement is made between Acme Example Ltd and Example Client B.V.',
      },
      {
        section: 'Art. 1.1 — Services',
        context: ['Art. 1 — Definitions'],
        page: null,
        text: '1.1 **Services.** "Services" means the consulting services described in Schedule 1.',
      },
      {
        section: 'Art. 1.2 — Fees',
        context: ['Art. 1 — Definitions'],
        page: null,
        text: '1.2 **Fees.** "Fees" means the amounts payable\nfor the Services, excluding VAT.',
      },
      {
        section: 'Art. 2 — Liability',
        context: [],
        page: null,
        text: 'Article 2 — Liability\n\nThis article limits what either party can claim.',
      },
      // A clause without a bold title borrows the title of its article.
      {
        section: 'Art. 2.1 — Liability',
        context: ['Art. 2 — Liability'],
        page: null,
        text: '2.1 Neither party is liable for indirect loss.',
      },
      {
        section: 'Schedule 1',
        context: [],
        page: null,
        text: 'Schedule 1\n\nWeekly advisory sessions.',
      },
    ]);
  });
});
