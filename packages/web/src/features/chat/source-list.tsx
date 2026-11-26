import type { Source } from '@lexica/shared';
import { FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { sourceLocation } from './source-location';

/** Every passage retrieved for an answer, listed under it; each opens the source panel. */
export function SourceList({
  sources,
  activeId,
  onOpenSource,
}: {
  sources: Source[];
  activeId: string | undefined;
  onOpenSource: (source: Source) => void;
}) {
  return (
    <section aria-label="Sources" className="space-y-2">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Sources</h3>
      <ol className="grid gap-1.5 sm:grid-cols-2">
        {sources.map((source) => (
          <li key={source.id}>
            <button
              type="button"
              onClick={() => onOpenSource(source)}
              aria-pressed={source.id === activeId}
              className={cn(
                'flex w-full items-start gap-2 rounded-lg border bg-card px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                source.id === activeId && 'border-primary/40 bg-accent',
              )}
            >
              <span className="mt-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-secondary px-1 text-[11px] font-semibold text-secondary-foreground tabular-nums">
                {source.index}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 font-medium">
                  <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate">{source.documentName}</span>
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {sourceLocation(source)}
                </span>
              </span>
              <span
                className="text-xs text-muted-foreground tabular-nums"
                title="Similarity to the question"
              >
                {source.score.toFixed(2)}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
