# Lexica

Local-first RAG assistant that answers questions about legal documents with citations.

See the spec: https://github.com/Quintenntje/lexica/issues/1

## Quickstart

Prerequisites: Node.js 22+, npm and Docker.

```sh
npm install
npm run setup   # creates .env, starts Qdrant + Ollama (Docker Compose project "lexica"), pulls the models
npm run seed    # indexes the three fictional sample contracts in samples/ into Qdrant
npm run dev     # API on http://localhost:8787, web app on http://localhost:5173
```

Other scripts: `npm run lint`, `npm run typecheck`, `npm test`, `npm run format`.

Configuration lives in `.env` (see `.env.example`): service URLs, `QDRANT_COLLECTION`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, `CHAT_MODEL`, `MIN_RELEVANCE_SCORE` (below it Lexica answers "not found in the documents" without calling the model) and `API_PORT`.

## Sample contracts

`samples/` holds three fictional English contracts (a mutual NDA, SaaS terms of service and an employment agreement) between invented companies. They share topics such as termination, confidentiality, liability, IP, governing law and notice periods, so cross-document questions are interesting. `npm run seed` runs them through the same parse → chunk → embed → store pipeline that uploads use; running it again replaces the earlier chunks instead of duplicating them.

## Hybrid search

Retrieval combines two searches in Qdrant and fuses them with reciprocal rank fusion (Qdrant's query API with two prefetches):

- **Semantic** (dense vector `dense`, cosine): finds passages with a similar meaning.
- **Keyword** (sparse vector `bm25`, computed by Qdrant from the text with IDF): finds passages containing the exact words, so legal terms and clause numbers such as "force majeure" or "Art. 7.2" match reliably.

The fused ranking only decides the order of the passages. Each passage keeps its **cosine similarity** as its score (what the source panel shows and what a relevance threshold compares against), because fused scores are rank-based and say nothing about how relevant a passage is.

### Upgrading an existing collection

Collections created before hybrid search hold one unnamed vector and cannot be converted in place. The API detects this on startup and logs (and returns 503 for chat) asking you to reseed. To upgrade, run:

```sh
npm run seed
```

The seed command deletes and recreates the collection (`QDRANT_COLLECTION`, default `lexica_chunks`) in the new layout and indexes the sample contracts again. Documents you uploaded yourself are removed with it: upload them again afterwards. The same applies when `EMBEDDING_DIMENSIONS` no longer matches the collection.

## Evaluation

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
