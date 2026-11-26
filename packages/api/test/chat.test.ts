import { describe, expect, it } from 'vitest';
import { REFUSAL_SENTENCE } from '@lexica/shared';
import { createApp } from '../src/app';
import { fakeChatModel, fakeEmbedder, fakeVectorStore } from './fakes';
import {
  FAKE_MIN_RELEVANCE,
  postChat,
  readAnswer,
  testApp,
  uploadDocument,
  userMessage,
} from './http';

const NDA = `# Mutual NDA

This agreement is made between Example Alpha Ltd and Example Beta B.V.

## Article 3 — Confidentiality

3.1 **Duration.** The confidentiality obligations survive for five (5) years after termination.

## Article 5 — Termination

5.1 **Notice period.** Either party may terminate this agreement on thirty (30) days' written notice.

## Article 9 — Governing law

9.1 **Governing law.** This agreement is governed by the laws of the Netherlands.
`;

const EMPLOYMENT = `# Employment Agreement

## Article 4 — Intellectual property

4.1 **Ownership.** All inventions created by the employee during employment belong to the employer.

## Article 6 — Salary

6.1 **Salary.** The employee receives a gross monthly salary paid on the last working day.
`;

async function setup(reply?: string[]) {
  const chatModel = fakeChatModel({}, reply);
  const providers = testApp({ chatModel });
  await uploadDocument(providers.app, 'nda.md', NDA);
  await uploadDocument(providers.app, 'employment.md', EMPLOYMENT);
  return { ...providers, chatModel };
}

describe('POST /api/chat', () => {
  it('streams the answer as a UI message stream', async () => {
    const { app } = await setup(['The notice ', 'period is ', '30 days [1].']);

    const res = await postChat(app, { messages: [userMessage('What is the notice period?')] });

    expect(res.status).toBe(200);
    expect(res.headers.get('x-vercel-ai-ui-message-stream')).toBe('v1');
    const raw = await res.clone().text();
    expect(raw.match(/"type":"text-delta"/g)?.length).toBeGreaterThanOrEqual(3);
    expect((await readAnswer(res)).text).toBe('The notice period is 30 days [1].');
  });

  it('gives the chat model numbered context passages with the most relevant chunk first', async () => {
    const { app, chatModel } = await setup();

    await postChat(app, {
      messages: [userMessage('What is the notice period to terminate this agreement?')],
    });

    expect(chatModel.calls).toHaveLength(1);
    const { system, messages } = chatModel.calls[0]!;
    expect(system).toContain(
      "[1] nda.md — Art. 5.1 — Notice period\n5.1 **Notice period.** Either party may terminate this agreement on thirty (30) days' written notice.",
    );
    expect(system).toMatch(/only/i);
    expect(messages).toEqual([
      { role: 'user', content: 'What is the notice period to terminate this agreement?' },
    ]);
  });

  it('emits one source part per retrieved chunk, numbered as in the prompt', async () => {
    const { app, chatModel } = await setup();

    const res = await postChat(app, {
      messages: [userMessage('Who has ownership of inventions created by the employee?')],
    });
    const { sources } = await readAnswer(res);

    expect(sources.length).toBeGreaterThan(1);
    expect(sources.map((s) => s.index)).toEqual(sources.map((_, i) => i + 1));
    expect(sources[0]).toEqual({
      index: 1,
      id: expect.any(String),
      documentName: 'employment.md',
      section: 'Art. 4.1 — Ownership',
      page: null,
      text: '4.1 **Ownership.** All inventions created by the employee during employment belong to the employer.',
      score: expect.any(Number),
    });
    // Scores are cosine similarities. Sources follow the fused (semantic + keyword)
    // ranking, so they need not be sorted by score (see hybrid-search.test.ts).
    for (const s of sources) expect(Math.abs(s.score)).toBeLessThanOrEqual(1);
    // Every source the client sees is a passage the model was given, under the same number.
    for (const s of sources) {
      expect(chatModel.calls[0]!.system).toContain(`[${s.index}] ${s.documentName} — ${s.section}`);
    }
  });
});

describe('POST /api/chat citation markers', () => {
  const question = { messages: [userMessage('What is the notice period?')] };

  it('drops markers that point to a source that was not retrieved', async () => {
    // 5 passages are retrieved, so [9] does not exist. Markers may arrive split across deltas.
    const { app } = await setup([
      'The notice period is 30 days [',
      '1] and the agreement is Dutch [',
      '9].',
    ]);

    const { text, sources } = await readAnswer(await postChat(app, question));

    expect(sources).toHaveLength(5);
    expect(text).toBe('The notice period is 30 days [1] and the agreement is Dutch.');
  });

  it('splits grouped markers into single markers and keeps only the valid ones', async () => {
    const { app } = await setup(['Thirty days [1, 2', '] or five years [3,12].']);

    const { text } = await readAnswer(await postChat(app, question));

    expect(text).toBe('Thirty days [1][2] or five years [3].');
  });

  it('leaves bracketed text that is not a citation alone', async () => {
    const { app } = await setup(['Notice must be "in writing" [sic] [', '2]; see clause [5.1].']);

    const { text } = await readAnswer(await postChat(app, question));

    expect(text).toBe('Notice must be "in writing" [sic] [2]; see clause [5.1].');
  });
});

describe('POST /api/chat with earlier messages', () => {
  it('retrieves and prompts with the latest user message only', async () => {
    const { app, chatModel } = await setup();
    const earlierAnswer = {
      id: 'a1',
      role: 'assistant',
      parts: [
        { type: 'data-source', id: 'x', data: { index: 1 } },
        { type: 'text', text: 'Thirty days [1].' },
      ],
    };

    const res = await postChat(app, {
      messages: [
        userMessage('What is the notice period to terminate this agreement?', 'u1'),
        earlierAnswer,
        userMessage('What is the governing law?', 'u2'),
      ],
    });
    const { sources } = await readAnswer(res);

    expect(chatModel.calls[0]!.messages).toEqual([
      { role: 'user', content: 'What is the governing law?' },
    ]);
    expect(sources[0]!.section).toBe('Art. 9.1 — Governing law');
  });
});

describe('POST /api/chat with a malformed request', () => {
  const malformed: [string, string][] = [
    ['a body that is not JSON', '{"messages": ['],
    ['no messages', JSON.stringify({ messages: [] })],
    ['a message without parts', JSON.stringify({ messages: [{ id: 'u1', role: 'user' }] })],
    [
      'no user message',
      JSON.stringify({
        messages: [{ id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'Hi' }] }],
      }),
    ],
    ['an empty question', JSON.stringify({ messages: [userMessage('   ')] })],
  ];

  it.each(malformed)('rejects %s with a validation error', async (_, body) => {
    const { app, chatModel } = await setup();

    const res = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: 'VALIDATION_ERROR', message: expect.any(String) },
    });
    expect(chatModel.calls).toHaveLength(0);
  });
});

describe('POST /api/chat when the documents cannot be searched', () => {
  it('returns 503 with the shared error shape instead of starting a stream', async () => {
    const app = createApp({
      embedder: fakeEmbedder(),
      chatModel: fakeChatModel(),
      vectorStore: fakeVectorStore({ reachable: false }),
    });

    const res = await postChat(app, { messages: [userMessage('What is the notice period?')] });

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: { code: 'RETRIEVAL_UNAVAILABLE', message: expect.any(String) },
    });
  });
});

describe('POST /api/chat when no passage is relevant enough', () => {
  it('streams the fixed refusal with the nearest passages as sources, without calling the chat model', async () => {
    const { app, chatModel } = await setup();

    const res = await postChat(app, {
      messages: [userMessage('Can I bring my dog to the office?')],
    });

    expect(res.status).toBe(200);
    const { text, sources } = await readAnswer(res);
    expect(text).toBe('The answer was not found in the documents.');
    expect(sources).toHaveLength(5);
    expect(sources.every((s) => s.score < FAKE_MIN_RELEVANCE)).toBe(true);
    expect(chatModel.calls).toHaveLength(0);
  });

  it('refuses based on the configured threshold', async () => {
    const { chatModel, embedder, vectorStore } = await setup();
    const strict = createApp({ chatModel, embedder, vectorStore }, { minRelevanceScore: 0.99 });

    const { text, sources } = await readAnswer(
      await postChat(strict, { messages: [userMessage('What is the notice period?')] }),
    );

    expect(text).toBe('The answer was not found in the documents.');
    expect(sources[0]!.section).toBe('Art. 5.1 — Notice period');
    expect(chatModel.calls).toHaveLength(0);
  });

  it('tells the chat model to reply with the same refusal when the context is insufficient', async () => {
    const { app, chatModel } = await setup();

    await postChat(app, { messages: [userMessage('What is the notice period?')] });

    expect(chatModel.calls[0]!.system).toContain(`"${REFUSAL_SENTENCE}"`);
  });
});
