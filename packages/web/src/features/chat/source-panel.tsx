import type { Source } from '@lexica/shared';
import { FileText, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { sourceLocation } from './source-location';

/** Side panel with the full text of a cited passage and where it comes from. */
export function SourcePanel({ source, onClose }: { source: Source; onClose: () => void }) {
  return (
    <aside
      aria-label="Source passage"
      className="flex max-h-[calc(100svh-8rem)] flex-col overflow-hidden rounded-xl border bg-card lg:sticky lg:top-20"
    >
      <header className="flex items-start gap-3 border-b px-4 py-3">
        <span className="mt-0.5 inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-secondary px-1.5 text-xs font-semibold text-secondary-foreground tabular-nums">
          {source.index}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{source.documentName}</span>
          </h2>
          <p className="text-xs text-muted-foreground">{sourceLocation(source)}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close source panel">
          <X />
        </Button>
      </header>
      <blockquote className="overflow-y-auto px-4 py-4 font-serif text-sm leading-7 whitespace-pre-wrap">
        {source.text}
      </blockquote>
      <footer className="border-t px-4 py-2 text-xs text-muted-foreground">
        Similarity to your question: {source.score.toFixed(2)}
      </footer>
    </aside>
  );
}
