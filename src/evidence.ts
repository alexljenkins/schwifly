import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { redact } from './secrets.js';

/** Failure-only screenshots mask form values, app-marked private regions, and known secret text. */
export async function captureFailure(page: Page, root?: string, destination?: string, crop?: { selector: string; padding: number }): Promise<string | undefined> {
  const log = process.env.SCHWIFLY_ARTIFACT_LOG;
  if (!root && !log && !destination) return undefined;
  const file = destination ?? resolve(root ? resolve(root, '.schwifly', 'evidence') : dirname(log!), `${randomUUID()}.png`);
  try {
    mkdirSync(dirname(file), { recursive: true });
    const texts = await page.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const texts: string[] = [];
      while (walker.nextNode()) texts.push(walker.currentNode.textContent ?? '');
      return texts;
    });
    const edits = texts.map(text => [text, redact(text)]).filter(([before, after]) => before !== after);
    const changed = await page.evaluateHandle((edits) => {
      const replacements = new Map(edits);
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const changed: Array<{ node: Node; text: string }> = [];
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const text = node.textContent ?? '';
        const replacement = replacements.get(text);
        if (replacement !== undefined) { changed.push({ node, text }); node.textContent = replacement; }
      }
      return changed;
    }, edits as Array<[string, string]>);
    try {
      let clip;
      if (crop) {
        const locator = page.locator(crop.selector);
        await locator.scrollIntoViewIfNeeded();
        const box = await locator.boundingBox();
        if (!box) throw new Error('screenshot element is not visible');
        const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
        const x = Math.max(0, box.x - crop.padding);
        const y = Math.max(0, box.y - crop.padding);
        clip = { x, y, width: Math.min(viewport.width, box.x + box.width + crop.padding) - x, height: Math.min(viewport.height, box.y + box.height + crop.padding) - y };
      }
      await page.screenshot({ path: file, ...(clip ? { clip } : {}), mask: [page.locator('input, textarea, select, [data-private], [data-schwifly-private]')] });
    } finally {
      await changed.evaluate(changes => { for (const { node, text } of changes) node.textContent = text; }).catch(() => {});
      await changed.dispose();
    }
    if (log) appendFileSync(log, JSON.stringify({ path: file }) + '\n');
    return file;
  } catch { return undefined; }
}
