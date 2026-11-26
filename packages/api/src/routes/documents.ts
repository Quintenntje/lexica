import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import {
  fileTypeFromName,
  listDocumentsResponseSchema,
  MAX_UPLOAD_BYTES,
  type DocumentSummary,
  type ListDocumentsResponse,
} from '@lexica/shared';
import { DocumentRejectedError, ProviderUnavailableError } from '../pipeline/errors';
import { indexDocument } from '../pipeline/indexer';
import type { Providers } from '../providers/types';
import { apiError, serviceUnavailable } from './errors';

function vectorStoreUnavailable(c: Context, err: unknown) {
  return serviceUnavailable(c, new ProviderUnavailableError('VECTOR_STORE_UNAVAILABLE', err));
}

/**
 * Uploads carry a single file in the `file` field. The type is decided by the
 * extension: browsers often send an empty or generic MIME type for .md files.
 */
async function readUpload(c: Context) {
  const contentType = c.req.header('Content-Type') ?? '';
  if (!contentType.startsWith('multipart/form-data')) return undefined;
  const file = (await c.req.parseBody())['file'];
  return file instanceof File ? file : undefined;
}

export function documentRoutes(providers: Providers) {
  const { vectorStore } = providers;

  return new Hono()
    .get('/', async (c) => {
      let documents: DocumentSummary[];
      try {
        documents = await vectorStore.listDocuments();
      } catch (err) {
        return vectorStoreUnavailable(c, err);
      }
      // Validate against the shared schema so the API never sends a shape the web app does not expect.
      const body: ListDocumentsResponse = listDocumentsResponseSchema.parse({ documents });
      return c.json(body);
    })

    .post(
      '/',
      bodyLimit({
        maxSize: MAX_UPLOAD_BYTES,
        onError: (c) =>
          apiError(c, 413, 'FILE_TOO_LARGE', 'The file is larger than the 20 MB upload limit.'),
      }),
      async (c) => {
        const file = await readUpload(c);
        if (!file) {
          return apiError(
            c,
            400,
            'VALIDATION_ERROR',
            'Expected a multipart/form-data request with one file in the "file" field.',
          );
        }

        // Keep only the base name: some clients send a path, and the name is the document's identity.
        const name = file.name.split(/[\\/]/).pop()?.trim() ?? '';
        const fileType = fileTypeFromName(name);
        if (!name || !fileType) {
          return apiError(
            c,
            415,
            'UNSUPPORTED_FILE_TYPE',
            `"${name}" is not supported. Upload a .pdf, .md or .txt file.`,
          );
        }

        try {
          const data = new Uint8Array(await file.arrayBuffer());
          // Same pipeline as the seed command; a same-named document is replaced, not duplicated.
          const summary = await indexDocument(providers, { name, fileType, data });
          return c.json<DocumentSummary>(summary, 201);
        } catch (err) {
          if (err instanceof DocumentRejectedError) return apiError(c, 422, err.code, err.message);
          // Ollama or Qdrant is down: a 503 that says which one, like list, delete and chat.
          if (err instanceof ProviderUnavailableError) return serviceUnavailable(c, err);
          throw err;
        }
      },
    )

    .delete('/:id', async (c) => {
      const id = c.req.param('id');
      try {
        // There is no documents table, so "exists" means "has chunks in the vector store".
        const documents = await vectorStore.listDocuments();
        if (!documents.some((d) => d.id === id)) {
          return apiError(c, 404, 'DOCUMENT_NOT_FOUND', 'This document does not exist (any more).');
        }
        // Removes every chunk of the document, so retrieval can no longer return its passages.
        await vectorStore.deleteDocument(id);
      } catch (err) {
        return vectorStoreUnavailable(c, err);
      }
      return c.body(null, 204);
    });
}
