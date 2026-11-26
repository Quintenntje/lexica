import { Hono } from 'hono';
import {
  listDocumentsResponseSchema,
  type ApiError,
  type DocumentSummary,
  type ListDocumentsResponse,
} from '@lexica/shared';
import type { Providers } from '../providers/types';

export function documentRoutes({ vectorStore }: Providers) {
  return new Hono().get('/', async (c) => {
    let documents: DocumentSummary[];
    try {
      documents = await vectorStore.listDocuments();
    } catch (err) {
      console.error(err);
      return c.json<ApiError>(
        {
          error: {
            code: 'VECTOR_STORE_UNAVAILABLE',
            message: 'Could not reach the vector store. Is Qdrant running (npm run setup)?',
          },
        },
        503,
      );
    }
    // Validate against the shared schema so the API never sends a shape the web app does not expect.
    const body: ListDocumentsResponse = listDocumentsResponseSchema.parse({ documents });
    return c.json(body);
  });
}
