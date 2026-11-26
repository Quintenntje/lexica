import type { SearchHit } from '../providers/types';

/**
 * Default minimum cosine similarity, calibrated on `npm run eval` with
 * nomic-embed-text and the sample contracts: the best passage for a question
 * the documents answer scores 0.72–0.88, the best passage for an off-topic
 * question ("What is the capital of Australia?") at most 0.59. Near-topic
 * questions the documents do not answer (parental leave, a lease deposit)
 * score 0.67–0.72 and are left to the model, which is told to refuse.
 * Override with MIN_RELEVANCE_SCORE.
 */
export const DEFAULT_MIN_RELEVANCE_SCORE = 0.66;

/** Keyword evidence lowers the bar by this much (0.66 → 0.56 by default). */
export const KEYWORD_MARGIN = 0.1;

/** Only the best keyword matches count as evidence, not every passage sharing a word with the question. */
export const KEYWORD_TOP_RANKS = 3;

/**
 * RAG stage 5b — DECIDE whether the documents can answer at all.
 *
 * If no retrieved passage is relevant, the answer is the fixed refusal and
 * the model is never called: a small local model handed only irrelevant
 * context is the most likely to invent an answer.
 *
 * A passage is relevant on either of two signals:
 *
 * - semantic: its cosine similarity reaches `minScore`; or
 * - keyword + semantic: it is one of the top keyword (BM25) matches and its
 *   cosine similarity is at least `minScore - KEYWORD_MARGIN`. A question that
 *   names an exact term or clause ("Art. 7.2", "force majeure") shares few
 *   other words with the clause, so its cosine is lower even though the right
 *   passage was found. The cosine floor stays, so an off-topic question that
 *   happens to share a word with a contract is still refused.
 *
 * Both signals use the cosine scale (-1 to 1), which is fixed, never the fused
 * rank score, which is not comparable across questions.
 */
export function hasRelevantPassage(hits: SearchHit[], minScore: number): boolean {
  return hits.some(
    (hit) =>
      hit.score >= minScore ||
      (hit.keywordRank !== null &&
        hit.keywordRank <= KEYWORD_TOP_RANKS &&
        hit.score >= minScore - KEYWORD_MARGIN),
  );
}
