/**
 * Evaluation command: asks every question in the eval set (src/eval/cases.ts)
 * through the real stack (Qdrant + Ollama, the same `POST /api/chat` handler
 * the web app uses) and prints how well retrieval and answering work.
 *
 * It never touches your own collection: the sample contracts are seeded into a
 * temporary Qdrant collection that is dropped afterwards.
 *
 * Usage (from the repo root): npm run eval [-- --verbose]
 */
import {
  parseJsonEventStream,
  readUIMessageStream,
  uiMessageChunkSchema,
  type UIMessage,
} from 'ai';
import { isRefusal, sourceSchema, type Source } from '@lexica/shared';
import { bootstrap } from '../bootstrap';
import { EVAL_CASES, type EvalCase, type ExpectedSource } from '../eval/cases';
import { seedSampleContracts } from '../pipeline/seed';

const verbose = process.argv.includes('--verbose');

// A fresh collection name, so the eval never reads or drops your own collection.
const collection = `lexica_eval_${Date.now()}`;
const { config, providers, app } = bootstrap({ QDRANT_COLLECTION: collection });

interface Answer {
  text: string;
  sources: Source[];
  seconds: number;
}

interface CaseResult {
  case: EvalCase;
  answer: Answer;
  refused: boolean;
  /** In scope only: rank (1-based) of the first retrieved passage from an expected source, or null. */
  hitRank?: number | null;
  /** In scope only: whether the answer cites at least one expected source. */
  citesExpected?: boolean;
  /** In scope only: how many key facts the answer states. */
  factsFound?: number;
  pass: boolean;
}

async function ask(question: string): Promise<Answer> {
  const started = Date.now();
  const res = await app.request('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ id: 'eval', role: 'user', parts: [{ type: 'text', text: question }] }],
    }),
  });
  if (!res.ok || !res.body)
    throw new Error(`POST /api/chat answered ${res.status}: ${await res.text()}`);

  // Rebuild the assistant message from the stream, the way the web app's useChat does.
  const chunks = parseJsonEventStream({
    stream: res.body,
    schema: uiMessageChunkSchema,
  }).pipeThrough(
    new TransformStream({
      transform(result, controller) {
        if (!result.success) throw result.error;
        controller.enqueue(result.value);
      },
    }),
  );
  let message: UIMessage | undefined;
  for await (const m of readUIMessageStream({ stream: chunks })) message = m;
  const parts = message?.parts ?? [];
  const errorPart = parts.find((p) => (p.type as string) === 'error');
  if (errorPart) throw new Error(`Answer stream failed: ${JSON.stringify(errorPart)}`);
  return {
    text: parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join(''),
    sources: parts.flatMap((p) =>
      p.type === 'data-source' ? [sourceSchema.parse((p as { data: unknown }).data)] : [],
    ),
    seconds: (Date.now() - started) / 1000,
  };
}

/** "Art. 5.2 — Termination for convenience" matches clause "5.2" (but "Art. 15.2" does not). */
function matches(source: Source, expected: ExpectedSource[]): boolean {
  const words = source.section.split(/\s+/);
  return expected.some((e) => source.documentName === e.document && words.includes(e.clause));
}

function citedIndexes(text: string): Set<number> {
  return new Set([...text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
}

function score(evalCase: EvalCase, answer: Answer): CaseResult {
  const refused = isRefusal(answer.text);
  if (!evalCase.expected) return { case: evalCase, answer, refused, pass: refused };

  const expected = evalCase.expected;
  const hitIndex = answer.sources.findIndex((s) => matches(s, expected));
  const cited = citedIndexes(answer.text);
  const citesExpected = answer.sources.some((s) => cited.has(s.index) && matches(s, expected));
  const facts = evalCase.facts ?? [];
  const lower = answer.text.toLowerCase();
  const factsFound = facts.filter((spellings) =>
    spellings.some((s) => lower.includes(s.toLowerCase())),
  ).length;
  return {
    case: evalCase,
    answer,
    refused,
    hitRank: hitIndex === -1 ? null : hitIndex + 1,
    citesExpected,
    factsFound,
    pass: !refused && hitIndex !== -1 && citesExpected && factsFound === facts.length,
  };
}

// ---------------------------------------------------------------- reporting

const pct = (n: number, of: number) =>
  of === 0 ? '–' : `${n}/${of} (${Math.round((n / of) * 100)}%)`;

function table(rows: string[][]): string {
  const widths = rows[0]!.map((_, c) => Math.max(...rows.map((r) => r[c]!.length)));
  const line = (r: string[]) => r.map((cell, c) => cell.padEnd(widths[c]!)).join('  ');
  return [
    line(rows[0]!),
    widths.map((w) => '─'.repeat(w)).join('  '),
    ...rows.slice(1).map(line),
  ].join('\n');
}

function report(results: CaseResult[]) {
  const header = [
    '#',
    'Case',
    'Best cosine',
    'Retrieved',
    'Cited',
    'Facts',
    'Refused',
    'Time',
    'Result',
  ];
  const rows = results.map((r, i) => {
    const scores = r.answer.sources.map((s) => s.score);
    const top = scores.length > 0 ? Math.max(...scores) : undefined;
    const inScope = Boolean(r.case.expected);
    return [
      String(i + 1),
      r.case.id,
      top === undefined ? '–' : top.toFixed(3),
      inScope ? (r.hitRank ? `yes (#${r.hitRank})` : 'no') : '–',
      inScope ? (r.citesExpected ? 'yes' : 'no') : '–',
      inScope ? `${r.factsFound}/${r.case.facts?.length ?? 0}` : '–',
      r.refused ? 'yes' : 'no',
      `${r.answer.seconds.toFixed(1)}s`,
      r.pass ? 'PASS' : 'FAIL',
    ];
  });
  console.log(`\n${table([header, ...rows])}\n`);

  const inScope = results.filter((r) => r.case.expected);
  const outOfScope = results.filter((r) => !r.case.expected);
  const totalFacts = inScope.reduce((n, r) => n + (r.case.facts?.length ?? 0), 0);
  const topK = Math.max(0, ...results.map((r) => r.answer.sources.length));
  console.log(
    table([
      ['Metric', 'Result'],
      [
        `Retrieval hit rate (expected clause in top ${topK})`,
        pct(inScope.filter((r) => r.hitRank).length, inScope.length),
      ],
      [
        'Answer cites the expected source',
        pct(inScope.filter((r) => r.citesExpected).length, inScope.length),
      ],
      [
        'Key facts stated',
        pct(
          inScope.reduce((n, r) => n + (r.factsFound ?? 0), 0),
          totalFacts,
        ),
      ],
      [
        'In-scope questions wrongly refused',
        pct(inScope.filter((r) => r.refused).length, inScope.length),
      ],
      [
        'Out-of-scope questions refused',
        pct(outOfScope.filter((r) => r.refused).length, outOfScope.length),
      ],
      ['Cases passed', pct(results.filter((r) => r.pass).length, results.length)],
    ]),
  );

  const shown = verbose ? results : results.filter((r) => !r.pass);
  if (shown.length > 0) {
    console.log(verbose ? '\nAnswers:' : '\nFailed cases:');
    for (const r of shown) {
      console.log(`\n[${r.case.id}] ${r.case.question}`);
      console.log(`  answer: ${r.answer.text.replace(/\s+/g, ' ').trim()}`);
      for (const s of r.answer.sources) {
        console.log(`  [${s.index}] ${s.score.toFixed(3)}  ${s.documentName} — ${s.section}`);
      }
    }
  }
}

// ---------------------------------------------------------------- main

let exitCode = 0;
try {
  console.log(
    `Chat model ${config.CHAT_MODEL}, embeddings ${config.EMBEDDING_MODEL}, relevance threshold ${config.MIN_RELEVANCE_SCORE}`,
  );
  console.log(`Seeding the sample contracts into temporary collection "${collection}" ...`);
  await providers.vectorStore.init();
  await seedSampleContracts(providers);

  const results: CaseResult[] = [];
  for (const [i, evalCase] of EVAL_CASES.entries()) {
    process.stdout.write(`  ${i + 1}/${EVAL_CASES.length} ${evalCase.id} ...`);
    const result = score(evalCase, await ask(evalCase.question));
    console.log(` ${result.pass ? 'pass' : 'FAIL'}`);
    results.push(result);
  }
  report(results);
} catch (err) {
  console.error(`\nEval failed: ${err instanceof Error ? err.message : String(err)}`);
  console.error('Are Qdrant and Ollama running and the models pulled? Run npm run setup.');
  exitCode = 1;
} finally {
  await providers.vectorStore.drop().catch((err: unknown) => {
    console.error(`Could not drop temporary collection "${collection}": ${String(err)}`);
  });
}
process.exit(exitCode);
