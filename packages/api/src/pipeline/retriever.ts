import type { Providers, SearchHit } from '../providers/types';

/** How many passages are retrieved per question and handed to the model as context. */
export const TOP_K = 5;

/**
 * RAG stage 5 — RETRIEVE.
 *
 * Hybrid search: the question is embedded with the same model as the passages
 * (semantic match), and its words are matched against the passages with BM25
 * (keyword match, so exact terms like "force majeure" or "Art. 7.2" are found
 * even when their meaning is not close). The vector store fuses both rankings
 * and returns the `TOP_K` best. Each passage keeps its cosine similarity as
 * `score`, so the UI and the relevance check see how close a match was, and
 * its `keywordRank`, so the relevance check also sees keyword evidence.
 */
export async function retrieve(
  { embedder, vectorStore }: Pick<Providers, 'embedder' | 'vectorStore'>,
  question: string,
): Promise<SearchHit[]> {
  const vector = await embedder.embedQuery(question);
  return vectorStore.search(vector, { limit: TOP_K, text: question });
}
