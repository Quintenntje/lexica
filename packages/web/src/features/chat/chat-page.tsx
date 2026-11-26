import { useChat } from '@ai-sdk/react';
import { lexicaDataPartSchemas, type LexicaMessage, type Source } from '@lexica/shared';
import { DefaultChatTransport } from 'ai';
import { SendHorizontal, Square, SquarePen } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AnswerText } from './answer-text';
import { ChatError } from './chat-error';
import { ExampleQuestions } from './example-questions';
import { SourceList } from './source-list';
import { SourcePanel } from './source-panel';

// Single-turn retrieval: the API only answers the latest user message, so
// earlier turns don't need to be sent back. The Vite dev server proxies /api.
const transport = new DefaultChatTransport<LexicaMessage>({
  api: '/api/chat',
  prepareSendMessagesRequest: ({ messages }) => ({ body: { messages: messages.slice(-1) } }),
});

function sourcesOf(message: LexicaMessage): Source[] {
  return message.parts.flatMap((p) => (p.type === 'data-source' ? [p.data] : []));
}

function textOf(message: LexicaMessage): string {
  return message.parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('');
}

export function ChatPage() {
  const [input, setInput] = useState('');
  const [openSource, setOpenSource] = useState<Source | null>(null);
  // Answers the user stopped mid-stream, marked as such under their text.
  const [stoppedIds, setStoppedIds] = useState<ReadonlySet<string>>(new Set());
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Whatever opened the source panel, to return focus to when it closes.
  const sourceTriggerRef = useRef<HTMLElement | null>(null);
  const { messages, sendMessage, regenerate, stop, setMessages, clearError, status, error } =
    useChat<LexicaMessage>({
      transport,
      dataPartSchemas: lexicaDataPartSchemas,
      onFinish: ({ message, isAbort }) => {
        if (isAbort) setStoppedIds((ids) => new Set(ids).add(message.id));
      },
    });
  const busy = status === 'submitted' || status === 'streaming';
  const lastMessage = messages.at(-1);

  // The input is disabled while an answer streams, which drops its focus.
  // Give it back afterwards, unless the user has moved on (e.g. to a source).
  useEffect(() => {
    if (!busy && document.activeElement === document.body) inputRef.current?.focus();
  }, [busy]);

  function ask(question: string) {
    if (!question || busy) return;
    void sendMessage({ text: question });
    setInput('');
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    ask(input.trim());
  }

  function newChat() {
    void stop();
    setMessages([]);
    clearError();
    setStoppedIds(new Set());
    setOpenSource(null);
    setInput('');
    inputRef.current?.focus();
  }

  function showSource(source: Source) {
    if (document.activeElement instanceof HTMLElement) {
      sourceTriggerRef.current = document.activeElement;
    }
    setOpenSource(source);
  }

  function closeSource(hadFocus: boolean) {
    setOpenSource(null);
    if (!hadFocus) return;
    const trigger = sourceTriggerRef.current;
    (trigger?.isConnected ? trigger : inputRef.current)?.focus();
  }

  return (
    <div className={cn('grid gap-6', openSource && 'lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]')}>
      <section className="flex min-h-[calc(100svh-8rem)] min-w-0 flex-col gap-6">
        {messages.length === 0 ? (
          <ExampleQuestions onAsk={ask} />
        ) : (
          <>
            <div className="flex items-center justify-end">
              <h1 className="sr-only">Chat</h1>
              <Button variant="outline" size="sm" onClick={newChat}>
                <SquarePen />
                New chat
              </Button>
            </div>
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
                const writing = busy && message === lastMessage;
                return (
                  <li key={message.id} className="space-y-4">
                    {text ? (
                      <AnswerText text={text} sources={sources} onOpenSource={showSource} />
                    ) : (
                      writing && (
                        <p className="text-sm text-muted-foreground">Writing the answer…</p>
                      )
                    )}
                    {stoppedIds.has(message.id) && (
                      <p className="text-xs text-muted-foreground italic">Answer stopped.</p>
                    )}
                    {sources.length > 0 && (
                      <SourceList
                        sources={sources}
                        activeId={openSource?.id}
                        onOpenSource={showSource}
                      />
                    )}
                  </li>
                );
              })}
              {status === 'submitted' && (
                <li className="text-sm text-muted-foreground">Searching the documents…</li>
              )}
              {status === 'ready' && lastMessage?.role === 'user' && (
                <li className="text-xs text-muted-foreground italic">
                  Stopped before an answer arrived.
                </li>
              )}
            </ol>
          </>
        )}

        {error && <ChatError error={error} onRetry={() => void regenerate()} />}

        <form
          onSubmit={submit}
          className="sticky bottom-4 flex items-end gap-2 rounded-xl border bg-card p-2 shadow-sm"
        >
          <label htmlFor="question" className="sr-only">
            Your question
          </label>
          <textarea
            ref={inputRef}
            id="question"
            rows={1}
            value={input}
            disabled={busy}
            placeholder="Ask a question about your documents…"
            aria-describedby="question-hint"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            className="field-sizing-content max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60"
          />
          <span id="question-hint" className="sr-only">
            Enter sends the question, Shift+Enter adds a new line.
          </span>
          {busy ? (
            <Button
              type="button"
              size="icon"
              variant="secondary"
              onClick={() => void stop()}
              aria-label="Stop answering"
              title="Stop answering"
            >
              <Square className="fill-current" />
            </Button>
          ) : (
            <Button type="submit" size="icon" disabled={!input.trim()} aria-label="Ask">
              <SendHorizontal />
            </Button>
          )}
        </form>
      </section>

      {openSource && <SourcePanel source={openSource} onClose={closeSource} />}
    </div>
  );
}
