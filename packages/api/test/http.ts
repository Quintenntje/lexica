import {
  parseJsonEventStream,
  readUIMessageStream,
  uiMessageChunkSchema,
  type UIMessage,
} from 'ai';
import { expect } from 'vitest';
import {
  documentSummarySchema,
  listDocumentsResponseSchema,
  sourceSchema,
  type DocumentSummary,
  type Source,
} from '@lexica/shared';
import { createApp, type App, type AppOptions } from '../src/app';
import type { Providers } from '../src/providers/types';
import { fakeChatModel, fakeEmbedder, fakeVectorStore } from './fakes';

/**
 * Helpers that drive the API over HTTP only: tests set up state by uploading
 * (`POST /api/documents`) and observe it through the document list and the
 * chat stream (`POST /api/chat`), as the web app does.
 */

/**
 * Relevance threshold for the bag-of-words fake embedder, whose cosine scale is
 * lower than nomic-embed-text's: questions about the test documents score 0.5
 * or more, unrelated ones 0.4 or less.
 */
export const FAKE_MIN_RELEVANCE = 0.45;

/** An app on fresh fakes (any of which can be replaced), with the fake-scale relevance threshold. */
export function testApp(providers: Partial<Providers> = {}, options: AppOptions = {}) {
  const all: Providers = {
    embedder: fakeEmbedder(),
    chatModel: fakeChatModel(),
    vectorStore: fakeVectorStore(),
    ...providers,
  };
  return {
    ...all,
    app: createApp(all, { minRelevanceScore: FAKE_MIN_RELEVANCE, ...options }),
  };
}

export function upload(app: App, file: File) {
  const form = new FormData();
  form.append('file', file);
  return app.request('/api/documents', { method: 'POST', body: form });
}

/** Uploads a file that must be accepted and returns its summary. */
export async function uploadDocument(
  app: App,
  name: string,
  content: string | Uint8Array<ArrayBuffer>,
): Promise<DocumentSummary> {
  const res = await upload(app, new File([content], name));
  expect(res.status).toBe(201);
  return documentSummarySchema.parse(await res.json());
}

export async function listDocuments(app: App): Promise<DocumentSummary[]> {
  const res = await app.request('/api/documents');
  expect(res.status).toBe(200);
  return listDocumentsResponseSchema.parse(await res.json()).documents;
}

export function userMessage(text: string, id = 'u1') {
  return { id, role: 'user', parts: [{ type: 'text', text }] };
}

export function postChat(app: App, body: unknown) {
  return app.request('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Rebuilds the final assistant message from the stream, exactly as `useChat` does. */
export async function readAnswer(res: Response): Promise<{ text: string; sources: Source[] }> {
  const chunks = parseJsonEventStream({
    stream: res.body!,
    schema: uiMessageChunkSchema,
  }).pipeThrough(
    new TransformStream({
      transform(result, controller) {
        if (!result.success) throw result.error;
        controller.enqueue(result.value);
      },
    }),
  );
  let message: UIMessage | undefined;
  for await (const m of readUIMessageStream({ stream: chunks })) message = m;
  const text = message!.parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('');
  const sources: Source[] = message!.parts
    .filter((p) => p.type === 'data-source')
    .map((p) => sourceSchema.parse((p as { data: unknown }).data));
  return { text, sources };
}

/** Asks one question and returns the answer text and the `data-source` parts (the retrieved passages). */
export async function ask(app: App, question: string) {
  const res = await postChat(app, { messages: [userMessage(question)] });
  expect(res.status).toBe(200);
  return readAnswer(res);
}

/** Section labels of the passages retrieved for a question. */
export async function sectionsFor(app: App, question: string): Promise<string[]> {
  return (await ask(app, question)).sources.map((s) => s.section);
}
