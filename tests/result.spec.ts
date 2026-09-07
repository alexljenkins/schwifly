import { expect, test } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { attemptStory } from '../src/storyAttempt';
import { captureFailure } from '../src/evidence';
import { runSuite } from '../src/suite';

function fixture() {
  mkdirSync('.schwifly', { recursive: true });
  return resolve(mkdtempSync('.schwifly/result-test-'));
}

test('invalid contracts return and persist a versioned result', async () => {
  const root = fixture();
  try {
    writeFileSync(resolve(root, 'invalid.story.yaml'), 'version: 1');
    const result = await attemptStory({ root, file: 'invalid.story.yaml' });
    expect(result.ok).toBe(false);
    expect(result.report?.version).toBe(1);
    expect(result.report?.phase).toBe('contract');
    expect(result.report?.failure?.kind).toBe('invalid_contract');
    expect(JSON.parse(readFileSync(result.resultPath!, 'utf8'))).toEqual(result.report);
    const suite = await runSuite({ root, directory: '.' });
    expect(suite.summary).toEqual({ total: 1, certified: 0, failed: 1 });
    expect(suite.results[0].failure?.kind).toBe('invalid_contract');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('failure screenshots redact known secrets and restore the live DOM', async ({ page }) => {
  const root = fixture();
  const previous = process.env.APP_PASSWORD;
  process.env.APP_PASSWORD = 'private-login-password';
  try {
    await page.setContent('<h1>private-login-password</h1><input value="private-login-password">');
    const screenshot = page.screenshot.bind(page);
    let checked = false;
    page.screenshot = async options => {
      await expect(page.locator('h1')).toHaveText('***REDACTED***');
      expect(await options?.mask?.[0].evaluateAll(nodes => nodes.map(node => node.tagName))).toEqual(['INPUT']);
      checked = true;
      return screenshot(options);
    };
    const file = await captureFailure(page, root);
    expect(file).toBeTruthy();
    expect(checked).toBe(true);
    expect(readFileSync(file!).subarray(1, 4).toString()).toBe('PNG');
    await expect(page.locator('h1')).toHaveText('private-login-password');
  } finally {
    if (previous === undefined) delete process.env.APP_PASSWORD;
    else process.env.APP_PASSWORD = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
