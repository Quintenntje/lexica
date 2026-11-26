import { MessageSquare } from 'lucide-react';

/** Questions the bundled sample contracts (see /samples) can answer, with citations. */
const EXAMPLE_QUESTIONS = [
  'What notice period applies after the probationary period?',
  'How long do the confidentiality obligations of the NDA survive termination?',
  'Is Larkspur’s liability capped, and at what amount?',
  'What happens to customer data when the subscription ends?',
];

/** The empty chat: what Lexica does, and a few questions to start with. */
export function ExampleQuestions({ onAsk }: { onAsk: (question: string) => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <MessageSquare className="size-8 text-muted-foreground" aria-hidden />
      <h1 className="text-xl font-semibold tracking-tight">Ask about your contracts</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Lexica answers only from the indexed documents and cites the passages it relies on. Click a
        citation to read the original wording.
      </p>
      <section aria-labelledby="example-questions" className="mt-4 w-full max-w-2xl space-y-2">
        <h2
          id="example-questions"
          className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
        >
          Try one of these
        </h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {EXAMPLE_QUESTIONS.map((question) => (
            <li key={question}>
              <button
                type="button"
                onClick={() => onAsk(question)}
                className="h-full w-full rounded-lg border bg-card px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {question}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
