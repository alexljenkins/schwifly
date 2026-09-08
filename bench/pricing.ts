export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
  source: string;
}

/**
 * Live prices from OpenRouter's public model list. No key needed.
 *
 * A price table baked into the repository goes stale silently and makes an old report look
 * precise when it is not. A failed lookup leaves cost empty and the report says why, which is
 * the honest result. Token counts are recorded either way.
 */
export async function lookupPrice(model: string, timeoutMs = 15_000): Promise<ModelPrice | null> {
  const url = 'https://openrouter.ai/api/v1/models';
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    const body = await response.json() as { data?: { id?: string; pricing?: { prompt?: string; completion?: string } }[] };
    const entry = body.data?.find((candidate) => candidate.id === model);
    const input = Number(entry?.pricing?.prompt);
    const output = Number(entry?.pricing?.completion);
    if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
    return { inputPerMTok: input * 1e6, outputPerMTok: output * 1e6, source: url };
  } catch {
    return null;
  }
}

export function costUsd(
  price: ModelPrice | null,
  usage: { inputTokens: number; outputTokens: number },
): number | null {
  if (!price) return null;
  return (usage.inputTokens * price.inputPerMTok + usage.outputTokens * price.outputPerMTok) / 1e6;
}
