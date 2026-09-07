import { expect, test } from '@playwright/test';
import { llmConfigFromEnv, DEFAULT_MODEL } from '../src/llm';
import { openSharedSession } from '../src/sharedCdp';

for (const [status, message] of [[401, 'authentication'], [402, 'budget'], [429, 'rate limit']] as const) {
  test(`OpenRouter HTTP ${status} fails once without retry or credential leakage`, async () => {
    const oldKey = process.env.OPENROUTER_API_KEY;
    const oldModel = process.env.SCHWIFLY_MODEL;
    process.env.OPENROUTER_API_KEY = 'test-private-key';
    delete process.env.SCHWIFLY_MODEL;
    const fetch = globalThis.fetch;
    let requests = 0;
    globalThis.fetch = async (input, init) => {
      if (String(input).startsWith('https://openrouter.ai/')) {
        requests++;
        expect(String(input)).toBe('https://openrouter.ai/api/v1/chat/completions');
        expect(JSON.parse(String(init?.body)).model).toBe(DEFAULT_MODEL);
        return new Response(JSON.stringify({ error: { message: 'test-private-key', code: status } }), {
          status, headers: { 'content-type': 'application/json' },
        });
      }
      return fetch(input, init);
    };
    let session: Awaited<ReturnType<typeof openSharedSession>> | undefined;
    try {
      session = await openSharedSession();
      await session.page.setContent('<button>Continue</button>');
      await expect(session.stagehand.observe('click Continue', { page: session.page })).rejects.toThrow(message);
      expect(requests).toBe(1);
    } finally {
      await session?.close();
      globalThis.fetch = fetch;
      if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = oldKey;
      if (oldModel === undefined) delete process.env.SCHWIFLY_MODEL;
      else process.env.SCHWIFLY_MODEL = oldModel;
    }
  });
}

test('missing OpenRouter credentials leave deterministic configuration usable', () => {
  const key = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try { expect(llmConfigFromEnv()).toBeNull(); }
  finally { if (key !== undefined) process.env.OPENROUTER_API_KEY = key; }
});
