import { describe, expect, it } from 'vitest';
import { REFUSAL_SENTENCE, type Source } from '@lexica/shared';
import { fakeChatModel, fakeVectorStore } from './fakes';
import { ask, FAKE_MIN_RELEVANCE, testApp, uploadDocument } from './http';

/**
 * Most clauses talk about obligations, notices and payments in words a question
 * shares, so semantic similarity favours them. The clauses a lawyer asks for by
 * name ("force majeure", "7.2") share few other words with the question.
 */
const SUPPLY = `# Supply Agreement

## Article 2 — Delivery

2.1 **Delivery obligations.** The supplier must perform its delivery obligations under this agreement on time and the buyer must accept delivery.

2.2 **Late delivery.** If the supplier is late in performing its delivery obligations under this agreement, the buyer may claim a penalty for each week of delay.

## Article 3 — Payment

3.1 **Payment obligations.** The buyer must perform its payment obligations under this agreement within thirty days of each invoice.

3.2 **Late payment.** If the buyer is late in performing its payment obligations under this agreement, the supplier may charge interest.

## Article 5 — Performance

5.1 **Performance.** Each party must perform its obligations under this agreement with due care and in good faith.

5.2 **Suspension.** A party may suspend performing its obligations under this agreement while the other party is in breach.

5.3 **Waiver.** Failing to enforce an obligation under this agreement does not waive the right to enforce it later.

## Article 7 — Audit

7.1 **Records.** The supplier keeps accurate records of all deliveries.

7.2 **Audit rights.** Once a year the buyer may inspect those records at its own cost.

## Article 12 — Miscellaneous

12.1 **Excused events.** Neither side is liable for failures caused by force majeure, such as war, flood or epidemic.
`;

/**
 * An app with the supply agreement uploaded. `keywordSearch: false` gives the
 * same app with keyword matching switched off in the fake vector store, so a
 * test can show what semantic similarity alone would retrieve.
 */
async function setup({ keywordSearch = true } = {}) {
  const chatModel = fakeChatModel();
  const providers = testApp({ chatModel, vectorStore: fakeVectorStore({ keywordSearch }) });
  await uploadDocument(providers.app, 'supply.md', SUPPLY);
  return { ...providers, chatModel };
}

const sectionsOf = (sources: Source[]) => sources.map((s) => s.section);

describe('POST /api/chat with hybrid (semantic + keyword) retrieval', () => {
  const cases: [string, string, string][] = [
    [
      'an exact legal term',
      'What happens to obligations under this agreement during force majeure?',
      'Art. 12.1 — Excused events',
    ],
    [
      'a clause number',
      'Which obligations under this agreement does clause 7.2 give the buyer?',
      'Art. 7.2 — Audit rights',
    ],
  ];

  it.each(cases)(
    'retrieves the clause matching %s that semantic similarity alone ranks too low',
    async (_, question, section) => {
      const semanticOnly = await setup({ keywordSearch: false });
      const { app, chatModel } = await setup();

      // Premise: by semantic similarity alone the clause is not among the passages retrieved.
      expect(sectionsOf((await ask(semanticOnly.app, question)).sources)).not.toContain(section);

      const { sources } = await ask(app, question);

      expect(sectionsOf(sources)).toContain(section);
      const source = sources.find((s) => s.section === section)!;
      expect(chatModel.calls[0]!.system).toContain(`[${source.index}] supply.md — ${section}`);
    },
  );

  it('reports each source with its cosine similarity, not its fused rank score', async () => {
    const question = 'What happens to obligations under this agreement during force majeure?';
    const semanticOnly = await ask((await setup({ keywordSearch: false })).app, question);
    const hybrid = await ask((await setup()).app, question);

    // A passage scores the same whether it was found by meaning or by keyword.
    const cosine = new Map(semanticOnly.sources.map((s) => [s.section, s.score]));
    const shared = hybrid.sources.filter((s) => cosine.has(s.section));
    expect(shared.length).toBeGreaterThan(0);
    for (const s of shared) expect(s.score).toBeCloseTo(cosine.get(s.section)!, 10);
    // Fused order is not score order: a keyword hit can rank above a closer passage.
    const scores = hybrid.sources.map((s) => s.score);
    expect(scores).not.toEqual([...scores].sort((a, b) => b - a));
  });
});

describe('POST /api/chat relevance check with hybrid retrieval', () => {
  const keywordQuestions: [string, string, string][] = [
    ['an exact legal term', 'Who is liable during force majeure?', 'Art. 12.1 — Excused events'],
    ['a clause number', 'What is in Art. 7.2?', 'Art. 7.2 — Audit rights'],
  ];

  it.each(keywordQuestions)(
    'answers a question about %s whose clause is found by keyword, though no passage reaches the threshold',
    async (_, question, section) => {
      const { app, chatModel } = await setup();

      const { text, sources } = await ask(app, question);

      // Premise: semantic similarity alone would refuse (every score is below the threshold).
      for (const s of sources) expect(s.score).toBeLessThan(FAKE_MIN_RELEVANCE);
      expect(sources[0]!.section).toBe(section);
      expect(chatModel.calls).toHaveLength(1);
      expect(text).not.toBe(REFUSAL_SENTENCE);
    },
  );

  it('still refuses an off-topic question that matches no keyword', async () => {
    const { app, chatModel } = await setup();

    const { text } = await ask(app, 'Can I bring my dog to the office?');

    expect(text).toBe(REFUSAL_SENTENCE);
    expect(chatModel.calls).toHaveLength(0);
  });

  it('still refuses an off-topic question whose only keyword match is far from it in meaning', async () => {
    const { app, chatModel } = await setup();

    // "flood" matches clause 12.1 by keyword, but the question is about something else entirely.
    const { text, sources } = await ask(
      app,
      'Will the flood in Venice raise gondola prices for tourists this summer?',
    );

    expect(sectionsOf(sources)).toContain('Art. 12.1 — Excused events');
    expect(text).toBe(REFUSAL_SENTENCE);
    expect(chatModel.calls).toHaveLength(0);
  });
});
