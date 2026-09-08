import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { isAlias, parseDocument, visit } from 'yaml';
import type { JsonValue } from './proofs.js';

export type ProofPolarity = 'must' | 'mustNot';

export interface ProofClause {
  id: string;
  use: string;
  with: { [key: string]: JsonValue };
}

export interface StoryContract {
  version: 1;
  id: string;
  ideal: string;
  title: string;
  start: { url: string };
  story: { as: string; want: string; so: string };
  route: string;
  proofs: { must: ProofClause[]; mustNot: ProofClause[] };
}

export interface LoadedStory {
  story: StoryContract;
  file: string;
  relativeFile: string;
  routeFile: string;
  root: string;
}

export class StoryValidationError extends Error {
  constructor(readonly errors: string[]) {
    super(`invalid story:\n${errors.map((error) => `- ${error}`).join('\n')}`);
    this.name = 'StoryValidationError';
  }
}

const ID = /^[a-z0-9-]+$/;

function objectAt(value: unknown, path: string, errors: string[]): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${path} must be an object`);
    return null;
  }
  return value as Record<string, unknown>;
}

function rejectUnknown(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  errors: string[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${path ? `${path}.` : ''}${key} is not allowed`);
  }
}

function requiredString(value: Record<string, unknown>, key: string, path: string, errors: string[]): string {
  const full = path ? `${path}.${key}` : key;
  if (typeof value[key] !== 'string' || !(value[key] as string).trim()) {
    errors.push(`${full} is required and must be a non-empty string`);
    return '';
  }
  return value[key] as string;
}

function jsonSafe(value: unknown, path: string, errors: string[], seen = new Set<object>()): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return true;
    errors.push(`${path} must contain only JSON-safe values`);
    return false;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      errors.push(`${path} must not contain circular values`);
      return false;
    }
    seen.add(value);
    let valid = true;
    value.forEach((item, index) => { if (!jsonSafe(item, `${path}[${index}]`, errors, seen)) valid = false; });
    seen.delete(value);
    return valid;
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    if (seen.has(value)) {
      errors.push(`${path} must not contain circular values`);
      return false;
    }
    seen.add(value);
    let valid = true;
    for (const [key, item] of Object.entries(value)) {
      if (!jsonSafe(item, `${path}.${key}`, errors, seen)) valid = false;
    }
    seen.delete(value);
    return valid;
  }
  errors.push(`${path} must contain only JSON-safe values`);
  return false;
}

function proofList(value: unknown, path: string, errors: string[]): ProofClause[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return [];
  }
  return value.flatMap((item, index) => {
    const itemPath = `${path}[${index}]`;
    const object = objectAt(item, itemPath, errors);
    if (!object) return [];
    rejectUnknown(object, ['id', 'use', 'with'], itemPath, errors);
    const id = requiredString(object, 'id', itemPath, errors);
    const use = requiredString(object, 'use', itemPath, errors);
    if (id && !ID.test(id)) errors.push(`${itemPath}.id must use lowercase letters, numbers, and hyphens`);
    const input = objectAt(object.with, `${itemPath}.with`, errors);
    if (input) jsonSafe(input, `${itemPath}.with`, errors);
    return id && use && input ? [{ id, use, with: input as { [key: string]: JsonValue } }] : [];
  });
}

function nearestExisting(path: string): string {
  let current = path;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

function routeInsideRoot(root: string, route: string, errors: string[]): string {
  const routeFile = resolve(root, route);
  const lexical = relative(root, routeFile);
  if (lexical === '..' || lexical.startsWith(`..${sep}`) || isAbsolute(lexical)) {
    errors.push('route must stay inside the repository root');
  }
  if (!route.endsWith('.spec.ts')) errors.push('route must end in .spec.ts');
  try {
    const realRoot = realpathSync(root);
    const existing = realpathSync(nearestExisting(routeFile));
    const physical = relative(realRoot, existing);
    if (physical === '..' || physical.startsWith(`..${sep}`) || isAbsolute(physical)) {
      errors.push('route must stay inside the repository root');
    }
  } catch (error) {
    errors.push(`route cannot be resolved: ${(error as Error).message}`);
  }
  return routeFile;
}

export function parseStorySource(source: string, file: string, root = process.cwd()): LoadedStory {
  const errors: string[] = [];
  const document = parseDocument(source, { schema: 'core', merge: false, strict: true, uniqueKeys: true });
  let hasAlias = false;
  let hasTag = false;
  visit(document, (_key, node) => {
    if (isAlias(node)) hasAlias = true;
    if (node && typeof node === 'object' && 'tag' in node && typeof node.tag === 'string') hasTag = true;
  });
  if (hasAlias) errors.push('YAML aliases are not allowed');
  if (hasTag) errors.push('YAML tags are not allowed');
  errors.push(...document.errors.map((error) => `YAML: ${error.message}`));

  let raw: unknown;
  try {
    raw = document.toJS({ maxAliasCount: 0 });
  } catch (error) {
    errors.push(`YAML: ${(error as Error).message}`);
  }
  const top = objectAt(raw, '', errors) ?? {};
  rejectUnknown(top, ['version', 'id', 'ideal', 'title', 'start', 'story', 'route', 'proofs'], '', errors);
  if (top.version !== 1) errors.push('version must equal 1');
  const id = requiredString(top, 'id', '', errors);
  const ideal = requiredString(top, 'ideal', '', errors);
  const title = requiredString(top, 'title', '', errors);
  if (id && !ID.test(id)) errors.push('id must use lowercase letters, numbers, and hyphens');

  const start = objectAt(top.start, 'start', errors) ?? {};
  rejectUnknown(start, ['url'], 'start', errors);
  const url = requiredString(start, 'url', 'start', errors);
  if (url) {
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocol');
    } catch {
      errors.push('start.url must be an absolute HTTP or HTTPS URL');
    }
  }

  const prose = objectAt(top.story, 'story', errors) ?? {};
  rejectUnknown(prose, ['as', 'want', 'so'], 'story', errors);
  const as = requiredString(prose, 'as', 'story', errors);
  const want = requiredString(prose, 'want', 'story', errors);
  const so = requiredString(prose, 'so', 'story', errors);

  const route = requiredString(top, 'route', '', errors);
  const rootFile = resolve(root);
  const routeFile = route ? routeInsideRoot(rootFile, route, errors) : resolve(rootFile, '__invalid__.spec.ts');

  const proofs = top.proofs === undefined ? {} : objectAt(top.proofs, 'proofs', errors) ?? {};
  rejectUnknown(proofs, ['must', 'mustNot'], 'proofs', errors);
  const must = proofList(proofs.must, 'proofs.must', errors);
  const mustNot = proofList(proofs.mustNot, 'proofs.mustNot', errors);
  if (must.length + mustNot.length === 0) errors.push('proofs must contain at least 1 clause');
  const ids = new Set<string>();
  for (const clause of [...must, ...mustNot]) {
    if (ids.has(clause.id)) errors.push(`proof id must be unique: ${clause.id}`);
    ids.add(clause.id);
  }

  if (!jsonSafe(raw, '$', errors)) errors.push('story must contain only JSON-safe values');
  if (errors.length) throw new StoryValidationError([...new Set(errors)]);

  const absoluteFile = resolve(file);
  return {
    story: {
      version: 1,
      id,
      ideal,
      title,
      start: { url },
      story: { as, want, so },
      route,
      proofs: { must, mustNot },
    },
    file: absoluteFile,
    relativeFile: relative(rootFile, absoluteFile).replaceAll(sep, '/'),
    routeFile,
    root: rootFile,
  };
}

export function loadStory(file: string, root = process.cwd()): LoadedStory {
  const absolute = resolve(root, file);
  if (!absolute.endsWith('.story.yaml')) throw new StoryValidationError(['story file must end in .story.yaml']);
  return parseStorySource(readFileSync(absolute, 'utf8'), absolute, root);
}
