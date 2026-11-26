import type { Providers, SearchHit } from '../providers/types';

/** How many passages are retrieved per question and handed to the model as context. */
export const TOP_K = 5;

/**
 * RAG stage 5 — RETRIEVE.
 *
 * The question is embedded with the same model as the passages, then the
 * vector store returns the `TOP_K` passages whose vectors are closest by
 * cosine similarity. The score travels with each passage so the UI can show
 * how close a match was.
 */
export async function retrieve(
  { embedder, vectorStore }: Pick<Providers, 'embedder' | 'vectorStore'>,
  question: string,
  topK = TOP_K,
): Promise<SearchHit[]> {
  const vector = await embedder.embedQuery(question);
  return vectorStore.search(vector, { limit: topK });
}
