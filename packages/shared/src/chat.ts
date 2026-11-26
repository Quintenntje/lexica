import type { UIMessage } from 'ai';
import { z } from 'zod';

/**
 * One retrieved passage, sent to the client as a `data-source` part of the
 * answer stream. `index` is the number the model cites it with: `[1]` refers
 * to the source with index 1.
 */
export const sourceSchema = z.object({
  index: z.number().int().positive(),
  /** Chunk id; also the id of the stream part, so a resent part replaces the old one. */
  id: z.string(),
  documentName: z.string(),
  /** Citation label, e.g. "Art. 7.2 — Termination for convenience". */
  section: z.string(),
  /** Page the passage starts on, or null when the format has no pages. */
  page: z.number().int().positive().nullable(),
  text: z.string(),
  /** Cosine similarity between the question and the passage (higher is more relevant). */
  score: z.number(),
});

/**
 * Body of `POST /api/chat`, as sent by the AI SDK's `useChat`. Kept loose on
 * purpose: earlier assistant messages come back with all their parts, and only
 * the latest user message is used.
 */
export const chatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        id: z.string(),
        role: z.enum(['user', 'assistant', 'system']),
        parts: z.array(z.looseObject({ type: z.string() })),
      }),
    )
    .min(1),
});

export type Source = z.infer<typeof sourceSchema>;
export type ChatRequest = z.infer<typeof chatRequestSchema>;

/** Chat message type shared by the API stream and `useChat`: no metadata, one `source` data part. */
export type LexicaMessage = UIMessage<never, { source: Source }>;

/** Data-part schemas for `useChat({ dataPartSchemas })`, so the client validates sources too. */
export const lexicaDataPartSchemas = { source: sourceSchema };

/**
 * The fixed answer when the documents do not contain the answer. The API sends
 * it without calling the model when no passage is relevant enough, and the
 * prompt tells the model to reply with exactly this sentence otherwise.
 */
export const REFUSAL_SENTENCE = 'The answer was not found in the documents.';

/** Phrasings a model uses instead of the exact refusal: "… do not mention …", "I could not find …", "There is no information …". */
const REWORDED_REFUSAL = [
  /\b(?:not|no|nowhere)\b.{0,60}\b(?:found|find|mention(?:s|ed)?|contain(?:s|ed)?|provide(?:s|d)?|specif(?:y|ies|ied)|state(?:s|d)?|include(?:s|d)?|address(?:es|ed)?|cover(?:s|ed)?|say(?:s)?)\b/,
  /\b(?:cannot|can't|could not|couldn't|unable to)\b.{0,40}\b(?:find|answer|determine|locate|tell)\b/,
  /\bno (?:information|mention|details?|reference)\b/,
];
/** A reworded refusal talks about the sources rather than about the contract's content. */
const ABOUT_THE_SOURCES = /\b(?:documents?|passages?|context|provided (?:text|information))\b/;
/** Real answers can be long; a refusal is a sentence or two. */
const MAX_REFUSAL_LENGTH = 300;

/**
 * Whether an answer is the refusal, whether the API sent it or the model wrote
 * it. Besides the exact sentence (allowing for stray whitespace, citation
 * markers and a missing full stop), a short answer that rewords it counts too,
 * e.g. "The documents do not mention parental leave." A negative statement
 * with a citation ("The agreement does not include a non-compete [2].") is an
 * answer, not a refusal, unless it says the documents lack the answer.
 */
export function isRefusal(text: string): boolean {
  const normalize = (s: string) =>
    s
      .replace(/\[\d+\]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\.$/, '')
      .toLowerCase();
  const answer = normalize(text);
  if (answer === normalize(REFUSAL_SENTENCE)) return true;
  if (!answer || answer.length > MAX_REFUSAL_LENGTH) return false;
  if (!REWORDED_REFUSAL.some((pattern) => pattern.test(answer))) return false;
  const cites = /\[\d+\]/.test(text);
  return !cites || ABOUT_THE_SOURCES.test(answer);
}
