import { test } from '@playwright/test';
import { tsImport } from 'tsx/esm/api';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BrowserContext, Page } from '@playwright/test';
import { redact } from './secrets.js';
import { writeProofRecord } from './proofLogs.js';
import type { LoadedStory, ProofClause, ProofPolarity, StoryContract } from './story.js';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface ProofResult {
  matched: boolean;
  message: string;
  evidence?: JsonValue;
}

export interface ArmedProof {
  check(): Promise<ProofResult>;
  dispose?(): Promise<void>;
}

export interface ProofContext {
  page: Page;
  browserContext: BrowserContext;
}

export interface ProofAdapter<Input extends JsonValue = JsonValue> {
  parse(input: unknown): Input;
  describe(input: Input): string;
  arm(context: ProofContext, input: Input): Promise<ArmedProof>;
}

export type ProofRegistry = Record<string, ProofAdapter<JsonValue>>;

export interface SetupContext extends ProofContext {
  url: string;
  phase: 'discovery' | 'replay' | 'repair';
  story?: StoryContract;
}

export interface SchwiflyConfig {
  proofs?: ProofRegistry;
  setup?: (context: SetupContext) => Promise<void>;
  session?: {
    storageState: string;
    check(context: SetupContext): Promise<boolean>;
  };
}

export interface ProofRecord {
  storyId: string;
  clauseId: string;
  adapter: string;
  polarity: ProofPolarity;
  matched?: boolean;
  status: 'pass' | 'fail' | 'error';
  message: string;
  evidence?: JsonValue;
  file?: string;
}

export interface ValidatedProof {
  storyId: string;
  clauseId: string;
  adapterName: string;
  adapter: ProofAdapter<JsonValue>;
  polarity: ProofPolarity;
  input: JsonValue;
  description: string;
}

export class ProofValidationError extends Error {
  constructor(readonly errors: string[]) {
    super(`invalid proofs:\n${errors.map((error) => `- ${error}`).join('\n')}`);
    this.name = 'ProofValidationError';
  }
}

export function defineProof<Input extends JsonValue>(adapter: ProofAdapter<Input>): ProofAdapter<Input> {
  return adapter;
}

export function defineConfig<const Config extends SchwiflyConfig>(config: Config): Config {
  return config;
}

function strictObject(input: unknown, allowed: readonly string[], label: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(`${label} must be an object`);
  const value = input as Record<string, unknown>;
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error(`${label}.${unknown[0]} is not allowed`);
  return value;
}

function emptyInput(input: unknown): Record<string, never> {
  const value = strictObject(input, [], 'with');
  if (Object.keys(value).length) throw new Error('with must be empty');
  return {};
}

type UrlInput = { exact: string } | { contains: string };

function urlInput(input: unknown): UrlInput {
  const value = strictObject(input, ['exact', 'contains'], 'with');
  const fields = ['exact', 'contains'].filter((key) => value[key] !== undefined);
  if (fields.length !== 1 || typeof value[fields[0]] !== 'string' || !(value[fields[0]] as string).length) {
    throw new Error('with must contain exactly one non-empty string: exact or contains');
  }
  return { [fields[0]]: value[fields[0]] } as UrlInput;
}

type Role = Parameters<Page['getByRole']>[0];

const ROLES = new Set<Role>([
  'alert', 'alertdialog', 'application', 'article', 'banner', 'blockquote', 'button', 'caption',
  'cell', 'checkbox', 'code', 'columnheader', 'combobox', 'complementary', 'contentinfo',
  'definition', 'deletion', 'dialog', 'directory', 'document', 'emphasis', 'feed', 'figure', 'form',
  'generic', 'grid', 'gridcell', 'group', 'heading', 'img', 'insertion', 'link', 'list', 'listbox',
  'listitem', 'log', 'main', 'marquee', 'math', 'meter', 'menu', 'menubar', 'menuitem',
  'menuitemcheckbox', 'menuitemradio', 'navigation', 'none', 'note', 'option', 'paragraph',
  'presentation', 'progressbar', 'radio', 'radiogroup', 'region', 'row', 'rowgroup', 'rowheader',
  'scrollbar', 'search', 'searchbox', 'separator', 'slider', 'spinbutton', 'status', 'strong',
  'subscript', 'superscript', 'switch', 'tab', 'table', 'tablist', 'tabpanel', 'term', 'textbox',
  'time', 'timer', 'toolbar', 'tooltip', 'tree', 'treegrid', 'treeitem',
]);

export type LocatorInput =
  | { role: Role; name?: string }
  | { testId: string }
  | { css: string };

function locatorInput(input: unknown): LocatorInput {
  const value = strictObject(input, ['role', 'name', 'testId', 'css'], 'with');
  const choices = ['role', 'testId', 'css'].filter((key) => value[key] !== undefined);
  if (choices.length !== 1) throw new Error('with must contain exactly one locator: role, testId, or css');
  const choice = choices[0];
  if (typeof value[choice] !== 'string' || !(value[choice] as string).length) {
    throw new Error(`with.${choice} must be a non-empty string`);
  }
  if (choice === 'role' && !ROLES.has(value.role as Role)) {
    throw new Error(`with.role is not a supported accessibility role: ${value.role}`);
  }
  if (value.name !== undefined && (choice !== 'role' || typeof value.name !== 'string' || !value.name.length)) {
    throw new Error('with.name is allowed only as a non-empty string with role');
  }
  if (choice === 'role') return value.name === undefined
    ? { role: value.role as Role }
    : { role: value.role as Role, name: value.name as string };
  if (choice === 'testId') return { testId: value.testId as string };
  return { css: value.css as string };
}

function locate(page: Page, input: LocatorInput) {
  if ('role' in input) return page.getByRole(input.role, input.name === undefined ? {} : { name: input.name });
  if ('testId' in input) return page.getByTestId(input.testId);
  return page.locator(input.css);
}

function locatorDescription(input: LocatorInput): string {
  if ('role' in input) return `${input.role}${input.name === undefined ? '' : ` named ${input.name}`}`;
  if ('testId' in input) return `test ID ${input.testId}`;
  return `CSS ${input.css}`;
}

export const builtInProofs: ProofRegistry = {
  'page.url': defineProof<UrlInput>({
    parse: urlInput,
    describe(input) { return 'exact' in input ? `the page URL equals ${input.exact}` : `the page URL contains ${input.contains}`; },
    async arm({ page }, input) {
      return { async check() {
        const current = page.url();
        const matched = 'exact' in input ? current === input.exact : current.includes(input.contains);
        return { matched, message: `page URL is ${current}`, evidence: { url: current } };
      } };
    },
  }) as ProofAdapter<JsonValue>,
  'ui.elementVisible': defineProof<LocatorInput>({
    parse: locatorInput,
    describe(input) { return `${locatorDescription(input)} is visible`; },
    async arm({ page }, input) {
      return { async check() {
        const matched = await locate(page, input).isVisible().catch(() => false);
        return { matched, message: `${locatorDescription(input)} is ${matched ? '' : 'not '}visible` };
      } };
    },
  }) as ProofAdapter<JsonValue>,
  'ui.elementEnabled': defineProof<LocatorInput>({
    parse: locatorInput,
    describe(input) { return `${locatorDescription(input)} is enabled`; },
    async arm({ page }, input) {
      return { async check() {
        const matched = await locate(page, input).isEnabled().catch(() => false);
        return { matched, message: `${locatorDescription(input)} is ${matched ? '' : 'not '}enabled` };
      } };
    },
  }) as ProofAdapter<JsonValue>,
  'browser.consoleError': defineProof<Record<string, never>>({
    parse: emptyInput,
    describe() { return 'the browser emits a console error'; },
    async arm({ page }) {
      const messages: string[] = [];
      const listener = (message: { type(): string; text(): string }) => {
        if (message.type() === 'error') messages.push(message.text());
      };
      page.on('console', listener);
      return {
        async check() {
          return { matched: messages.length > 0, message: messages.length ? messages.join('; ') : 'no console error emitted', evidence: messages };
        },
        async dispose() { page.off('console', listener); },
      };
    },
  }) as ProofAdapter<JsonValue>,
  'browser.pageError': defineProof<Record<string, never>>({
    parse: emptyInput,
    describe() { return 'the page emits an uncaught error'; },
    async arm({ page }) {
      const messages: string[] = [];
      const listener = (error: Error) => messages.push(error.message);
      page.on('pageerror', listener);
      return {
        async check() {
          return { matched: messages.length > 0, message: messages.length ? messages.join('; ') : 'no uncaught page error emitted', evidence: messages };
        },
        async dispose() { page.off('pageerror', listener); },
      };
    },
  }) as ProofAdapter<JsonValue>,
};

export async function loadConfig(root = process.cwd()): Promise<SchwiflyConfig> {
  const configFile = resolve(root, 'schwifly.config.ts');
  if (!existsSync(configFile)) return {};
  const url = `${pathToFileURL(configFile).href}?schwifly=${Date.now()}`;
  let inTest = false;
  try { test.info(); inTest = true; } catch { /* The public API also runs outside Playwright. */ }
  // Playwright owns TypeScript loading in tests. Installing a second loader conflicts with it.
  const imported = await (inTest ? import(url) : tsImport(url, import.meta.url)) as { default?: SchwiflyConfig };
  return imported.default ?? {};
}

export async function loadProofRegistry(root = process.cwd()): Promise<ProofRegistry> {
  const custom = (await loadConfig(root)).proofs ?? {};
  for (const [name, adapter] of Object.entries(custom)) {
    if (!adapter || typeof adapter.parse !== 'function' || typeof adapter.describe !== 'function' || typeof adapter.arm !== 'function') {
      throw new ProofValidationError([`schwifly.config.ts proofs.${name} must be a proof adapter`]);
    }
  }
  return { ...builtInProofs, ...custom };
}

function clauses(story: StoryContract): Array<{ clause: ProofClause; polarity: ProofPolarity; path: string }> {
  return [
    ...story.proofs.must.map((clause, index) => ({ clause, polarity: 'must' as const, path: `proofs.must[${index}]` })),
    ...story.proofs.mustNot.map((clause, index) => ({ clause, polarity: 'mustNot' as const, path: `proofs.mustNot[${index}]` })),
  ];
}

export function validateProofs(story: StoryContract, registry: ProofRegistry): ValidatedProof[] {
  const errors: string[] = [];
  const validated: ValidatedProof[] = [];
  for (const { clause, polarity, path } of clauses(story)) {
    const adapter = registry[clause.use];
    if (!adapter) {
      errors.push(`${path}.use unknown proof adapter: ${clause.use}`);
      continue;
    }
    try {
      const input = adapter.parse(clause.with);
      const description = redact(adapter.describe(input));
      validated.push({ storyId: story.id, clauseId: clause.id, adapterName: clause.use, adapter, polarity, input, description });
    } catch (error) {
      errors.push(`${path}.with ${redact((error as Error).message)}`);
    }
  }
  if (errors.length) throw new ProofValidationError(errors);
  return validated;
}

export async function loadAndValidateProofs(loaded: LoadedStory): Promise<ValidatedProof[]> {
  return validateProofs(loaded.story, await loadProofRegistry(loaded.root));
}

function safeJson(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(safeJson);
  return Boolean(value) && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
    && Object.values(value as Record<string, unknown>).every(safeJson);
}

function errorRecord(proof: ValidatedProof, error: unknown, file?: string): ProofRecord {
  return {
    storyId: proof.storyId,
    clauseId: proof.clauseId,
    adapter: proof.adapterName,
    polarity: proof.polarity,
    status: 'error',
    message: redact(error instanceof Error ? error.message : String(error)),
    file,
  };
}

function resultRecord(proof: ValidatedProof, result: unknown, file?: string): ProofRecord {
  if (!result || typeof result !== 'object') return errorRecord(proof, 'proof returned no result', file);
  const value = result as Partial<ProofResult>;
  if (typeof value.matched !== 'boolean' || typeof value.message !== 'string') {
    return errorRecord(proof, 'proof returned an invalid result', file);
  }
  if (value.evidence !== undefined && !safeJson(value.evidence)) {
    return errorRecord(proof, 'proof returned non-JSON evidence', file);
  }
  const pass = proof.polarity === 'must' ? value.matched : !value.matched;
  return {
    storyId: proof.storyId,
    clauseId: proof.clauseId,
    adapter: proof.adapterName,
    polarity: proof.polarity,
    matched: value.matched,
    status: pass ? 'pass' : 'fail',
    message: redact(value.message),
    ...(value.evidence === undefined ? {} : { evidence: redact(value.evidence) as JsonValue }),
    file,
  };
}

export interface RunProofsOptions {
  proofs: ValidatedProof[];
  context: ProofContext;
  route(): Promise<void>;
  file?: string;
  persist?: boolean;
  proofLog?: string;
}

export interface ProofRun {
  records: ProofRecord[];
  routeError?: unknown;
}

export async function runProofs(options: RunProofsOptions): Promise<ProofRun> {
  const armed = new Map<string, ArmedProof>();
  const records = new Map<string, ProofRecord>();
  for (const proof of options.proofs) {
    try {
      const value = await proof.adapter.arm(options.context, proof.input);
      if (!value || typeof value.check !== 'function') throw new Error('proof arm returned no check function');
      armed.set(proof.clauseId, value);
    } catch (error) {
      records.set(proof.clauseId, errorRecord(proof, error, options.file));
    }
  }

  let routeError: unknown;
  try {
    try {
      await options.route();
    } catch (error) {
      routeError = error;
    }
    for (const proof of options.proofs) {
      if (records.has(proof.clauseId)) continue;
      try {
        records.set(proof.clauseId, resultRecord(proof, await armed.get(proof.clauseId)?.check(), options.file));
      } catch (error) {
        records.set(proof.clauseId, errorRecord(proof, error, options.file));
      }
    }
  } finally {
    for (const proof of options.proofs) {
      const active = armed.get(proof.clauseId);
      if (!active?.dispose) continue;
      try {
        await active.dispose();
      } catch (error) {
        records.set(proof.clauseId, errorRecord(proof, error, options.file));
      }
    }
  }

  const ordered = options.proofs.map((proof) => records.get(proof.clauseId) ?? errorRecord(proof, 'missing proof result', options.file));
  if (options.persist !== false) for (const record of ordered) writeProofRecord(record, options.proofLog);
  return { records: ordered, ...(routeError === undefined ? {} : { routeError }) };
}

export function proofDescriptions(proofs: ValidatedProof[]): string[] {
  return proofs.map((proof) => `${proof.clauseId}: ${proof.polarity === 'mustNot' ? 'must not match' : 'must match'} ${proof.description}`);
}
