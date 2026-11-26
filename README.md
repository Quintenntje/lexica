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

Configuration lives in `.env` (see `.env.example`): service URLs, `QDRANT_COLLECTION`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, `CHAT_MODEL` and `API_PORT`.

## Sample contracts

`samples/` holds three fictional English contracts (a mutual NDA, SaaS terms of service and an employment agreement) between invented companies. They share topics such as termination, confidentiality, liability, IP, governing law and notice periods, so cross-document questions are interesting. `npm run seed` runs them through the same parse → chunk → embed → store pipeline that uploads use; running it again replaces the earlier chunks instead of duplicating them.
