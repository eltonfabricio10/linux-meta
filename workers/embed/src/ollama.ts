/** Minimal Ollama embeddings client. */
const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434';
export const EMBED_MODEL = process.env.EMBED_MODEL ?? 'nomic-embed-text';
export const EMBED_DIM = 768;

export async function embed(text: string): Promise<number[]> {
  const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
  });
  if (!res.ok) {
    throw new Error(`ollama http ${res.status}: ${await res.text().catch(() => '')}`);
  }
  const j = (await res.json()) as { embedding?: number[] };
  if (!Array.isArray(j.embedding)) throw new Error('ollama: missing embedding');
  if (j.embedding.length !== EMBED_DIM) {
    throw new Error(`ollama: expected ${EMBED_DIM} dims, got ${j.embedding.length}`);
  }
  return j.embedding;
}
