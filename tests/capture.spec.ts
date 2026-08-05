import { test, expect } from '@playwright/test';
import { contractFromTicket, normalizeActions, summarize, type CapturedAction } from '../src/capture';

// KEY-FREE witnesses for the capture normalizer (task-to-verified-flow). capture.ts is PURE:
// browser facts in, deterministic steps out. The live attempt path is exercised separately.

function action(over: Partial<CapturedAction>): CapturedAction {
  return { method: 'click', selector: 'xpath=/html/body/button[1]', description: 'Add Element', args: [], ok: true, ...over };
}

test('failed probes never reach the emitted flow', () => {
  const steps = normalizeActions([
    action({ ok: false, description: 'Add Elemnt', selector: 'xpath=/html/body/button[9]' }),
    action({}),
  ]);
  expect(steps).toHaveLength(1);
  expect(steps[0].locator).toBe('xpath=/html/body/button[1]');
});

test('actions without a concrete selector or a supported method are dropped', () => {
  const steps = normalizeActions([
    action({ selector: '' }),
    action({ method: 'screenshot' }),
    action({ method: 'scroll' }),
    action({ description: '' }),
    action({ method: 'fill', description: 'Email', args: ['a@b.com'] }),
  ]);
  expect(steps.map((s) => s.action)).toEqual(['fill']);
  expect(steps[0].value).toBe('a@b.com');
});

test('a re-typed field is superseded by the last fill on that element', () => {
  const steps = normalizeActions([
    action({ method: 'fill', selector: 'xpath=//input[1]', description: 'Email', args: ['typo@'] }),
    action({ method: 'fill', selector: 'xpath=//input[2]', description: 'Name', args: ['Ada'] }),
    action({ method: 'fill', selector: 'xpath=//input[1]', description: 'Email', args: ['ada@example.com'] }),
  ]);
  expect(steps.map((s) => s.value)).toEqual(['Ada', 'ada@example.com']);
});

test('a repeated identical click collapses to one step', () => {
  const steps = normalizeActions([action({}), action({})]);
  expect(steps).toHaveLength(1);
});

test('intent is derived from the observed element, never from agent narration', () => {
  const steps = normalizeActions([action({ description: '  Add   Element ' })]);
  expect(steps[0].intent).toBe('click the Add Element');
});

test('typed values pass through redact() before they can reach generated source', () => {
  process.env.SCHWIFLY_TEST_API_KEY = 'zzzz-super-secret-value';
  try {
    const steps = normalizeActions([
      action({ method: 'fill', description: 'Password', args: ['zzzz-super-secret-value'] }),
      action({ method: 'fill', selector: 'xpath=//input[2]', description: 'Note', args: ['token=abcdef123456'] }),
    ]);
    expect(steps[0].value).not.toContain('super-secret');
    expect(steps[1].value).toContain('REDACTED');
  } finally {
    delete process.env.SCHWIFLY_TEST_API_KEY;
  }
});

test('a password field is redacted even when its value is not configured in the environment', () => {
  const saved = process.env.APP_PASSWORD;
  delete process.env.APP_PASSWORD;
  try {
    const steps = normalizeActions([
      action({ method: 'fill', description: 'Password field', args: ['unconfigured-hunter2'] }),
    ]);
    expect(steps[0].value).toBe('***REDACTED***');
  } finally {
    if (saved !== undefined) process.env.APP_PASSWORD = saved;
  }
});

test('an explicit ticket states its own outcome contract', () => {
  const c = contractFromTicket('Add an element. <expect>Delete</expect>');
  expect(c?.source).toBe('ticket');
  expect(c?.checks.map((x) => x.text)).toEqual(['Delete']);
  expect(c?.checks[0].intent).toBe('the page shows Delete');
});

test('the existing <validate> vocabulary still states a contract', () => {
  expect(contractFromTicket('check the price <validate>19</validate>')?.checks[0].text).toBe('19');
});

test('mismatched expectation tags do not create a contract', () => {
  expect(contractFromTicket('check it <expect>Done</validate>')).toBeNull();
});

test('a vague ticket has no contract of its own and must have one resolved', () => {
  expect(contractFromTicket('make sure users can reset their password')).toBeNull();
});

test('the contract summary strips tags and stays one line', () => {
  expect(summarize('Add an element.\n  <expect>Delete</expect>')).toBe('Add an element. Delete');
});
