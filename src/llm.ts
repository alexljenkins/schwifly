import type { ModelConfiguration } from '@browserbasehq/stagehand';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { MODEL_TIMEOUT_MS, bounded } from './limits.js';

export const DEFAULT_MODEL = 'google/gemini-3.8-flash';
export const OPENROUTER_URL = 'https://openrouter.ai/api/v1';
export interface LlmConfig { model: ModelConfiguration }
type ModelObject = Exclude<ModelConfiguration, string>;

export class ProviderError extends Error {
  constructor(message: string) { super(message); this.name = 'ProviderError'; }
}

function providerError(error: unknown): ProviderError {
  const status = (error as { statusCode?: number })?.statusCode;
  const reason = status === 401 || status === 403 ? 'authentication failed; check OPENROUTER_API_KEY'
    : status === 402 ? 'budget exhausted; check OpenRouter credit and key limits'
    : status === 429 ? 'rate limit reached; retry later'
    : 'request failed or timed out';
  // A plain error prevents the AI SDK from retrying provider errors. Never include request bodies.
  return new ProviderError(`OpenRouter ${reason}${status ? ` (HTTP ${status})` : ''}`);
}

/** One model configuration covers observe, extract, and the DOM agent. No automatic retries. */
export function sessionModel(signal?: AbortSignal, onError?: (error: ProviderError) => void): ModelObject {
  const modelId = process.env.SCHWIFLY_MODEL ?? DEFAULT_MODEL;
  const apiKey = process.env.OPENROUTER_API_KEY;
  let calls = 0;
  const middleware: NonNullable<ModelObject['middleware']> = {
    transformParams: async ({ params }) => ({
      ...params,
      abortSignal: AbortSignal.any([
        AbortSignal.timeout(MODEL_TIMEOUT_MS),
        ...(signal ? [signal] : []),
        ...(params.abortSignal ? [params.abortSignal] : []),
      ]),
    }),
    wrapGenerate: async ({ doGenerate, params }) => {
      const fail = (message: string): never => { const error = new ProviderError(message); onError?.(error); throw error; };
      if (!apiKey || process.env.SCHWIFLY_NO_HEAL === '1') fail('model calls are disabled');
      if (++calls > 36) fail('model call limit reached');
      const log = process.env.SCHWIFLY_MODEL_LOG;
      if (log) {
        mkdirSync(dirname(log), { recursive: true });
        appendFileSync(log, JSON.stringify({ model: modelId, call: calls }) + '\n');
      }
      try { return await bounded(Promise.resolve(doGenerate()), params.abortSignal!); }
      catch (error) {
        const failure = providerError(error);
        onError?.(failure);
        throw failure;
      }
    },
  };
  return {
    modelName: `openai/${modelId}`,
    apiKey: apiKey || 'offline',
    baseURL: OPENROUTER_URL,
    openaiEndpointFormat: 'chat',
    middleware,
  };
}

/** Is a provider key configured? Callers that only need this must not build a session model. */
export function hasModelKey(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

export function llmConfigFromEnv(): LlmConfig | null {
  return hasModelKey() ? { model: sessionModel() } : null;
}
