import type { Source } from '@lexica/shared';

/** An inline citation like [2]: a small badge that opens the cited passage. */
export function CitationBadge({ source, onClick }: { source: Source; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${source.documentName} — ${source.section}`}
      aria-label={`Source ${source.index}: ${source.documentName}, ${source.section}`}
      className="mx-0.5 inline-flex h-5 min-w-5 -translate-y-px items-center justify-center rounded-md border bg-secondary px-1 align-middle text-[11px] font-semibold text-secondary-foreground tabular-nums transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {source.index}
    </button>
  );
}
