import { createRequire } from 'node:module';
import { liveDiscoverStory } from '../../src/attempt.js';
import type { BenchEngine } from '../types.js';

const require = createRequire(import.meta.url);

function packageVersion(name: string): string {
  try { return (require(`${name}/package.json`) as { version: string }).version; }
  catch { return 'unknown'; }
}

/**
 * Stagehand 3.7 as Schwifly ships it today: the DOM agent explores, its `onEvidence` stream
 * yields real Playwright selectors, and Playwright replays and repairs the saved route.
 *
 * `replay` and `repair` stay unset because Schwifly's own Playwright gate is the default. A v4
 * engine that replays natively fills them in, and every metric in the report keeps its meaning.
 */
export const stagehand37: BenchEngine = {
  id: 'stagehand-3.7',
  label: 'Stagehand 3.7 DOM agent, Playwright replay',
  versions: () => ({
    '@browserbasehq/stagehand': packageVersion('@browserbasehq/stagehand'),
    '@playwright/test': packageVersion('@playwright/test'),
  }),
  discover: liveDiscoverStory,
};
