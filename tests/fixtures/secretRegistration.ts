import assert from 'node:assert/strict';
import { registerSecrets, redact, REDACTED } from '../../src/secrets';
import { emit } from '../../src/emit';

registerSecrets([
  { key: 'theme', value: 'dark' },
  { key: 'sidebarState', value: 'collapsed' },
  { key: 'considered', value: 'irrelevant' },
  { key: 'view-mode', value: 'list' },
  { key: 'analytics-opt-in', value: 'true' },
  { key: 'last-url', value: 'http://127.0.0.1:4173/app/settings' },
  { key: 'demo_session', value: 'sess-42' },
  { key: 'authToken', value: '1234' },
  { key: 'ab-bucket', value: 'gh8Kq2Lm4Rt7Vz1Wb9Ns3Xc6' },
]);
const preferences = 'dark collapsed irrelevant list true http://127.0.0.1:4173/app/settings';
assert.equal(redact(preferences), preferences);
for (const value of ['sess-42', '1234', 'gh8Kq2Lm4Rt7Vz1Wb9Ns3Xc6']) assert.equal(redact(value), REDACTED);
assert.match(emit({ title: 'dark mode', url: 'http://127.0.0.1:4173/app',
  steps: [{ intent: 'switch the collapsed sidebar to dark mode', locator: '#theme-dark', action: 'click' }], assertions: [],
}), /#theme-dark/);
assert.throws(() => emit({ title: 'session leak', url: 'http://127.0.0.1:4173/app',
  steps: [{ intent: 'send sess-42', locator: '#go', action: 'click' }], assertions: [],
}), /secret/);
// A credential key wins even when its value otherwise resembles a preference.
registerSecrets([{ key: 'password', value: 'dark' }]);
assert.equal(redact('dark'), REDACTED);
