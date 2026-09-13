import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page as PlaywrightPage } from '@playwright/test';
import { localBrowser, Stagehand, type Page as StagehandPage } from 'stagehand-v4';
import { captureFailure } from '../../src/evidence.js';
import { guardOrigin, type StoryDiscovery, type StoryDiscoveryRequest } from '../../src/attempt.js';
import { MODEL_TIMEOUT_MS, SESSION_TIMEOUT_MS, bounded } from '../../src/limits.js';
import { DEFAULT_MODEL, OPENROUTER_URL, ProviderError } from '../../src/llm.js';
import { recordModelCall } from '../../src/modelMeter.js';
import { loadConfig, proofDescriptions, runProofs } from '../../src/proofs.js';
import { modelCredential, selectedModel } from '../../src/settings.js';
import type { CapturedAction } from '../../src/capture.js';
import type { BenchEngine } from '../types.js';

function packageVersion(name: string): string {
  try {
    let directory = dirname(fileURLToPath(import.meta.resolve(name)));
    for (let depth = 0; depth < 4; depth++) {
      try {
        return (JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8')) as { version: string }).version;
      } catch { directory = resolve(directory, '..'); }
    }
    return 'unknown';
  }
  catch { return 'unknown'; }
}

export interface BrowserDecision {
  decision: 'action' | 'done';
  nodeId: string;
  action: 'click' | 'fill';
  value: string;
}

const DECISION_SCHEMA = {
  type: 'object',
  properties: {
    decision: { type: 'string', enum: ['action', 'done'] },
    nodeId: { type: 'string' },
    action: { type: 'string', enum: ['click', 'fill'] },
    value: { type: 'string' },
  },
  required: ['decision', 'nodeId', 'action', 'value'],
  additionalProperties: false,
} as const;

export function parseBrowserDecision(value: unknown): BrowserDecision {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProviderError('OpenRouter returned an invalid browser decision');
  }
  const input = value as Record<string, unknown>;
  if ((input.decision !== 'action' && input.decision !== 'done') ||
      typeof input.nodeId !== 'string' ||
      (input.action !== 'click' && input.action !== 'fill') ||
      typeof input.value !== 'string') {
    throw new ProviderError('OpenRouter returned an invalid browser decision');
  }
  return input as unknown as BrowserDecision;
}

export function snapshotDescription(tree: string, nodeId: string): string {
  const escaped = nodeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const line = tree.split('\n').find((candidate) => new RegExp(`\\[${escaped}\\]`).test(candidate));
  const raw = line?.replace(/^\s*\[[^\]]+\]\s*/, '').trim() || 'element';
  const match = /^(button|textbox|link|checkbox|combobox|radio|switch|option|tab):\s*(.+)$/i.exec(raw);
  return match ? `${match[2]} ${match[1].toLowerCase()}` : raw;
}

export function snapshotReplaySelector(tree: string, nodeId: string, xpath: string): string {
  const escaped = nodeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const line = tree.split('\n').find((candidate) => new RegExp(`\\[${escaped}\\]`).test(candidate));
  const raw = line?.replace(/^\s*\[[^\]]+\]\s*/, '').trim() ?? '';
  const match = /^(button|textbox|link|checkbox|combobox|radio|switch|option|tab):\s*(.+)$/i.exec(raw);
  if (!match) return xpath.startsWith('xpath=') ? xpath : `xpath=${xpath}`;
  return `role=${match[1].toLowerCase()}[name=${JSON.stringify(match[2])}i]`;
}

interface OpenRouterResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

async function nextDecision(
  instruction: string,
  proofs: string[],
  tree: string,
  history: CapturedAction[],
  call: number,
  signal: AbortSignal,
): Promise<BrowserDecision> {
  const model = selectedModel(DEFAULT_MODEL);
  const key = modelCredential();
  if (!key) throw new ProviderError('story discovery needs an LLM key (OPENROUTER_API_KEY)');
  const started = performance.now();
  let usage: OpenRouterResponse['usage'];
  let ok = false;
  try {
    const response = await bounded(fetch(`${OPENROUTER_URL}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content: 'You operate a browser as a user. Choose exactly one next action from the current accessibility tree. ' +
              'Use only a node ID shown in the tree. Choose done only when the tree shows the requested result. ' +
              'Never repeat a completed action. Use fill for text fields and click for controls.',
          },
          {
            role: 'user',
            content: `Task:\n${instruction}\n\nRequired results:\n${proofs.join('\n')}\n\n` +
              `Completed actions:\n${history.map((action) => `${action.method} ${action.description}`).join('\n') || 'none'}\n\n` +
              `Current accessibility tree:\n${tree}`,
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'browser_step', strict: true, schema: DECISION_SCHEMA },
        },
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(MODEL_TIMEOUT_MS)]),
    }), signal);
    if (!response.ok) {
      const reason = response.status === 401 || response.status === 403
        ? 'authentication failed; check OPENROUTER_API_KEY'
        : response.status === 402
          ? 'budget exhausted; check OpenRouter credit and key limits'
          : response.status === 429
            ? 'rate limit reached; retry later'
            : 'request failed or timed out';
      throw new ProviderError(`OpenRouter ${reason} (HTTP ${response.status})`);
    }
    const body = await response.json() as OpenRouterResponse;
    usage = body.usage;
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new ProviderError('OpenRouter returned no browser decision');
    const decision = parseBrowserDecision(JSON.parse(content));
    ok = true;
    return decision;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError('OpenRouter request failed or timed out');
  } finally {
    recordModelCall({
      model,
      call,
      ms: Math.round(performance.now() - started),
      inputTokens: usage?.prompt_tokens ?? null,
      outputTokens: usage?.completion_tokens ?? null,
      cachedInputTokens: usage?.prompt_tokens_details?.cached_tokens ?? null,
      ok,
    });
  }
}

async function executeDecision(page: StagehandPage, decision: BrowserDecision, selector: string): Promise<void> {
  const locator = page.locator(selector);
  if (decision.action === 'fill') await locator.fill(decision.value);
  else await locator.click();
}

async function configurePage(request: StoryDiscoveryRequest, page: PlaywrightPage): Promise<void> {
  const config = await loadConfig(request.loaded.root);
  if (typeof config.setup !== 'function') throw new Error('benchmark story needs setup()');
  await guardOrigin(page, request.loaded.story.start.url);
  await page.goto(request.loaded.story.start.url);
  await config.setup({
    page,
    browserContext: page.context(),
    url: request.loaded.story.start.url,
    phase: 'discovery',
    story: request.loaded.story,
  });
  await page.goto(request.loaded.story.start.url);
}

export async function discoverWithStagehand4(request: StoryDiscoveryRequest): Promise<StoryDiscovery> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('browser session exceeded its elapsed-time limit')), SESSION_TIMEOUT_MS);
  let browserHandle: Awaited<ReturnType<typeof localBrowser.launch>> | undefined;
  let stagehand: Stagehand | undefined;
  let playwright: Browser | undefined;
  try {
    browserHandle = await localBrowser.launch({
      executablePath: chromium.executablePath(),
      headless: !request.visible && process.env.SCHWIFLY_HEADED !== '1',
      chromiumSandbox: false,
    });
    stagehand = await Stagehand.create({ browser: browserHandle, logging: { level: 'off', format: 'pretty' } });
    const endpoint = stagehand.rpcClient?.browserWebSocketDebuggerUrl;
    if (!endpoint) throw new Error('Stagehand v4 did not expose its browser endpoint');
    playwright = await chromium.connectOverCDP(endpoint);
    const page = playwright.contexts()[0]?.pages()[0];
    const stagehandPage = (await stagehand.browser.context.pages())[0];
    if (!page || !stagehandPage) throw new Error('Stagehand v4 opened no browser page');
    page.setDefaultTimeout(5000);
    await configurePage(request, page);

    const actions: CapturedAction[] = [];
    let notes = '';
    const proofRun = await runProofs({
      proofs: request.proofs,
      context: { page, browserContext: page.context() },
      persist: false,
      route: async () => {
        const instruction = `Act as ${request.loaded.story.story.as}. ${request.loaded.story.story.want}. ${request.loaded.story.story.so}.`;
        const required = proofDescriptions(request.proofs);
        for (let step = 1; step <= request.maxSteps; step++) {
          const snapshot = await bounded(stagehandPage.snapshot(), controller.signal);
          const decision = await nextDecision(instruction, required, snapshot.formattedTree, actions, step, controller.signal);
          if (decision.decision === 'done') {
            notes = `Stagehand v4 agent finished after ${actions.length} actions`;
            return;
          }
          const xpath = snapshot.xpathMap[decision.nodeId];
          if (!xpath) throw new ProviderError(`OpenRouter selected unknown browser node ${decision.nodeId}`);
          const executionSelector = xpath.startsWith('xpath=') ? xpath : `xpath=${xpath}`;
          const captured: CapturedAction = {
            method: decision.action,
            selector: snapshotReplaySelector(snapshot.formattedTree, decision.nodeId, xpath),
            description: snapshotDescription(snapshot.formattedTree, decision.nodeId),
            args: decision.action === 'fill' ? [decision.value] : [],
            ok: false,
          };
          actions.push(captured);
          await bounded(executeDecision(stagehandPage, decision, executionSelector), controller.signal);
          captured.ok = true;
          captured.postUrl = await stagehandPage.url();
          await stagehandPage.waitForTimeout(250);
        }
        throw new Error(`Stagehand v4 agent exceeded ${request.maxSteps} steps`);
      },
    });
    if (proofRun.routeError) throw proofRun.routeError;
    const artifact = proofRun.records.some((proof) => proof.status !== 'pass')
      ? await captureFailure(page, request.loaded.root)
      : undefined;
    return { actions, proofs: proofRun.records, notes, artifacts: artifact ? [artifact] : [] };
  } finally {
    clearTimeout(timer);
    await stagehand?.close().catch(() => {});
    await playwright?.close().catch(() => {});
    await browserHandle?.close().catch(() => {});
  }
}

export const stagehand4: BenchEngine = {
  id: 'stagehand-4',
  label: 'Stagehand 4.1 external tester agent, Playwright replay',
  versions: () => ({
    '@browserbasehq/stagehand': packageVersion('stagehand-v4'),
    '@playwright/test': packageVersion('@playwright/test'),
  }),
  discover: discoverWithStagehand4,
};
