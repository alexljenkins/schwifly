import { openSharedSession } from '../../src/sharedCdp';
const session = await openSharedSession();
const cdp = await session.browser.newBrowserCDPSession();
const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
console.log(`READY:${processInfo.find((entry) => entry.type === 'browser')!.id}`);
