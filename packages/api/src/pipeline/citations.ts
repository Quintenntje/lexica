/**
 * RAG stage 7 — CITE.
 *
 * The model cites passage n of the prompt as `[n]`, and the client receives
 * passage n as the source part with `index: n`, so every marker maps back to
 * the chunk it came from. Two clean-ups happen here, on the token stream:
 *
 * - markers that point to a passage that was not retrieved (a hallucinated
 *   `[9]` when only 5 passages exist) are dropped, so no citation leads nowhere;
 * - grouped markers such as `[1, 2]` are split into `[1][2]`, so the client
 *   only has one marker format to turn into badges.
 *
 * A marker can arrive split over several deltas (`"... [" + "1]"`), so text
 * that could still become a marker is held back until it is complete.
 */

/** A complete marker, with the whitespace before it (dropped together with an invalid marker). */
const MARKER = /(\s*)\[(\d+(?:\s*,\s*\d+)*)\]/g;
/** The end of the text that may still grow into a marker: trailing whitespace and an open `[1, 2`. */
const PENDING = /\s*(?:\[[\d,\s]{0,20})?$/;

export async function* mapCitations(
  deltas: AsyncIterable<string>,
  sourceCount: number,
): AsyncGenerator<string> {
  const rewrite = (text: string) =>
    text.replace(MARKER, (_, space: string, numbers: string) => {
      const valid = numbers
        .split(',')
        .map(Number)
        .filter((n) => n >= 1 && n <= sourceCount);
      return valid.length > 0 ? space + valid.map((n) => `[${n}]`).join('') : '';
    });

  let pending = '';
  for await (const delta of deltas) {
    const text = rewrite(pending + delta);
    const holdFrom = PENDING.exec(text)!.index;
    pending = text.slice(holdFrom);
    if (holdFrom > 0) yield text.slice(0, holdFrom);
  }
  if (pending) yield rewrite(pending);
}
