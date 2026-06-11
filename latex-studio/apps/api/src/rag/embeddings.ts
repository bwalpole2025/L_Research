/**
 * Client for the mathcheck /embed endpoint (local sentence-transformers). The
 * api never embeds in-process — embeddings are computed by the mathcheck service,
 * keeping the single offline-first model in one place and the api dependency-free.
 */

export interface EmbedResult {
  vectors: number[][];
  model: string;
  dim: number;
}

export async function embedTexts(mathcheckUrl: string, texts: string[], timeoutMs = 60000): Promise<EmbedResult> {
  if (texts.length === 0) return { vectors: [], model: '', dim: 0 };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${mathcheckUrl}/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ texts }),
      signal: ac.signal,
    });
    const data = (await res.json()) as { vectors?: number[][]; model?: string; dim?: number; error?: string };
    if (data.error || !Array.isArray(data.vectors)) {
      throw new Error(data.error ?? 'embedding service returned no vectors');
    }
    return { vectors: data.vectors, model: data.model ?? '', dim: data.dim ?? (data.vectors[0]?.length ?? 0) };
  } finally {
    clearTimeout(timer);
  }
}

/** Embed a single query string → its vector (throws if the service is unavailable). */
export async function embedQuery(mathcheckUrl: string, text: string): Promise<number[]> {
  const { vectors } = await embedTexts(mathcheckUrl, [text]);
  const v = vectors[0];
  if (!v) throw new Error('no embedding returned for query');
  return v;
}

export async function embeddingAvailable(mathcheckUrl: string, timeoutMs = 5000): Promise<boolean> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${mathcheckUrl}/embed/health`, { signal: ac.signal });
    const data = (await res.json()) as { available?: boolean };
    return data.available === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
