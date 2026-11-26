/**
 * Reciprocal rank fusion, as Qdrant's `{ fusion: 'rrf' }` does it: every
 * ranking adds 1 / (2 + position) to each id it contains (position counted
 * from 0), and ids are ordered by the sum. An id near the top of both the
 * semantic and the keyword ranking beats one that is first in only one.
 *
 * Fused scores only say how high an id ranked, never how relevant it is, so
 * they are used for ordering only.
 */
export function fuseRankings(rankings: string[][]): string[] {
  const fused = new Map<string, number>();
  for (const ranking of rankings) {
    ranking.forEach((id, position) => {
      fused.set(id, (fused.get(id) ?? 0) + 1 / (2 + position));
    });
  }
  return [...fused.keys()].sort((a, b) => fused.get(b)! - fused.get(a)!);
}
