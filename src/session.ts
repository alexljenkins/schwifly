import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { bounded } from './limits.js';
import { loadConfig, type SetupContext } from './proofs.js';
import { openSharedSession } from './sharedCdp.js';
import { redact } from './secrets.js';
import type { StoryContract } from './story.js';

export class SessionError extends Error {
  constructor(readonly kind: 'authentication' | 'setup', message: string) {
    super(message);
    this.name = 'SessionError';
  }
}

export interface SessionOptions {
  root?: string;
  url: string;
  phase: SetupContext['phase'];
  story?: StoryContract;
  headed?: boolean;
  evidence?: boolean;
}

export async function openConfiguredSession(options: SessionOptions) {
  const root = options.root ?? process.env.SCHWIFLY_ROOT ?? process.cwd();
  const config = await loadConfig(root);
  if (options.story && typeof config.setup !== 'function') {
    throw new SessionError('setup', 'missing setup: define setup() in schwifly.config.ts before running a story');
  }
  if (config.session && typeof config.session.storageState !== 'string') {
    throw new SessionError('authentication', 'session.storageState must name a saved login file');
  }
  const storageState = config.session ? resolve(root, config.session.storageState) : undefined;
  if (config.session && (!storageState || !existsSync(storageState) || typeof config.session.check !== 'function')) {
    throw new SessionError('authentication', 'missing login state or session.check(); capture login before running the story');
  }
  const session = await openSharedSession({ ...options, storageState });
  try {
    const context: SetupContext = {
      page: session.page, browserContext: session.page.context(),
      url: options.url, phase: options.phase, story: options.story,
    };
    await session.page.goto(options.url);
    if (config.session && !await bounded(config.session.check(context), session.signal)) {
      throw new SessionError('authentication', 'saved login expired; capture a fresh login state');
    }
    try { await bounded(Promise.resolve(config.setup?.(context)), session.signal); }
    catch (error) { throw new SessionError('setup', `setup failed: ${redact(String(error))}`); }
    // Discard page data that predates the app-owned reset.
    await session.page.goto(options.url);
    return session;
  } catch (error) {
    await session.close();
    throw error;
  }
}
