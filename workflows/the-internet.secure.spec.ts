import { test, expect } from '@playwright/test';

// LOGGED-IN-ONLY WITNESS for auth-login-at-scale.
//
// The /secure page redirects to /login unless the request carries the session captured by
// the-internet.auth.setup.ts. This spec runs in the `workflows` project, which loads that
// storageState via use.storageState — so:
//   * WITHOUT state (no setup run): the page redirects, the assertion FAILS (RED).
//   * WITH state (setup ran first): we land on /secure, the assertion PASSES (GREEN).
//
// It lives in `workflows/`, NOT `tests/`, so key-free `npm run verify` (which runs tests/ only)
// never depends on a login and stays green at baseline.
test('reaches the secure area using the reused session', async ({ page }) => {
  await page.goto('https://the-internet.herokuapp.com/secure');

  // Logged-out, /secure 302s to /login. These two only render for an authenticated session, so
  // they are the gate: the durable "Secure Area" heading and the Logout link (not the one-shot
  // post-login flash banner, which a restored-session GET never re-renders).
  await expect(page).toHaveURL(/\/secure$/);
  await expect(page.getByRole('heading', { name: 'Secure Area', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /logout/i })).toBeVisible();
});
