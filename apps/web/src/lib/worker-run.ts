/** Wrapper that records a worker run in `worker_run`. Inserts a row in
 * 'running' state, executes `fn`, then finalizes with success counts or
 * error summary. Always closes the row even when fn throws. */
import { db, schema } from '~/lib/db';
import { eq } from 'drizzle-orm';

export interface WorkerRunCtx {
  runId: number;
  addItems: (n: number) => void;
  addError: (msg: string) => void;
}

export async function recordWorkerRun<T>(
  worker: string,
  fn: (ctx: WorkerRunCtx) => Promise<T>,
): Promise<T> {
  const [inserted] = await db
    .insert(schema.workerRun)
    .values({ worker, status: 'running' })
    .returning({ id: schema.workerRun.id });
  const runId = inserted!.id;

  let items = 0;
  let errors = 0;
  const errorMsgs: string[] = [];
  const ctx: WorkerRunCtx = {
    runId,
    addItems: (n: number) => { items += n; },
    addError: (msg: string) => { errors += 1; errorMsgs.push(msg); },
  };

  try {
    const result = await fn(ctx);
    await db
      .update(schema.workerRun)
      .set({
        status: errors > 0 ? 'error' : 'success',
        itemsProcessed: items,
        errorsCount: errors,
        errorSummary: errorMsgs.length ? errorMsgs.slice(0, 20).join('\n') : null,
        finishedAt: new Date(),
      })
      .where(eq(schema.workerRun.id, runId));
    return result;
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    await db
      .update(schema.workerRun)
      .set({
        status: 'error',
        itemsProcessed: items,
        errorsCount: errors + 1,
        errorSummary: [msg, ...errorMsgs].slice(0, 20).join('\n'),
        finishedAt: new Date(),
      })
      .where(eq(schema.workerRun.id, runId));
    throw err;
  }
}
