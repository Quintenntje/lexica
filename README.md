# Lexica

Lexica is a local-first assistant that answers questions about legal documents, with citations. Upload a contract (PDF, Markdown or plain text), ask a question in plain English, and Lexica:

- streams an answer that is grounded **only** in passages retrieved from your documents;
- cites the document and clause it relies on (for example `Art. 5.3 — Survival of confidentiality`); each citation opens the original passage in a side panel;
- says **"The answer was not found in the documents."** when that is the case, instead of guessing.

Everything runs on your machine: the vector database (Qdrant) and the models (Ollama with `nomic-embed-text` for embeddings and `qwen2.5:3b` for answers) run in Docker, so no document leaves it. Three fictional sample contracts ship with the repo, so the demo works right after setup.

**New to RAG, or preparing to explain this project?** Read the [architecture walkthrough](docs/architecture.md). It follows one contract from upload to cited answer, points at the module behind each stage and explains the tradeoffs.

The original spec is [issue #1](https://github.com/Quintenntje/lexica/issues/1).

## Prerequisites

- Node.js 22 or newer, and npm
- Docker (with Docker Compose)
- A few GB of free disk space for the models. No GPU needed: the models run on the CPU.

## Setup and run

```sh
npm install
npm run setup   # creates .env, starts Qdrant + Ollama (Docker Compose project "lexica"), pulls both models
npm run seed    # indexes the three sample contracts in samples/ into Qdrant
npm run dev     # API on http://localhost:8787, web app on http://localhost:5173
```

Open http://localhost:5173. The status indicator in the header says "All systems ready" when Qdrant, Ollama and both models are available; hover or focus it for details.

| Command                              | What it does                                                                                                                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run setup`                      | Copies `.env.example` to `.env` if missing, runs `docker compose up -d`, waits for Qdrant and Ollama, pulls `EMBEDDING_MODEL` and `CHAT_MODEL` inside the Ollama container (`scripts/setup.mjs`) |
| `npm run seed`                       | Indexes `samples/` through the same pipeline as uploads; safe to rerun (it replaces, not duplicates). Recreates the collection if its layout is outdated                                         |
| `npm run dev`                        | Runs the API (`tsx watch`) and the web app (Vite) together with hot reload                                                                                                                       |
| `npm test`                           | Runs the API tests (Vitest). No Docker needed: they use in-memory fake providers                                                                                                                 |
| `npm run eval`                       | Scores retrieval, citations, key facts and refusals on 13 questions against the real models and Qdrant (needs `npm run setup`); see [Evaluation](#evaluation)                                    |
| `npm run lint` / `npm run typecheck` | ESLint and strict TypeScript across the workspace                                                                                                                                                |
| `npm run format`                     | Prettier                                                                                                                                                                                         |

The Docker containers use the fixed Compose project name `lexica`, so every checkout shares the same containers and volumes. Stop them with `docker compose stop` when you are done.

### Configuration

All settings live in `.env` (see `.env.example`); the API validates them on startup (`packages/api/src/config.ts`).

| Variable               | Default                  | Meaning                                                                                                                      |
| ---------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `OLLAMA_URL`           | `http://localhost:11434` | Ollama server                                                                                                                |
| `QDRANT_URL`           | `http://localhost:6333`  | Qdrant server                                                                                                                |
| `QDRANT_COLLECTION`    | `lexica_chunks`          | Collection holding the chunks                                                                                                |
| `EMBEDDING_MODEL`      | `nomic-embed-text`       | Embedding model in Ollama                                                                                                    |
| `EMBEDDING_DIMENSIONS` | `768`                    | Vector size of the embedding model; sizes the collection                                                                     |
| `CHAT_MODEL`           | `qwen2.5:3b`             | Chat model in Ollama. On a slow machine use `qwen2.5:1.5b` (then run `npm run setup` again to pull it)                       |
| `MIN_RELEVANCE_SCORE`  | `0.6`                    | Minimum cosine similarity a passage needs to count as relevant. If none reaches it, Lexica refuses without calling the model |
| `API_PORT`             | `8787`                   | API port; the web dev server proxies `/api` to it                                                                            |

Changing the embedding model means re-indexing: run `npm run seed` and upload your own documents again.

## Demo flow

A tour that shows every part of the pipeline. Answers come from a 3B model on a CPU: on the development laptop a full answer took **one to two and a half minutes** (the sources appear within seconds, then the text streams in slowly), so pick two or three questions for a live demo, or switch to `qwen2.5:1.5b`. The wording varies between runs, and the small model sometimes puts its citation markers at the start of a sentence or repeats a passage's heading; the facts and the cited clauses below are what it returned in testing.

1. **Documents page.** Open _Documents_: the three sample contracts are listed with their type, number of chunks and date.
   - `mutual-nda-quillmere-tessellate.md`: a mutual NDA between Quillmere Analytics (Amsterdam) and Tessellate Health (Leeds)
   - `saas-terms-larkspur-ledger.md`: SaaS terms of service of Larkspur Ledger, a bookkeeping platform (Delaware)
   - `employment-agreement-osterby-robotics.md`: an employment agreement at Osterby Robotics (Bristol)
2. **A cited answer.** Open _Chat_ and click an example question, or type one:

   | Question                                                                    | Expected answer                                                                                               | Source                         |
   | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------ |
   | How long do the confidentiality obligations of the NDA survive termination? | Five years after expiry or termination; trade secrets for as long as they remain trade secrets                | NDA, Art. 5.3                  |
   | What notice period applies after the probationary period?                   | At least two months' written notice, rising for the employer after five years of service (up to twelve weeks) | Employment agreement, Art. 8.1 |
   | Is Larkspur's liability capped, and at what amount?                         | Yes: the fees paid or payable in the twelve months before the claim                                           | SaaS terms, Art. 9.1           |
   | What happens to customer data when the subscription ends?                   | Thirty days to export it, then deletion within a further sixty days                                           | SaaS terms, Art. 5.3           |

   Click a citation badge to open the passage in the side panel (document, section, page for PDFs, similarity score). The list under the answer shows every passage that was retrieved.

3. **Across documents.** Ask _"Which law governs each contract?"_ or _"Which contracts can be terminated with thirty days' notice?"_. Point at the source list here, not the answer text: retrieval finds the right clauses in every contract (all three governing-law clauses; NDA Art. 5.2 and SaaS terms Art. 10.2 for the notice question), but the 3B model often answers multi-part questions incompletely. In testing it named only two of the three governing laws, and once answered with nothing but the citation markers `[1] [2]`. That is a good talking point: retrieval worked and the small model is the weak link, which is why retrieval and answer quality are measured separately (see [Evaluation](#evaluation)) and why a stronger model is the first production upgrade.
4. **Exact terms.** Ask about a clause by number or a defined term, such as _"What does clause 7.2 of the NDA say about liability?"_ (retrieves NDA Art. 7.2 first) or _"What is Customer Data?"_ (retrieves the definition in SaaS terms Art. 1.1). Hybrid search matches the exact words as well as the meaning. Notice that the clause-number question also pulls in the employment agreement's Art. 7.2: keyword search matches "7.2" in any contract.
5. **Refusal, two ways.** Lexica shows a calm "Not found in the documents" notice and lists the closest passages, so you can see how near the search came. There are two layers behind it, and you can show both:
   - _"What is the capital of France?"_: no passage reaches `MIN_RELEVANCE_SCORE` (the best scores about 0.56), so the API refuses **without calling the model**, and the answer is instant.
   - _"What is the company's parental leave policy?"_ or _"Can I bring my dog to the office?"_: these sound like employment-contract topics, so a few passages score just above the threshold (about 0.65) and the model is called. It gets passages about garden leave and the place of work, sees they do not answer the question and replies with the refusal sentence itself, as the prompt instructs. This one takes as long as a normal answer.
6. **Your own document.** On _Documents_, drop a `.pdf`, `.md` or `.txt` file (max 20 MB). It is parsed, chunked, embedded and stored before the upload finishes; then ask about it. Uploading a file with the same name replaces the old version; deleting a document removes all its passages from search.
7. **Controls.** Stop an answer mid-stream with the stop button, start over with _New chat_, and switch between light and dark mode in the header.

If the status indicator is not green, or the chat shows a red error, a dependency is down: run `npm run setup` again. A red error is a system problem; a "not found" notice is a real answer.

## How it works

```
upload ─► parse ─► chunk by clause ─► embed ─► store (Qdrant: dense + BM25 vectors)
                                                          │
question ─► embed ─► hybrid search (top 5) ◄──────────────┘
              ─► any passage ≥ MIN_RELEVANCE_SCORE?  no ─► fixed refusal (model not called)
              ─► yes ─► prompt with numbered passages ─► stream answer ─► map [n] citations ─► UI
```

The [architecture walkthrough](docs/architecture.md) explains every step. The code is organised as an npm workspaces monorepo:

```
packages/
  shared/  Zod schemas and types for every API request and response, used by both sides
  api/     Hono server that owns the whole RAG pipeline
    src/pipeline/   parser, chunker, indexer, retriever, relevance, prompt, citations, seed
    src/providers/  Embedder, ChatModel and VectorStore interfaces + Ollama and Qdrant implementations
    src/routes/     /api/health, /api/documents, /api/chat
    test/           HTTP-level tests with in-memory fake providers
  web/     Vite + React app: features/chat, features/documents, features/health
samples/   three fictional contracts with numbered articles and clauses
docs/      architecture walkthrough
```

### API

| Endpoint                    | Purpose                                                                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`           | Whether Qdrant and Ollama are reachable and both models are pulled                                                                 |
| `GET /api/documents`        | Indexed documents (derived from the stored chunks: there is no separate database)                                                  |
| `POST /api/documents`       | Multipart upload of one file in the `file` field; returns the document summary                                                     |
| `DELETE /api/documents/:id` | Removes a document and all its chunks                                                                                              |
| `POST /api/chat`            | Answers the latest user message as an AI SDK UI message stream: one `data-source` part per retrieved passage, then the answer text |

Errors always have the shape `{ "error": { "code": "...", "message": "..." } }`.

## Design choices

- **Chunking follows legal structure.** Articles and numbered clauses become chunks, capped at 1,200 characters with a 150-character overlap for long clauses. Citations name the clause a lawyer would cite, and no chunk mixes two clauses.
- **Grounded or nothing.** A relevance threshold refuses before the model is called; the prompt allows only the numbered passages and demands an exact refusal sentence otherwise; citations to non-existent passages are dropped; every claim links to its source text.
- **Hybrid search.** Semantic (dense) search for paraphrased questions, keyword (BM25) search for exact terms and clause numbers, fused with reciprocal rank fusion inside Qdrant (details below).
- **Local-first for confidentiality.** Models and database run on your machine. Documents never leave it.
- **Providers behind interfaces.** `Embedder`, `ChatModel` and `VectorStore` are the swap point between local and cloud models, and the test seam: the API is built by an app factory that receives its providers.
- **Tests at the HTTP boundary.** Tests send real HTTP requests to the app with fake providers (a deterministic embedder, a scripted chat model that records its prompt, an in-memory vector store) and assert only what is visible at the API. They run without Docker.
- **One source of truth for shapes.** Zod schemas in `packages/shared` validate requests on the API and responses in the web app.
- **Single-turn retrieval.** Each question is answered on its own; earlier messages are shown but not used, and nothing is persisted.

What a production version would add (authentication and per-client access control, chat history, reranking, OCR, multilingual support, and more) is listed at the end of the [walkthrough](docs/architecture.md#part-4-what-a-production-version-would-add).

## Sample contracts

`samples/` holds three fictional English contracts (a mutual NDA, SaaS terms of service and an employment agreement) between invented companies. They use numbered articles and clauses, so citations like "Art. 7.2" are meaningful, and they share topics such as termination, confidentiality, liability, IP, governing law and notice periods, so cross-document questions are interesting. `npm run seed` runs them through the same parse → chunk → embed → store pipeline that uploads use; running it again replaces the earlier chunks instead of duplicating them.

## Hybrid search

Retrieval combines two searches in Qdrant and fuses them with reciprocal rank fusion (Qdrant's query API with two prefetches):

- **Semantic** (dense vector `dense`, cosine): finds passages with a similar meaning.
- **Keyword** (sparse vector `bm25`, computed by Qdrant from the text with IDF): finds passages containing the exact words, so legal terms and clause numbers such as "force majeure" or "Art. 7.2" match reliably.

The fused ranking only decides the order of the passages. Each passage keeps its **cosine similarity** as its score (what the source panel shows and what the relevance threshold compares against), because fused scores are rank-based and say nothing about how relevant a passage is.

### Upgrading an existing collection

Collections created before hybrid search hold one unnamed vector and cannot be converted in place. The API detects this on startup and logs (and returns 503 for chat) asking you to reseed. To upgrade, run:

```sh
npm run seed
```

The seed command deletes and recreates the collection (`QDRANT_COLLECTION`, default `lexica_chunks`) in the new layout and indexes the sample contracts again. Documents you uploaded yourself are removed with it: upload them again afterwards. The same applies when `EMBEDDING_DIMENSIONS` no longer matches the collection.

## Evaluation

`npm test` checks the pipeline's behaviour with fake models; it cannot tell whether the real models retrieve the right clauses and answer well. The evaluation script measures that against the real stack, scoring retrieval, citations and refusals separately.

```sh
npm run eval              # needs Qdrant + Ollama running (npm run setup)
npm run eval -- --verbose # also prints every answer with its retrieved passages
```

The eval asks the 13 questions in `packages/api/src/eval/cases.ts` through the real stack: the same `POST /api/chat` handler the web app uses, with the real Ollama models and Qdrant. Ten questions have a known answer in the sample contracts (expected document + clause, and the key facts the answer must state); three are not answered by the documents, so the only correct answer is the refusal sentence.

It seeds the sample contracts into a temporary Qdrant collection (`lexica_eval_<timestamp>`) and drops it afterwards, so your own `lexica_chunks` collection and uploads are never touched.

It prints one row per question and a summary:

- **Retrieval hit rate**: the expected clause is among the top-k retrieved passages (and at which rank).
- **Answer cites the expected source**: one of the answer's `[n]` markers points to a passage from the expected clause.
- **Key facts stated**: the answer contains the expected facts (e.g. "30 days", "GBP 68,000").
- **Out-of-scope questions refused** and **in-scope questions wrongly refused**.

A case passes when its passage was retrieved, cited, all facts were stated and it was not refused (or, out of scope, when it was refused). Answers come from a small local model, so results vary a little between runs and machines; failed cases are printed with their answer and retrieved passages to see where it went wrong.

## Troubleshooting

- **Status indicator shows "Services degraded"**: hover it to see which part is missing. Run `npm run setup` to start the containers and pull the models.
- **Chat says the document search is unavailable (503)**: Qdrant or Ollama is not reachable, or the collection needs a reseed (the API log says which). Run `npm run setup`, then `npm run seed` if asked.
- **Answers are very slow**: set `CHAT_MODEL=qwen2.5:1.5b` in `.env`, run `npm run setup` to pull it and restart `npm run dev`.
- **Too many or too few "not found" answers**: adjust `MIN_RELEVANCE_SCORE` in `.env` (lower answers more, higher refuses more) and restart the API.
