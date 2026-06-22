import { loadApiKeyFromEnv, type ModelConfiguration } from '@browserbasehq/stagehand';

// The env -> model seam. ~20 lines, vendor-agnostic: ONE env var (SCHWIFLY_MODEL) picks the
// provider+model; Gemini is the default. Stagehand owns the provider -> API-key mapping
// (google -> GEMINI_API_KEY | GOOGLE_GENERATIVE_AI_API_KEY | GOOGLE_API_KEY), so we never
// hand-roll that table -- we just ask Stagehand whether a key for this provider is present.
//
// Swap providers with NO code change:
//   SCHWIFLY_MODEL=openai/gpt-4.1-mini   (reads OPENAI_API_KEY)
//   SCHWIFLY_MODEL=anthropic/claude-...  (reads ANTHROPIC_API_KEY)
// (We do NOT exercise non-Gemini paths in this repo -- live LLM cost stays ~zero.)

export const DEFAULT_MODEL = 'google/gemini-2.5-flash';

export interface LlmConfig {
  model: ModelConfiguration;
}

// Returns the model config when a usable API key exists for the selected provider, else null.
// Null is the happy-path signal: no key -> no Stagehand tier -> the AI backup stays offline.
export function llmConfigFromEnv(): LlmConfig | null {
  const model = process.env.SCHWIFLY_MODEL ?? DEFAULT_MODEL;
  const provider = model.includes('/') ? model.split('/')[0] : 'google';
  // Stagehand resolves provider -> env var(s) itself; we pass a no-op logger and treat a
  // returned key as "configured". No provider->envvar table lives in this codebase.
  const key = loadApiKeyFromEnv(provider, () => {});
  return key ? { model } : null;
}
