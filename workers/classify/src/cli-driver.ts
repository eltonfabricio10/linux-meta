/** Spawn `claude` (or `codex`) CLI in print mode, parse JSON wrapper, extract
 *  the assistant's `result` text, then parse it as JSON. */

import { spawn } from 'node:child_process';

export type CliKind = 'claude' | 'codex';

export type RawResult = {
  ok: true;
  text: string;
  costUsd: number | null;
  durationMs: number;
  sessionId: string | null;
} | {
  ok: false;
  error: string;
  durationMs: number;
};

export async function callCli(
  prompt: string,
  opts: {
    kind?: CliKind;
    model?: string;
    timeoutMs?: number;
  } = {},
): Promise<RawResult> {
  const kind = opts.kind ?? 'claude';
  const model = opts.model ?? 'haiku';
  const timeoutMs = opts.timeoutMs ?? 90_000;

  const args =
    kind === 'claude'
      ? [
          '-p', prompt,
          '--output-format', 'json',
          '--model', model,
          '--max-turns', '1',
          '--disallowedTools', 'Bash,Edit,Write,Read,WebSearch,WebFetch,Agent,TaskCreate',
        ]
      : ['exec', '--json', prompt];

  const t0 = Date.now();
  return new Promise((resolve) => {
    const child = spawn(kind, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (c) => out.push(c));
    child.stderr.on('data', (c) => err.push(c));

    const killer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 3_000);
    }, timeoutMs);

    child.on('error', (e) => {
      clearTimeout(killer);
      resolve({ ok: false, error: `spawn: ${e.message}`, durationMs: Date.now() - t0 });
    });

    child.on('close', (code) => {
      clearTimeout(killer);
      const durationMs = Date.now() - t0;
      const stdout = Buffer.concat(out).toString('utf8');
      const stderr = Buffer.concat(err).toString('utf8');

      if (code !== 0) {
        resolve({
          ok: false,
          error: `exit=${code} stderr=${stderr.slice(0, 500)}`,
          durationMs,
        });
        return;
      }

      try {
        const wrapper = JSON.parse(stdout);
        if (kind === 'claude') {
          // claude --output-format json emits an array of events; the last
          // `{type:"result", subtype:"success"}` carries the assistant text.
          const events = Array.isArray(wrapper) ? wrapper : [wrapper];
          const final = [...events].reverse().find(
            (e) => e && typeof e === 'object' && e.type === 'result',
          );
          if (final?.subtype === 'success' && typeof final.result === 'string') {
            resolve({
              ok: true,
              text: final.result,
              costUsd: typeof final.total_cost_usd === 'number' ? final.total_cost_usd : null,
              sessionId: final.session_id ?? null,
              durationMs,
            });
          } else {
            resolve({
              ok: false,
              error: `claude no success event: ${JSON.stringify(final ?? events[events.length - 1]).slice(0, 400)}`,
              durationMs,
            });
          }
        } else {
          // codex `exec --json` streams JSON lines; last assistant message holds output.
          resolve({ ok: true, text: stdout, costUsd: null, sessionId: null, durationMs });
        }
      } catch (e) {
        resolve({
          ok: false,
          error: `parse wrapper: ${(e as Error).message} raw=${stdout.slice(0, 300)}`,
          durationMs,
        });
      }
    });
  });
}

/** Pull the first balanced JSON object from a string. Tolerates pre/post text. */
export function extractJson(text: string): unknown | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
