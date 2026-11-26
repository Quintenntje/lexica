/**
 * Seed command: indexes the fictional sample contracts into Qdrant so the demo
 * works right after setup. Usage (from the repo root): npm run seed
 */
import { loadConfig, loadEnvFile } from '../config';
import { seedSampleContracts, SAMPLES_DIR } from '../pipeline/seed';
import { createProviders } from '../providers';

loadEnvFile();
const providers = createProviders(loadConfig());

try {
  // A collection in an outdated layout (e.g. from before hybrid search) is recreated empty.
  const { rebuilt } = await providers.vectorStore.init({ rebuildIfOutdated: true });
  if (rebuilt) {
    console.log(
      'Recreated the Qdrant collection in the current layout (hybrid search). ' +
        'Documents uploaded before must be uploaded again.',
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
