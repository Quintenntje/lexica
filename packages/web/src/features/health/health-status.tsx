import type { HealthResponse, ModelHealth } from '@lexica/shared';
import { cn } from '@/lib/utils';
import { useHealth } from './use-health';

type Tone = 'ok' | 'warn' | 'error' | 'pending';

const dotClass: Record<Tone, string> = {
  ok: 'bg-success',
  warn: 'bg-warning',
  error: 'bg-destructive',
  pending: 'bg-muted-foreground animate-pulse',
};

const toneLabel: Record<Tone, string> = {
  pending: 'Checking services…',
  error: 'API unreachable',
  ok: 'All systems ready',
  warn: 'Services degraded',
};

function Check({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <li className="flex items-start gap-2">
      <span
        className={cn('mt-1.5 size-2 shrink-0 rounded-full', ok ? dotClass.ok : dotClass.error)}
      />
      <span>
        <span className="font-medium">{label}</span>
        <span className="block text-muted-foreground">{detail}</span>
      </span>
    </li>
  );
}

function modelDetail(model: ModelHealth): string {
  if (!model.reachable) return 'unknown (Ollama unreachable)';
  return model.modelPresent ? 'available' : 'not pulled (run npm run setup)';
}

function Details({ health }: { health: HealthResponse }) {
  const { vectorStore, embedder, chatModel } = health;
  const ollamaReachable = embedder.reachable && chatModel.reachable;

  return (
    <ul className="space-y-2">
      <Check
        label="Qdrant"
        ok={vectorStore.reachable}
        detail={vectorStore.reachable ? 'reachable' : 'unreachable (run npm run setup)'}
      />
      <Check
        label="Ollama"
        ok={ollamaReachable}
        detail={ollamaReachable ? 'reachable' : 'unreachable (run npm run setup)'}
      />
      <Check
        label={`Embedding model · ${embedder.model}`}
        ok={embedder.modelPresent}
        detail={modelDetail(embedder)}
      />
      <Check
        label={`Chat model · ${chatModel.model}`}
        ok={chatModel.modelPresent}
        detail={modelDetail(chatModel)}
      />
    </ul>
  );
}

/** Compact status pill; hovering or focusing it reveals each dependency's state. */
export function HealthStatus() {
  const { data, isPending, isError } = useHealth();

  let tone: Tone = 'pending';
  if (isError) tone = 'error';
  else if (!isPending) tone = data.status === 'ok' ? 'ok' : 'warn';

  return (
    <div className="group relative">
      <button
        type="button"
        className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
        aria-describedby="health-details"
      >
        <span className={cn('size-2 rounded-full', dotClass[tone])} aria-hidden />
        <span role="status">{toneLabel[tone]}</span>
      </button>
      <div
        id="health-details"
        role="tooltip"
        className="invisible absolute right-0 z-50 mt-1 w-72 rounded-lg border bg-popover p-3 text-sm text-popover-foreground opacity-0 shadow-md transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
      >
        {data ? (
          <Details health={data} />
        ) : isError ? (
          <p>The Lexica API is not responding. Start it with npm run dev.</p>
        ) : (
          <p>Checking Qdrant and Ollama…</p>
        )}
      </div>
    </div>
  );
}
