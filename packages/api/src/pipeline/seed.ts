import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DocumentSummary, FileType } from '@lexica/shared';
import type { Providers } from '../providers/types';
import { indexDocument } from './indexer';

/** The fictional sample contracts that ship with the repo (`/samples`). */
export const SAMPLES_DIR = fileURLToPath(new URL('../../../../samples', import.meta.url));

const FILE_TYPES: Record<string, FileType> = { '.md': 'md', '.txt': 'txt', '.pdf': 'pdf' };

/**
 * Indexes every sample contract through the same pipeline as uploads.
 * Safe to run repeatedly: re-indexing a name replaces its earlier chunks.
 */
export async function seedSampleContracts(
  providers: Providers,
  dir: string = SAMPLES_DIR,
): Promise<DocumentSummary[]> {
  const files = (await readdir(dir)).filter((f) => extname(f) in FILE_TYPES).sort();
  const summaries: DocumentSummary[] = [];
  for (const name of files) {
    const data = await readFile(join(dir, name));
    summaries.push(
      await indexDocument(providers, { name, fileType: FILE_TYPES[extname(name)]!, data }),
    );
  }
  return summaries;
}
