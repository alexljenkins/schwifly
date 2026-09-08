import type { Page } from '@playwright/test';

/** Measurements are observations. The caller decides whether these values meet its design. */
export async function elementMeasurements(page: Page, selector: string) {
  return page.locator(selector).evaluate(element => {
    const box = element.getBoundingClientRect();
    const parent = element.parentElement?.getBoundingClientRect();
    const style = getComputedStyle(element);
    const rgb = (value: string) => {
      const match = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
      return match && (match[4] === undefined || Number(match[4]) === 1) ? match.slice(1, 4).map(Number) : null;
    };
    const luminance = (color: number[]) => color.map(value => {
      const s = value / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const foreground = rgb(style.color);
    const background = rgb(style.backgroundColor);
    const solid = style.backgroundImage === 'none' && style.opacity === '1';
    const contrast = foreground && background && solid
      ? (Math.max(luminance(foreground), luminance(background)) + 0.05) / (Math.min(luminance(foreground), luminance(background)) + 0.05) : null;
    return { width: box.width, height: box.height,
      centerOffsetPx: parent ? Math.round((box.x + box.width / 2 - parent.x - parent.width / 2) * 100) / 100 : null,
      textContrastRatio: contrast === null ? null : Math.round(contrast * 100) / 100,
      contrastScope: 'Computed text and solid element background only. Transparency, images, and ancestors require visual review.' };
  });
}

/** Hold the pointer for a screenshot, then release outside the element to avoid an extra click. */
export async function inspectPress(page: Page, selector: string, capture: () => Promise<void>) {
  const locator = page.locator(selector);
  await locator.scrollIntoViewIfNeeded();
  const state = () => locator.evaluate(element => {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return { transform: style.transform, scale: style.scale, background: style.backgroundColor,
      width: box.width, height: box.height,
      runningAnimations: element.getAnimations().filter(animation => animation.playState === 'running').length };
  });
  await locator.hover();
  const before = await state();
  await page.mouse.down();
  try {
    const started = await state();
    await page.waitForTimeout(80);
    const held = await state();
    await capture();
    return { changedWhilePressed: JSON.stringify(before) !== JSON.stringify(held),
      runningAnimations: Math.max(started.runningAnimations, held.runningAnimations),
      note: 'Pointer held for 80 ms, then released outside the element. The captured interaction checks activation separately.' };
  } finally { await page.mouse.move(-10, -10); await page.mouse.up(); }
}
