import { describe, expect, it } from 'vitest';
import type { Source } from '@lexica/shared';
import { createApp } from '../src/app';
import { indexDocument } from '../src/pipeline/indexer';
import { fakeChatModel, fakeEmbedder, fakeVectorStore } from './fakes';

const encode = (text: string) => new TextEncoder().encode(text);

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

async function setup() {
  const providers = {
    embedder: fakeEmbedder(),
    chatModel: fakeChatModel(),
    vectorStore: fakeVectorStore(),
  };
  await indexDocument(providers, { name: 'supply.md', fileType: 'md', data: encode(SUPPLY) });
  return { ...providers, app: createApp(providers) };
}

async function ask(app: ReturnType<typeof createApp>, question: string): Promise<Source[]> {
  const res = await app.request('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: question }] }],
    }),
  });
  expect(res.status).toBe(200);
  // Each source part is one SSE event: `data: {"type":"data-source",...,"data":{...}}`.
  return (await res.text())
    .split('\n')
    .filter((line) => line.startsWith('data: {'))
    .map((line) => JSON.parse(line.slice('data: '.length)) as { type: string; data: Source })
    .filter((event) => event.type === 'data-source')
    .map((event) => event.data);
}

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
      const { app, embedder, vectorStore, chatModel } = await setup();

      // Premise: by semantic similarity alone the clause is not among the passages retrieved.
      const semanticOnly = await vectorStore.search(await embedder.embedQuery(question), {
        limit: 5,
      });
      expect(semanticOnly.map((hit) => hit.section)).not.toContain(section);

      const sources = await ask(app, question);

      expect(sources.map((s) => s.section)).toContain(section);
      const source = sources.find((s) => s.section === section)!;
      expect(chatModel.calls[0]!.system).toContain(`[${source.index}] supply.md — ${section}`);
    },
  );

  it('keeps reporting each source with its cosine similarity, not its fused rank score', async () => {
    const { app, embedder, vectorStore } = await setup();
    const question = 'What happens to obligations under this agreement during force majeure?';

    const sources = await ask(app, question);

    const cosine = new Map(
      (await vectorStore.search(await embedder.embedQuery(question), { limit: 100 })).map((hit) => [
        hit.id,
        hit.score,
      ]),
    );
    expect(sources.length).toBe(5);
    for (const source of sources) expect(source.score).toBeCloseTo(cosine.get(source.id)!, 10);
  });
});
