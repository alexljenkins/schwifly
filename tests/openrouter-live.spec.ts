import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { attemptFlow } from '../src/attempt';
import { openSharedSession } from '../src/sharedCdp';
import { StagehandResolver } from '../src/heal';
import { step } from '../src/workflow';
import { runPlaywright } from '../src/playwrightProcess';
import { readRunLogs } from '../src/runLogs';
import type { StepResult } from '../src/workflow';

test('OpenRouter discovers, repairs through observe, and replays without model calls', async () => {
  test.skip(process.env.SCHWIFLY_LIVE !== '1' || !process.env.OPENROUTER_API_KEY, 'explicit live check only');
  test.setTimeout(180_000);
  const server = createServer((_, response) => response.end(`<!doctype html><html><body>
    <button id="reveal" onclick="document.querySelector('#result').hidden=false">Show receipt</button>
    <h1 id="result" hidden>Order confirmed</h1></body></html>`));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const out = `workflows/__openrouter_${process.pid}.spec.ts`;
  const log = resolve('.schwifly', `model-${process.pid}.ndjson`);
  const stepLog = resolve('.schwifly', `live-steps-${process.pid}.ndjson`);
  mkdirSync('.schwifly', { recursive: true });
  process.env.SCHWIFLY_MODEL_LOG = log;
  rmSync(log, { force: true });
  const calls = () => readFileSync(log, 'utf8').trim().split('\n').length;
  try {
    const attempt = await attemptFlow({
      ticket: 'Click Show receipt. <expect>Order confirmed</expect>', url,
      title: 'OpenRouter receipt', out, maxSteps: 5,
    });
    expect(attempt.ok, attempt.reason).toBe(true);
    expect(calls()).toBeGreaterThan(0);
    const loginSession = await openSharedSession();
    const stateFile = resolve('.schwifly', `live-state-${process.pid}.json`);
    try {
      await loginSession.page.goto(url);
      await loginSession.page.evaluate(() => localStorage.setItem('login-marker', 'saved'));
      await loginSession.page.context().storageState({ path: stateFile });
    } finally { await loginSession.close(); }
    const session = await openSharedSession({ storageState: stateFile });
    try {
      await session.page.goto(url);
      expect(await session.page.evaluate(() => localStorage.getItem('login-marker'))).toBe('saved');
      await session.page.evaluate(() => localStorage.setItem('login-marker', 'refreshed'));
      await session.page.reload();
      expect(await session.page.evaluate(() => localStorage.getItem('login-marker'))).toBe('refreshed');
      const before = calls();
      const result = await step(session.page, {
        intent: 'reveal the purchase confirmation', locator: '#removed', action: 'click',
      }, { resolver: new StagehandResolver(session.stagehand), timeout: 100, stepLog });
      expect(result.status).toBe('healed');
      expect(calls()).toBeGreaterThan(before);
      await expect(session.page.locator('#result')).toBeVisible();
    } finally { await session.close(); }
    const beforeReplay = calls();
    const replay = await runPlaywright(['test', out, '--project=workflows', '--no-deps', '--reporter=line'], {
      env: { ...process.env, SCHWIFLY_NO_HEAL: '1', SCHWIFLY_STEP_LOG: stepLog }, encoding: 'utf8',
    });
    expect(replay.status, replay.stdout + replay.stderr).toBe(0);
    expect(readRunLogs<StepResult>(stepLog).filter(s => s.file?.endsWith(out.split('/').at(-1)!)).every(s => s.status === 'ok')).toBe(true);
    expect(calls()).toBe(beforeReplay);
    console.log(JSON.stringify({ model: process.env.SCHWIFLY_MODEL, discoveryAndRepairCalls: calls(), replayCalls: 0 }));
  } finally {
    delete process.env.SCHWIFLY_MODEL_LOG;
    rmSync(out, { force: true });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
