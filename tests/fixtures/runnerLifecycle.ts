import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { runPlaywright } from '../../src/playwrightProcess';
const file = `candidates/lifecycle.${process.pid}.spec.ts`;
mkdirSync('candidates', { recursive: true });
writeFileSync(file, `import { test } from 'schwifly/test';
import { openSharedSession } from 'schwifly/sharedCdp';
let session;
test.afterAll(async () => { await session?.close(); });
test('owned browser', async () => {
  session = await openSharedSession();
  const cdp = await session.browser.newBrowserCDPSession();
  const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
  console.log('READY:' + processInfo.find(entry => entry.type === 'browser').id);
  await new Promise(() => {});
});
`);
try {
  const result = await runPlaywright(['test', file, '--project=candidate', '--reporter=line'], { stdio: 'inherit' });
  process.exitCode = result.status === 0 ? 0 : 1;
} finally { rmSync(file, { force: true }); }
