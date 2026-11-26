import type { Source } from '@lexica/shared';

/** "Art. 7.2 — Termination · p. 3": where in the document a passage comes from. */
export function sourceLocation(source: Source): string {
  return source.page === null ? source.section : `${source.section} · p. ${source.page}`;
}
