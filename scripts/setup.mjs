#!/usr/bin/env node
/**
 * One-command setup: creates .env from .env.example if missing, starts Qdrant
 * and Ollama with Docker Compose, waits until both answer, then pulls the
 * embedding and chat models into Ollama.
 *
 * Usage: npm run setup
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const envPath = `${root}.env`;

if (!existsSync(envPath)) {
  copyFileSync(`${root}.env.example`, envPath);
  console.log('Created .env from .env.example');
}
process.loadEnvFile(envPath);

const {
  OLLAMA_URL = 'http://localhost:11434',
  QDRANT_URL = 'http://localhost:6333',
  EMBEDDING_MODEL = 'nomic-embed-text',
  CHAT_MODEL = 'qwen2.5:3b',
} = process.env;

function run(command, args) {
  console.log(`\n$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`\nCommand failed with exit code ${result.status}.`);
    process.exit(result.status ?? 1);
  }
}

async function waitFor(name, url, timeoutMs = 120_000) {
  process.stdout.write(`Waiting for ${name} at ${url} `);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        console.log('ready');
        return;
      }
    } catch {
      // not up yet
    }
    process.stdout.write('.');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  console.error(`\n${name} did not become ready within ${timeoutMs / 1000}s.`);
  process.exit(1);
}

run('docker', ['compose', 'up', '-d']);

await waitFor('Qdrant', new URL('/healthz', QDRANT_URL));
await waitFor('Ollama', new URL('/api/tags', OLLAMA_URL));

// Pull inside the container so no local Ollama install is needed.
for (const model of [EMBEDDING_MODEL, CHAT_MODEL]) {
  run('docker', ['compose', 'exec', 'ollama', 'ollama', 'pull', model]);
}

console.log(`\nSetup complete. Models ready: ${EMBEDDING_MODEL}, ${CHAT_MODEL}`);
console.log('Next: npm run dev');
