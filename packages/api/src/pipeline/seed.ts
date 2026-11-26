import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileTypeFromName, type DocumentSummary } from '@lexica/shared';
import type { Providers } from '../providers/types';
import { indexDocument } from './indexer';

/** The fictional sample contracts that ship with the repo (`/samples`). */
export const SAMPLES_DIR = fileURLToPath(new URL('../../../../samples', import.meta.url));

/**
 * Indexes every sample contract through the same pipeline as uploads.
 * Safe to run repeatedly: re-indexing a name replaces its earlier chunks.
 */
export async function seedSampleContracts(
  providers: Providers,
  dir: string = SAMPLES_DIR,
): Promise<DocumentSummary[]> {
  const summaries: DocumentSummary[] = [];
  for (const name of (await readdir(dir)).sort()) {
    const fileType = fileTypeFromName(name);
    if (!fileType) continue;
    const data = await readFile(join(dir, name));
    summaries.push(await indexDocument(providers, { name, fileType, data }));
  }
  return summaries;
}
