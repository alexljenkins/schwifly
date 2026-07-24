import { test, expect } from '@playwright/test';
import { step } from '../src/workflow';

// The <validate>X</validate> headline example, made expressible (epic: assertion-actions).
// The Relevance AI pricing story (fixtures/relevance-pricing.json) asserts the Pro plan is
// "$19/month". Today's actions can't assert that; expectText can. Proven against a real DOM:
// it PASSES when the price matches and FAILS when it doesn't — no LLM, no key.

const MATCH = `<!doctype html><html><body>
  <div class="plan"><h3>Pro</h3><span data-testid="price">19</span></div>
</body></html>`;

const NO_MATCH = `<!doctype html><html><body>
  <div class="plan"><h3>Pro</h3><span data-testid="price">29</span></div>
</body></html>`;

const CONTAINS = `<!doctype html><html><body>
  <div class="plan"><h3>Pro</h3><span data-testid="price">$19/month</span></div>
</body></html>`;

test('expectText passes when the price text equals the validated value', async ({ page }) => {
  await page.setContent(MATCH);
  const r = await step(page, { intent: 'see the Pro price', locator: '[data-testid="price"]', action: 'expectText', value: '19' }, { timeout: 1500 });
  expect(r.status).toBe('ok');
});

test('expectText fails when the price text does not match (red witness)', async ({ page }) => {
  await page.setContent(NO_MATCH);
  const r = await step(page, { intent: 'see the Pro price', locator: '[data-testid="price"]', action: 'expectText', value: '19' }, { timeout: 1500 });
  expect(r.status).toBe('failed');
});

test('expectText contains-fallback matches "19" inside "$19/month"', async ({ page }) => {
  await page.setContent(CONTAINS);
  const r = await step(page, { intent: 'see the Pro price', locator: '[data-testid="price"]', action: 'expectText', value: '19' }, { timeout: 1500 });
  expect(r.status).toBe('ok');
});
