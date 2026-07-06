/**
 * DeepSeek chat client — OpenAI-compatible REST endpoint, called via fetch
 * (no SDK, no new dependency). Used by the translation harness.
 *
 * Config (env):
 *   DEEPSEEK_API_KEY   required to enable AI translation
 *   DEEPSEEK_MODEL     default 'deepseek-chat'
 *   DEEPSEEK_BASE_URL  default 'https://api.deepseek.com/v1'
 */

const BASE_URL = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1';
const MODEL = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat';
/* deepseek-chat cache-miss pricing, USD per 1M tokens (input, output). */
const PRICE_IN = 0.27;
const PRICE_OUT = 1.10;

export type DeepseekUsage = {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  calls: number;
};

export type ChatResult = { content: string; usage: DeepseekUsage };

export function isDeepseekConfigured(): boolean {
  return !!process.env.DEEPSEEK_API_KEY;
}

export function emptyUsage(): DeepseekUsage {
  return { inputTokens: 0, outputTokens: 0, costUsd: 0, calls: 0 };
}

export function addUsage(a: DeepseekUsage, b: DeepseekUsage): DeepseekUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    costUsd: Math.round((a.costUsd + b.costUsd) * 1e6) / 1e6,
    calls: a.calls + b.calls,
  };
}

const MAX_RETRIES = 4;
const INITIAL_BACKOFF_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * One chat completion. `json` forces a JSON object response. Retries on 429
 * with exponential backoff, honoring Retry-After. Throws on persistent failure.
 */
export async function deepseekChat(opts: {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  timeoutMs?: number;
}): Promise<ChatResult> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error('DEEPSEEK_API_KEY not set');

  const body: Record<string, unknown> = {
    model: MODEL,
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user },
    ],
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.maxTokens ?? 1200,
  };
  if (opts.json) body.response_format = { type: 'json_object' };

  let backoff = INITIAL_BACKOFF_MS;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
      });
    } catch (e) {
      // Network/timeout — retry a couple times, then give up.
      if (attempt < MAX_RETRIES - 1) { await sleep(backoff); backoff *= 2; continue; }
      throw new Error(`DeepSeek request failed: ${(e as Error).message}`);
    }

    if (res.status === 429 && attempt < MAX_RETRIES - 1) {
      // Retry-After may be seconds or an HTTP-date; only trust a finite positive number.
      const ra = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : backoff);
      backoff *= 2;
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`DeepSeek HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = data.choices?.[0]?.message?.content ?? '';
    const inT = data.usage?.prompt_tokens ?? 0;
    const outT = data.usage?.completion_tokens ?? 0;
    return {
      content: content.trim(),
      usage: {
        inputTokens: inT,
        outputTokens: outT,
        costUsd: Math.round((inT * PRICE_IN + outT * PRICE_OUT) / 1e6 * 1e6) / 1e6,
        calls: 1,
      },
    };
  }
  throw new Error('DeepSeek: exhausted retries');
}
