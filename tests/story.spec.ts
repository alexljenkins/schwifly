import { expect, test } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseStorySource, StoryValidationError } from '../src/story';

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), 'schwifly-story-'));
  mkdirSync(join(dir, 'workflows'));
  return dir;
}

function valid(overrides = ''): string {
  return `version: 1
id: add-item
ideal: work-is-saved
title: Add an item
start:
  url: http://127.0.0.1:4173/app
story:
  as: a user
  want: to add an item
  so: I can plan
route: workflows/add-item.spec.ts
proofs:
  must:
    - id: item-visible
      use: ui.elementVisible
      with:
        role: listitem
        name: Buy milk
${overrides}`;
}

function errors(source: string, dir: string): string[] {
  try {
    parseStorySource(source, join(dir, 'stories', 'x.story.yaml'), dir);
    return [];
  } catch (error) {
    expect(error).toBeInstanceOf(StoryValidationError);
    return (error as StoryValidationError).errors;
  }
}

test('a valid version 1 story parses and defaults mustNot', () => {
  const dir = root();
  try {
    const loaded = parseStorySource(valid(), join(dir, 'stories', 'add-item.story.yaml'), dir);
    expect(loaded.story.version).toBe(1);
    expect(loaded.story.proofs.must).toHaveLength(1);
    expect(loaded.story.proofs.mustNot).toEqual([]);
    expect(loaded.routeFile).toBe(join(dir, 'workflows', 'add-item.spec.ts'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('missing fields and unknown nested keys report exact paths together', () => {
  const dir = root();
  try {
    const result = errors(`version: 2
extra: true
start:
  href: /relative
story:
  who: user
proofs:
  mustNot: []
`, dir).join('\n');
    for (const path of ['extra', 'id', 'ideal', 'title', 'start.href', 'start.url', 'story.who', 'story.as', 'story.want', 'story.so', 'route']) {
      expect(result).toContain(path);
    }
    expect(result).toContain('version must equal 1');
    expect(result).toContain('at least 1 clause');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('duplicate and malformed clause IDs fail', () => {
  const dir = root();
  try {
    const result = errors(valid(`  mustNot:
    - id: item-visible
      use: browser.consoleError
      with: {}
    - id: Bad_ID
      use: browser.pageError
      with: {}
`), dir).join('\n');
    expect(result).toContain('proof id must be unique: item-visible');
    expect(result).toContain('proofs.mustNot[1].id');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('aliases, executable tags, and non-JSON values fail', () => {
  const dir = root();
  try {
    expect(errors(valid().replace('name: Buy milk', 'name: &name Buy milk\n        copy: *name'), dir).join('\n')).toContain('aliases');
    expect(errors(valid().replace('Buy milk', '!!js/function function () {}'), dir).join('\n')).toContain('YAML');
    expect(errors(valid().replace('Buy milk', '.inf'), dir).join('\n')).toContain('JSON-safe');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the start URL must be absolute HTTP and the route must stay inside the root', () => {
  const dir = root();
  try {
    const source = valid()
      .replace('http://127.0.0.1:4173/app', 'file:///tmp/app')
      .replace('workflows/add-item.spec.ts', '../escape.ts');
    const result = errors(source, dir).join('\n');
    expect(result).toContain('start.url');
    expect(result).toContain('route must stay inside');
    expect(result).toContain('route must end in .spec.ts');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a route cannot escape through an existing symlink', () => {
  const dir = root();
  const outside = mkdtempSync(join(tmpdir(), 'schwifly-outside-'));
  try {
    const link = join(dir, 'linked');
    writeFileSync(join(outside, 'keep'), 'x');
    symlinkSync(outside, link, 'dir');
    expect(errors(valid().replace('workflows/add-item.spec.ts', 'linked/escape.spec.ts'), dir).join('\n')).toContain('route must stay inside');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
