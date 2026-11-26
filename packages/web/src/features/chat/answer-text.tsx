import type { Source } from '@lexica/shared';
import { Fragment } from 'react';
import { CitationBadge } from './citation-badge';

/**
 * Renders answer text with each `[n]` citation marker replaced by a clickable
 * badge for source n. The API already drops markers to sources that were not
 * retrieved; a marker without a matching source is dropped here too (e.g.
 * while the stream is still arriving).
 */
export function AnswerText({
  text,
  sources,
  onOpenSource,
}: {
  text: string;
  sources: Source[];
  onOpenSource: (source: Source) => void;
}) {
  return (
    <p className="leading-7 whitespace-pre-wrap">
      {text.split(/(\[\d+\])/g).map((part, i) => {
        const marker = /^\[(\d+)\]$/.exec(part);
        if (!marker) return <Fragment key={i}>{part}</Fragment>;
        const source = sources.find((s) => s.index === Number(marker[1]));
        return source ? (
          <CitationBadge key={i} source={source} onClick={() => onOpenSource(source)} />
        ) : null;
      })}
    </p>
  );
}
