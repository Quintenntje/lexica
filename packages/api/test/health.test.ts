import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from '@lexica/shared';
import { createApp } from '../src/app';
import { fakeChatModel, fakeEmbedder, fakeVectorStore } from './fakes';

async function getHealth(deps: Parameters<typeof createApp>[0]) {
  const res = await createApp(deps).request('/api/health');
  return { res, body: healthResponseSchema.parse(await res.json()) };
}

describe('GET /api/health', () => {
  it('reports ok when the vector store and both models are available', async () => {
    const { res, body } = await getHealth({
      embedder: fakeEmbedder({ model: 'nomic-embed-text' }),
      chatModel: fakeChatModel({ model: 'qwen2.5:3b' }),
      vectorStore: fakeVectorStore(),
    });

    expect(res.status).toBe(200);
    expect(body).toEqual({
      status: 'ok',
      vectorStore: { provider: 'fake', reachable: true },
      embedder: {
        provider: 'fake',
        model: 'nomic-embed-text',
        reachable: true,
        modelPresent: true,
      },
      chatModel: { provider: 'fake', model: 'qwen2.5:3b', reachable: true, modelPresent: true },
    });
  });

  it('reports degraded when the vector store is unreachable', async () => {
    const { res, body } = await getHealth({
      embedder: fakeEmbedder(),
      chatModel: fakeChatModel(),
      vectorStore: fakeVectorStore({ reachable: false }),
    });

    expect(res.status).toBe(200);
    expect(body.status).toBe('degraded');
    expect(body.vectorStore.reachable).toBe(false);
  });

  it('reports degraded when a configured model has not been pulled', async () => {
    const { body } = await getHealth({
      embedder: fakeEmbedder(),
      chatModel: fakeChatModel({ modelPresent: false }),
      vectorStore: fakeVectorStore(),
    });

    expect(body.status).toBe('degraded');
    expect(body.chatModel.modelPresent).toBe(false);
  });

  it('reports degraded instead of failing when a health check throws', async () => {
    const embedder = fakeEmbedder();
    embedder.checkHealth = () => Promise.reject(new Error('boom'));

    const { res, body } = await getHealth({
      embedder,
      chatModel: fakeChatModel(),
      vectorStore: fakeVectorStore(),
    });

    expect(res.status).toBe(200);
    expect(body.status).toBe('degraded');
    expect(body.embedder).toMatchObject({ reachable: false, modelPresent: false });
  });
});

describe('unknown routes', () => {
  it('return the shared error shape', async () => {
    const res = await createApp({
      embedder: fakeEmbedder(),
      chatModel: fakeChatModel(),
      vectorStore: fakeVectorStore(),
    }).request('/api/nope');

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
  });
});
