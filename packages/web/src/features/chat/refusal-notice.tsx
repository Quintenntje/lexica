import { SearchX } from 'lucide-react';

/**
 * A "not found in the documents" answer. Deliberately calm and neutral, unlike
 * the red error alert: nothing went wrong, the documents just don't say.
 */
export function RefusalNotice({ hasSources }: { hasSources: boolean }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-dashed bg-muted/40 p-4 text-sm">
      <SearchX className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="space-y-1">
        <p className="font-medium">Not found in the documents</p>
        <p className="text-muted-foreground">
          None of the indexed passages answers this question, so Lexica won't guess.
          {hasSources &&
            ' The closest passages are listed below, so you can judge how near the search came.'}
        </p>
      </div>
    </div>
  );
}
