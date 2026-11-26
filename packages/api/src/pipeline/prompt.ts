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
- After every statement, cite the passage(s) it comes from with bracketed numbers, e.g. [1] or [2][3].
- Only cite numbers that appear in the context.
- If the passages do not contain the answer, say that you could not find it in the documents.
- Be concise and quote the exact wording of the contract where it matters.

Context passages:

${context}`;
}
