/**
 * Seed command: indexes the fictional sample contracts into Qdrant so the demo
 * works right after setup. Usage (from the repo root): npm run seed
 *
 * Destructive in one case: a collection in an outdated layout (one created
 * before hybrid search) is deleted and recreated, which removes every document
 * in it, uploads included. The command then prints a warning.
 */
import { bootstrap } from '../bootstrap';
import { seedSampleContracts, SAMPLES_DIR } from '../pipeline/seed';

const { config, providers } = bootstrap();

try {
  const { rebuilt } = await providers.vectorStore.init({ rebuildIfOutdated: true });
  if (rebuilt) {
    console.warn(
      [
        '',
        `WARNING: the Qdrant collection "${config.QDRANT_COLLECTION}" used an outdated layout`,
        '(from before hybrid search), so it was DELETED and recreated empty.',
        'Every document that was in it is gone, including documents you uploaded yourself.',
        'Only the sample contracts are indexed again below: upload your own documents again.',
        '',
      ].join('\n'),
    );
  }
  console.log(`Indexing sample contracts from ${SAMPLES_DIR} ...`);
  const started = Date.now();
  for (const doc of await seedSampleContracts(providers)) {
    console.log(`  ✓ ${doc.name} (${doc.chunkCount} chunks)`);
  }
  console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
} catch (err) {
  console.error(`Seeding failed: ${err instanceof Error ? err.message : String(err)}`);
  console.error('Are Qdrant and Ollama running and the models pulled? Run npm run setup.');
  process.exit(1);
}
