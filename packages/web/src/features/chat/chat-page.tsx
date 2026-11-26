import { useChat } from '@ai-sdk/react';
import {
  apiErrorSchema,
  lexicaDataPartSchemas,
  type LexicaMessage,
  type Source,
} from '@lexica/shared';
import { DefaultChatTransport } from 'ai';
import { AlertTriangle, MessageSquare, SendHorizontal } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AnswerText } from './answer-text';
import { SourceList } from './source-list';
import { SourcePanel } from './source-panel';

// Single-turn retrieval: the API only answers the latest user message, so
// earlier turns don't need to be sent back. The Vite dev server proxies /api.
const transport = new DefaultChatTransport<LexicaMessage>({
  api: '/api/chat',
  prepareSendMessagesRequest: ({ messages }) => ({ body: { messages: messages.slice(-1) } }),
});

/** A failed HTTP request surfaces the raw JSON error body; show its readable message. */
function errorMessage(error: Error): string {
  try {
    const parsed = apiErrorSchema.safeParse(JSON.parse(error.message));
    if (parsed.success) return parsed.data.error.message;
  } catch {
    // Not JSON: a stream error, whose message is already readable.
  }
  return error.message;
}

function sourcesOf(message: LexicaMessage): Source[] {
  return message.parts.flatMap((p) => (p.type === 'data-source' ? [p.data] : []));
}

function textOf(message: LexicaMessage): string {
  return message.parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('');
}

export function ChatPage() {
  const [input, setInput] = useState('');
  const [openSource, setOpenSource] = useState<Source | null>(null);
  const { messages, sendMessage, status, error } = useChat<LexicaMessage>({
    transport,
    dataPartSchemas: lexicaDataPartSchemas,
  });
  const busy = status === 'submitted' || status === 'streaming';

  function submit(event: FormEvent) {
    event.preventDefault();
    const question = input.trim();
    if (!question || busy) return;
    void sendMessage({ text: question });
    setInput('');
  }

  return (
    <div className={cn('grid gap-6', openSource && 'lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]')}>
      <section className="flex min-h-[calc(100svh-8rem)] flex-col gap-6">
        {messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <MessageSquare className="size-8 text-muted-foreground" aria-hidden />
            <h1 className="text-xl font-semibold tracking-tight">Ask about your contracts</h1>
            <p className="max-w-md text-sm text-muted-foreground">
              Lexica answers only from the indexed documents and cites the passages it relies on.
              Click a citation to read the original wording.
            </p>
          </div>
        ) : (
          <ol className="flex-1 space-y-6" aria-label="Conversation" aria-live="polite">
            {messages.map((message) => {
              const text = textOf(message);
              if (message.role === 'user') {
                return (
                  <li key={message.id} className="flex justify-end">
                    <p className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-sm whitespace-pre-wrap text-primary-foreground">
                      {text}
                    </p>
                  </li>
                );
              }
              const sources = sourcesOf(message);
              return (
                <li key={message.id} className="space-y-4">
                  {text ? (
                    <AnswerText text={text} sources={sources} onOpenSource={setOpenSource} />
                  ) : (
                    <p className="text-sm text-muted-foreground">Writing the answer…</p>
                  )}
                  {sources.length > 0 && (
                    <SourceList
                      sources={sources}
                      activeId={openSource?.id}
                      onOpenSource={setOpenSource}
                    />
                  )}
                </li>
              );
            })}
            {status === 'submitted' && (
              <li className="text-sm text-muted-foreground">Searching the documents…</li>
            )}
          </ol>
        )}

        {error && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
            <div>
              <p className="font-medium">Something went wrong</p>
              <p className="text-muted-foreground">{errorMessage(error)}</p>
            </div>
          </div>
        )}

        <form
          onSubmit={submit}
          className="sticky bottom-4 flex items-end gap-2 rounded-xl border bg-card p-2 shadow-sm"
        >
          <label htmlFor="question" className="sr-only">
            Your question
          </label>
          <textarea
            id="question"
            rows={1}
            value={input}
            disabled={busy}
            placeholder="Ask a question about your documents…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60"
          />
          <Button type="submit" size="icon" disabled={busy || !input.trim()} aria-label="Ask">
            <SendHorizontal />
          </Button>
        </form>
      </section>

      {openSource && <SourcePanel source={openSource} onClose={() => setOpenSource(null)} />}
    </div>
  );
}
