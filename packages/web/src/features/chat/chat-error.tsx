import { apiErrorSchema } from '@lexica/shared';
import { RotateCcw, ServerCrash } from 'lucide-react';
import { Button } from '@/components/ui/button';

type SystemError = { title: string; detail: string };

/**
 * Turns a `useChat` error into something a user can act on. A failed HTTP
 * request surfaces its raw body as the message (the shared JSON error shape,
 * or nothing when the dev proxy can't reach the API); a failure mid-answer
 * surfaces the stream's error text as-is.
 */
function describeChatError(error: Error): SystemError {
  let body: unknown;
  try {
    body = JSON.parse(error.message);
  } catch {
    body = undefined;
  }
  const api = apiErrorSchema.safeParse(body);
  if (api.success) {
    if (api.data.error.code === 'RETRIEVAL_UNAVAILABLE') {
      return { title: 'The document search is unavailable', detail: api.data.error.message };
    }
    return { title: 'The question could not be sent', detail: api.data.error.message };
  }
  const message = error.message.trim();
  if (!message || error instanceof TypeError || /failed to fetch|networkerror/i.test(message)) {
    return {
      title: 'Lexica’s server is not reachable',
      detail: 'Is the API running (npm run dev)? Check the status indicator in the header.',
    };
  }
  return { title: 'The answer was interrupted', detail: message };
}

/**
 * A system failure (services down, server unreachable, model crashed), styled
 * as an alert so it can't be mistaken for an answer, including a refusal.
 */
export function ChatError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const { title, detail } = describeChatError(error);
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm"
    >
      <ServerCrash className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium text-destructive">{title}</p>
        <p className="text-muted-foreground">{detail}</p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RotateCcw />
        Retry
      </Button>
    </div>
  );
}
