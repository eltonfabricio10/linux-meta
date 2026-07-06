/* Ops script: backfill missing EN package_embedding rows via local Ollama.
 * Reuses lib/embeddings (same path the admin button uses). Resumable —
 * skips packages that already have an embedding. Run:
 *   pnpm --filter @linux-meta/web exec tsx src/_backfill-embeddings.ts
 * Env: BATCH (default 500). */
import { generateMissingEmbeddings, countMissingEmbeddings, isOllamaReachable } from './lib/embeddings.ts';

const BATCH = Number(process.env.BATCH ?? 500);

if (!(await isOllamaReachable())) {
  console.error('[backfill] Ollama is not reachable — aborting.');
  process.exit(1);
}

let total = 0;
let remaining = await countMissingEmbeddings();
console.log(`[backfill] start: ${remaining} missing, batch ${BATCH}`);

while (remaining > 0) {
  const r = await generateMissingEmbeddings(BATCH);
  total += r.processed;
  remaining = r.remaining;
  console.log(`[backfill] +${r.processed} (${r.failed} failed) · ${remaining} remaining · ${total} done`);
  if (r.processed === 0) {
    console.log('[backfill] no progress this batch — stopping.');
    break;
  }
}

console.log(`[backfill] done: ${total} generated, ${remaining} remaining`);
process.exit(0);
