import { REFUSAL_SENTENCE } from '@lexica/shared';
import type { SearchHit } from '../providers/types';

/**
 * RAG stage 6 — PROMPT.
 *
 * The retrieved passages are numbered [1], [2], … in retrieval order and put
 * into the system prompt. The model is told to answer only from them and to
 * cite the number of every passage it relies on; the citation markers are
 * later mapped back to these same passages (see citations.ts).
 */
export function buildSystemPrompt(passages: SearchHit[]): string {
  const context = passages
    .map((p, i) => {
      const where = [p.documentName, p.section, p.page !== null ? `page ${p.page}` : null]
        .filter(Boolean)
        .join(' — ');
      return `[${i + 1}] ${where}\n${p.text}`;
    })
    .join('\n\n');

  return `You are Lexica, an assistant that answers questions about legal documents.

Rules:
- Answer only from the numbered context passages below. Do not use general knowledge.
- Answer in full sentences that repeat the contract's own wording, with every number, period, amount and place exactly as written in the passage. Never answer with only a citation number.
- End each sentence with the bracketed number(s) of the passage(s) it comes from, e.g. "The supplier must give written notice before it suspends the service [2]." or [1][3].
- Only cite numbers that appear in the context.
- If the passages do not contain the answer, reply with exactly this sentence and nothing else: "${REFUSAL_SENTENCE}"
- Be concise and quote the exact wording of the contract where it matters.

Context passages:

${context}`;
}
