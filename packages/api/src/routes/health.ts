import { Hono } from 'hono';
import {
  healthResponseSchema,
  type HealthResponse,
  type ModelHealth,
  type VectorStoreHealth,
} from '@lexica/shared';
import type { ChatModel, Embedder, Providers, VectorStore } from '../providers/types';

/** A failing check means "unreachable", never a 500: the UI should still render a status. */
async function modelHealth(provider: Embedder | ChatModel): Promise<ModelHealth> {
  try {
    return await provider.checkHealth();
  } catch {
    return { provider: 'unknown', model: provider.model, reachable: false, modelPresent: false };
  }
}

async function vectorStoreHealth(store: VectorStore): Promise<VectorStoreHealth> {
  try {
    return await store.checkHealth();
  } catch {
    return { provider: 'unknown', reachable: false };
  }
}

export function healthRoutes({ embedder, chatModel, vectorStore }: Providers) {
  return new Hono().get('/', async (c) => {
    const [vectorStoreStatus, embedderStatus, chatModelStatus] = await Promise.all([
      vectorStoreHealth(vectorStore),
      modelHealth(embedder),
      modelHealth(chatModel),
    ]);

    const allGood =
      vectorStoreStatus.reachable &&
      [embedderStatus, chatModelStatus].every((m) => m.reachable && m.modelPresent);

    const body: HealthResponse = healthResponseSchema.parse({
      status: allGood ? 'ok' : 'degraded',
      vectorStore: vectorStoreStatus,
      embedder: embedderStatus,
      chatModel: chatModelStatus,
    });
    return c.json(body);
  });
}
