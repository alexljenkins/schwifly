import { existsSync, mkdirSync, chmodSync } from 'node:fs';
import { loadStory } from 'schwifly';
import { openSharedSession } from 'schwifly/sharedCdp';
if (existsSync('.env')) process.loadEnvFile('.env');
if (!process.env.APP_PASSWORD) throw new Error('Set APP_PASSWORD in .env before capturing login');
const { story } = loadStory('stories/add-item.story.yaml');
const session = await openSharedSession();
try {
  const response = await session.page.request.post(new URL('/login', story.start.url).href, {
    data: { password: process.env.APP_PASSWORD },
  });
  if (!response.ok()) throw new Error('Login failed');
  mkdirSync('.schwifly/auth', { recursive: true });
  await session.page.context().storageState({ path: '.schwifly/auth/demo.json' });
  chmodSync('.schwifly/auth/demo.json', 0o600);
  console.log('Saved login state.');
} finally { await session.close(); }
