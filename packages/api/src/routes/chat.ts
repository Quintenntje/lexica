import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  chatRequestSchema,
  type ApiError,
  type ChatRequest,
  type LexicaMessage,
  type Source,
} from '@lexica/shared';
import { mapCitations } from '../pipeline/citations';
import { buildSystemPrompt } from '../pipeline/prompt';
import { retrieve } from '../pipeline/retriever';
import type { Providers, SearchHit } from '../providers/types';

/**
 * Single-turn retrieval: only the latest user message is answered. Earlier
 * messages stay visible in the UI but are not used for retrieval or prompting.
 */
function latestQuestion({ messages }: ChatRequest): string {
  const last = messages.findLast((m) => m.role === 'user');
  return (last?.parts ?? [])
    .flatMap((p) => (p.type === 'text' && typeof p.text === 'string' ? [p.text] : []))
    .join('\n')
    .trim();
}

function toSource(hit: SearchHit, index: number): Source {
  return {
    index: index + 1,
    id: hit.id,
    documentName: hit.documentName,
    section: hit.section,
    page: hit.page,
    text: hit.text,
    score: hit.score,
  };
}

export function chatRoutes(providers: Providers) {
  return new Hono().post('/', async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    const parsed = chatRequestSchema.safeParse(body);
    if (!parsed.success)
      return c.json<ApiError>(validationError(z.prettifyError(parsed.error)), 400);
    const question = latestQuestion(parsed.data);
    if (!question) {
      return c.json<ApiError>(
        validationError('The latest user message must contain a non-empty text question.'),
        400,
      );
    }

    // RETRIEVE before the stream starts, so a down Qdrant/Ollama is still a JSON 503.
    let hits: SearchHit[];
    try {
      hits = await retrieve(providers, question);
    } catch (err) {
      console.error(err);
      return c.json<ApiError>(
        {
          error: {
            code: 'RETRIEVAL_UNAVAILABLE',
            message:
              'Could not search the documents. Are Qdrant and Ollama running (npm run setup)?',
          },
        },
        503,
      );
    }

    const signal = c.req.raw.signal; // aborted when the client presses stop
    const stream = createUIMessageStream<LexicaMessage>({
      execute: async ({ writer }) => {
        writer.write({ type: 'start' });

        // One source part per retrieved passage, numbered like the prompt's context.
        hits.forEach((hit, i) => {
          writer.write({ type: 'data-source', id: hit.id, data: toSource(hit, i) });
        });

        // PROMPT + GENERATE: stream the model's answer token by token,
        // CITE: with markers to non-existent passages removed on the way.
        writer.write({ type: 'text-start', id: 'answer' });
        const tokens = providers.chatModel.stream({
          system: buildSystemPrompt(hits),
          messages: [{ role: 'user', content: question }],
          signal,
        });
        for await (const delta of mapCitations(tokens, hits.length)) {
          if (delta) writer.write({ type: 'text-delta', id: 'answer', delta });
        }
        writer.write({ type: 'text-end', id: 'answer' });
        writer.write({ type: 'finish', finishReason: 'stop' });
      },
      // Runs if the model fails mid-answer; the client shows it as a system error.
      onError: (err) => {
        console.error(err);
        return `The language model failed while answering${err instanceof Error ? `: ${err.message}` : '.'}`;
      },
    });

    return createUIMessageStreamResponse({ stream });
  });
}

function validationError(message: string): ApiError {
  return { error: { code: 'VALIDATION_ERROR', message } };
}
