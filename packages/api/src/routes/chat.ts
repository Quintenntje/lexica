import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  chatRequestSchema,
  type ChatRequest,
  type LexicaMessage,
  type Source,
  REFUSAL_SENTENCE,
} from '@lexica/shared';
import { mapCitations } from '../pipeline/citations';
import { buildSystemPrompt } from '../pipeline/prompt';
import { hasRelevantPassage } from '../pipeline/relevance';
import { retrieve } from '../pipeline/retriever';
import type { Providers, SearchHit } from '../providers/types';
import { apiError, serviceUnavailable } from './errors';

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

export interface ChatOptions {
  /** Below this score for every passage, the fixed refusal is sent and the model is not called. */
  minRelevanceScore: number;
}

export function chatRoutes(providers: Providers, { minRelevanceScore }: ChatOptions) {
  return new Hono().post('/', async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    const parsed = chatRequestSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(c, 400, 'VALIDATION_ERROR', z.prettifyError(parsed.error));
    }
    const question = latestQuestion(parsed.data);
    if (!question) {
      return apiError(
        c,
        400,
        'VALIDATION_ERROR',
        'The latest user message must contain a non-empty text question.',
      );
    }

    // RETRIEVE before the stream starts, so a down Qdrant/Ollama is still a JSON 503.
    let hits: SearchHit[];
    try {
      hits = await retrieve(providers, question);
    } catch (err) {
      return serviceUnavailable(c, {
        code: 'RETRIEVAL_UNAVAILABLE',
        message: 'Could not search the documents. Are Qdrant and Ollama running (npm run setup)?',
        cause: err,
      });
    }

    const signal = c.req.raw.signal; // aborted when the client presses stop
    const stream = createUIMessageStream<LexicaMessage>({
      execute: async ({ writer }) => {
        writer.write({ type: 'start' });

        // One source part per retrieved passage, numbered like the prompt's context.
        hits.forEach((hit, i) => {
          writer.write({ type: 'data-source', id: hit.id, data: toSource(hit, i) });
        });

        // DECIDE: nothing relevant enough, so refuse without calling the model.
        // The nearest passages above still go out, so the user can judge how close the search came.
        if (!hasRelevantPassage(hits, minRelevanceScore)) {
          writer.write({ type: 'text-start', id: 'answer' });
          writer.write({ type: 'text-delta', id: 'answer', delta: REFUSAL_SENTENCE });
          writer.write({ type: 'text-end', id: 'answer' });
          writer.write({ type: 'finish', finishReason: 'stop' });
          return;
        }

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
