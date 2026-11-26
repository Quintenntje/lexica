import type { SearchHit } from '../providers/types';

/**
 * Default minimum relevance score. With nomic-embed-text, a passage that
 * answers the question scores around 0.85 cosine similarity, a related one
 * around 0.65 and an unrelated one 0.45–0.50. Override with MIN_RELEVANCE_SCORE.
 */
export const DEFAULT_MIN_RELEVANCE_SCORE = 0.6;

/**
 * RAG stage 5b — DECIDE whether the documents can answer at all.
 *
 * If no retrieved passage reaches the threshold, the answer is the fixed
 * refusal and the model is never called: a small local model handed only
 * irrelevant context is the most likely to invent an answer.
 *
 * The threshold is compared against the dense cosine similarity score, whose
 * scale is fixed (-1 to 1); rank-fused scores are not comparable across queries.
 */
export function hasRelevantPassage(hits: SearchHit[], minScore: number): boolean {
  return hits.some((hit) => hit.score >= minScore);
}
