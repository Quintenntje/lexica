# Lexica

Local-first RAG assistant that answers questions about legal documents with citations.

See the spec: https://github.com/Quintenntje/lexica/issues/1

## Quickstart

Prerequisites: Node.js 22+, npm and Docker.

```sh
npm install
npm run setup   # creates .env, starts Qdrant + Ollama (Docker Compose project "lexica"), pulls the models
npm run dev     # API on http://localhost:8787, web app on http://localhost:5173
```

Other scripts: `npm run lint`, `npm run typecheck`, `npm test`, `npm run format`.

Configuration lives in `.env` (see `.env.example`): service URLs, `EMBEDDING_MODEL`, `CHAT_MODEL` and `API_PORT`.
