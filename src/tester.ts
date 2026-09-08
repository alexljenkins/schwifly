import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import { expect } from '@playwright/test';
import { bindContract, captureSession, guardOrigin } from './attempt.js';
import { contractFromTicket, proposedContract, type CapturedAction, type OutcomeContract } from './capture.js';
import { emit, type EmitAssertion, type EmitStep } from './emit.js';
import { elementMeasurements, inspectPress } from './testerEvidence.js';
import { stableSelector } from './generate.js';
import { captureFailure } from './evidence.js';
import { openConfiguredSession } from './session.js';
import type { SharedSession } from './sharedCdp.js';
import { loadConfig } from './proofs.js';
import { certifySource, workflowPath, workspacePath } from './oneOff.js';
import { atomicJson, backgroundDirectory, progress } from './background.js';
import { testerDirectory, type TesterRecord, type TesterRequest } from './testerStore.js';
import { redact, registerSecrets } from './secrets.js';
import { modelCredential, selectedModel } from './settings.js';
import { DEFAULT_MODEL, OPENROUTER_URL } from './llm.js';

interface Snapshot { label: string; path: string; hash: string; framing: 'element' | 'page' }
interface Check {
  actionOffset: number; measurements?: unknown; press?: unknown;
  instruction: string; actions: CapturedAction[]; assertions: EmitAssertion[]; contract: OutcomeContract | null;
  unmet: string[]; screenshots: Snapshot[]; element?: string; padding: number; opinions: string; errors: string[];
}
export type TesterDiscovery = (session: SharedSession, instruction: string, context: string) => Promise<{ actions: CapturedAction[]; notes: string }>;
const liveDiscovery: TesterDiscovery = async (session, instruction, context) => {
  const result = await captureSession(session, 12, false, async (_page, execute) => execute(
    `${context}\nCurrent request: ${instruction}\nStay on the current app origin. Give concise findings. Separate uncertain claims from observations.`,
  ));
  return { actions: result.actions, notes: result.value };
};

/** Preserve exact supported actions. Never silently drop an action when saving or comparing. */
export function testerSteps(actions: CapturedAction[]): EmitStep[] {
  return actions.filter(action => action.ok).map(action => {
    if (!['click', 'fill', 'type'].includes(action.method)) throw new Error(`cannot replay ${action.method}; repeat this check with supported click/fill actions`);
    if (!action.selector) throw new Error('captured action has no selector');
    if (action.method !== 'click' && redact({ [action.description]: action.args[0] ?? '' })[action.description] !== (action.args[0] ?? '')) throw new Error('captured input contains a secret; move login into the app setup hook');
    return { intent: `${action.method} ${action.description || 'element'}`, locator: action.selector,
      action: action.method === 'click' ? 'click' : 'fill', ...(action.method !== 'click' ? { value: action.args[0] ?? '' } : {}) };
  });
}

export class Tester {
  session?: SharedSession;
  private history: Array<{ instruction: string; findings: string }> = [];
  private actions: CapturedAction[] = [];
  private last?: Check;
  private baseline?: Check;
  private errors: string[] = [];
  constructor(readonly record: TesterRecord, private discover: TesterDiscovery = liveDiscovery,
    private opinion: (files: Snapshot[], instruction: string) => Promise<string> = visualOpinion) {}

  async open() {
    this.session = await openConfiguredSession({ url: this.record.url, phase: 'discovery', evidence: true, headed: !this.record.headless, persistent: true });
    await guardOrigin(this.session.page, this.record.url);
    this.record.debug = this.session.stagehand.connectURL();
    this.session.page.on('console', message => { if (message.type() === 'error') this.error(`console: ${message.text()}`); });
    this.session.page.on('pageerror', error => this.error(`page: ${error.message}`));
    this.session.page.on('requestfailed', request => this.error(`request: ${request.method()} ${request.url()} ${request.failure()?.errorText}`));
    this.session.page.on('response', response => { if (response.status() >= 400) this.error(`HTTP ${response.status()}: ${response.url()}`); });
  }
  private error(message: string) { this.errors.push(redact(message).slice(0, 500)); this.errors = this.errors.slice(-20); }
  async close() { await this.session?.close(); this.session = undefined; }
  async reset() {
    await this.close();
    this.history = []; this.actions = []; this.last = undefined; this.baseline = undefined; this.errors = [];
    atomicJson(`${testerDirectory(this.record.id)}/memory.json`, { history: [], baseline: null });
    await this.open();
  }
  private async restartInteraction() {
    const session = this.session!;
    const config = await loadConfig(process.cwd());
    await session.page.goto(this.record.url);
    await config.setup?.({ page: session.page, browserContext: session.page.context(), url: this.record.url, phase: 'discovery' });
    await session.page.goto(this.record.url);
  }
  private async screenshot(id: string, label: string, element?: string, padding = 12): Promise<Snapshot> {
    const path = workspacePath(`${backgroundDirectory(id)}/${label}.png`);
    const target = label === 'after' && element && !await this.session!.page.locator(element).isVisible().catch(() => false) ? undefined : element;
    if (!await captureFailure(this.session!.page, undefined, path, target ? { selector: target, padding } : undefined)) {
      throw new Error(`could not capture ${element ?? 'page'}; choose a visible, unique --element`);
    }
    return { label, framing: target ? 'element' : 'page', path: relative(process.cwd(), path), hash: createHash('sha256').update(readFileSync(path)).digest('hex') };
  }
  async execute(request: TesterRequest, signal = new AbortController().signal): Promise<unknown> {
    if (request.operation === 'stop') { await this.close(); return { status: 'stopped' }; }
    if (request.operation === 'reset') { await this.reset(); return { status: 'reset', context: 'cleared', debug: this.record.debug }; }
    const session = this.session!;
    session.beginTurn();
    if (request.operation === 'baseline') {
      if (!this.last) throw new Error('no check to mark; use schwifly session ask first');
      this.baseline = structuredClone(this.last);
      this.persist();
      return { status: 'baseline saved', screenshots: this.baseline.screenshots.map(({ label, path, framing }) => ({ label, path, framing })) };
    }
    if (request.operation === 'save') return this.save(request, signal);
    const again = request.operation === 'ask' && /^(?:try|check|test|run)(?: (?:it|that|this|the (?:button|check|interaction|flow)))? again[.!?]?$/i.test(request.instruction!.trim());
    if (request.operation === 'compare' || again) {
      const previous = request.operation === 'compare' ? this.baseline : this.last;
      if (!previous) throw new Error('no previous check; ask for a check and mark a baseline first');
      return this.replay(request, previous, request.operation === 'compare');
    }
    this.last = undefined;
    const instruction = request.instruction!;
    progress(request.id, 'Checking the app in the existing browser.');
    let element = request.element;
    // Explicit selectors skip target discovery. Otherwise infer one target for focused images.
    if (!element && this.discover === liveDiscovery && modelCredential()) {
      const targets = await session.stagehand.observe(`Find the main element this tester request refers to: ${instruction}`, { page: session.page as never });
      element = targets[0]?.selector;
      if (element) element = await stableSelector(session.page.locator(element), element).catch(() => element);
    }
    const padding = request.padding ?? 12;
    const screenshots = [await this.screenshot(request.id, 'before', element, padding)];
    const measurements = element ? await elementMeasurements(session.page, element) : undefined;
    const press = element && /press|animation|mouse.?down/i.test(instruction) ? await inspectPress(session.page, element, async () => {
      screenshots.push(await this.screenshot(request.id, 'pressed', element, padding));
    }) : undefined;
    const actionOffset = this.actions.length;
    let contract = contractFromTicket(instruction);
    if (!contract && this.discover === liveDiscovery && modelCredential()) {
      const answer = await session.stagehand.extract(
        `Before acting, identify the behavior requested here: ${instruction}. Return at most 3 exact visible text snippets expected after the interaction, one per line. Exclude appearance and animation opinions. Return NONE if no text outcome is specified or inferable.`,
        { page: session.page as never },
      );
      const texts = String(answer?.extraction ?? '').split('\n').map(line => line.replace(/^[-*\d.\s]+/, '').trim()).filter(line => line && line !== 'NONE' && line.length <= 80).slice(0, 3);
      contract = proposedContract(instruction, texts);
    }
    const context = this.history.map(item => `Earlier request: ${item.instruction}\nFindings: ${item.findings}`).join('\n');
    const onlyChecks = contract && !instruction.replace(/<(expect|validate)[^>]*>.*?<\/\1>/g, '').trim();
    const discovery = onlyChecks ? { actions: [], notes: '' } : await this.discover(session, instruction, context).catch(error => {
      this.actions.push(...((error as { actions?: CapturedAction[] }).actions ?? []));
      throw error;
    });
    registerSecrets(discovery.actions.filter(action => ['fill', 'type'].includes(action.method)).map(action => ({ key: action.description, value: action.args[0] ?? '' })));
    this.actions.push(...discovery.actions);
    const result = contract ? await bindContract(session.page, contract) : { assertions: [], unmet: [] };
    screenshots.push(await this.screenshot(request.id, 'after', element, padding));
    progress(request.id, 'Browser actions finished. Reviewing the screenshots.');
    const visual = await this.opinion(screenshots, instruction).catch(() => 'Visual review unavailable. Browser checks remain separate.');
    const opinions = redact(`${discovery.notes.slice(0, 1000)}\n${visual}`).trim();
    this.last = { instruction, actionOffset, measurements, press, actions: structuredClone(this.actions), ...result, contract, screenshots, element, padding, opinions, errors: [...this.errors] };
    this.history.push({ instruction: redact(instruction).slice(0, 2000), findings: redact(`${result.unmet.length ? result.unmet.join(', ') : 'Observed'} ${discovery.notes} ${opinions}`).slice(0, 1500) });
    this.history = this.history.slice(-8);
    this.errors = [];
    this.persist();
    return this.findings(this.last);
  }
  private persist() {
    atomicJson(`${testerDirectory(this.record.id)}/memory.json`, redact({ history: this.history, last: this.last, baseline: this.baseline }));
  }
  private findings(check: Check) {
    return { status: check.unmet.length ? 'failed' : check.assertions.length ? 'passed' : 'observed',
      verified: check.assertions.map(assertion => assertion.intent), failed: check.unmet,
      ...(check.measurements ? { measurements: check.measurements } : {}),
      ...(check.press ? { press: check.press } : {}),
      actions: check.actions.filter(action => action.ok).length,
      opinions: check.opinions || 'No visual opinion requested.',
      browserErrors: check.errors, screenshots: check.screenshots.map(({ label, path, framing }) => ({ label, path, framing })),
      ...(!check.assertions.length && !check.unmet.length ? { note: 'No outcome assertion. Add <expect>visible text</expect> to verify behavior and save a test.' } : {}) };
  }
  private async replay(request: TesterRequest, previous: Check, compare: boolean) {
    this.last = undefined;
    const steps = testerSteps(previous.actions);
    progress(request.id, 'Resetting the app and replaying the same captured interaction without model actions.');
    await this.restartInteraction();
    const screenshots: Snapshot[] = [];
    const unmet: string[] = [];
    let measurements: unknown;
    let press: unknown;
    const checkpoint = async () => {
      screenshots.push(await this.screenshot(request.id, 'before', previous.element, previous.padding));
      measurements = previous.element ? await elementMeasurements(this.session!.page, previous.element) : undefined;
      if (previous.press && previous.element) press = await inspectPress(this.session!.page, previous.element, async () => {
        screenshots.push(await this.screenshot(request.id, 'pressed', previous.element, previous.padding));
      });
    };
    const offset = previous.actions.slice(0, previous.actionOffset).filter(action => action.ok).length;
    for (const [index, step] of steps.entries()) {
      if (index === offset) await checkpoint();
      try {
        const locator = this.session!.page.locator(step.locator);
        if (step.action === 'click') await locator.click(); else await locator.fill(step.value!);
      } catch { unmet.push(`could not ${step.intent}`); break; }
    }
    if (!screenshots.length) await checkpoint();
    const assertions: EmitAssertion[] = [];
    for (const assertion of previous.assertions) {
      const locator = this.session!.page.locator(assertion.locator);
      try { await expect(locator).toBeVisible(); await expect(locator).toContainText(assertion.value); assertions.push(assertion); }
      catch { unmet.push(assertion.intent); }
    }
    // Previously failed explicit checks remain part of the comparison contract too.
    if (previous.contract) {
      const bound = await bindContract(this.session!.page, previous.contract);
      for (const assertion of bound.assertions) if (!assertions.some(item => item.intent === assertion.intent)) assertions.push(assertion);
      for (const failure of bound.unmet) if (!unmet.includes(failure)) unmet.push(failure);
    }
    screenshots.push(await this.screenshot(request.id, 'after', previous.element, previous.padding));
    const opinions = await this.opinion(screenshots, previous.instruction).catch(() => 'Visual review unavailable. Browser checks remain separate.');
    const current: Check = { ...previous, assertions, unmet, screenshots, opinions, measurements, press, errors: [...this.errors] };
    this.errors = [];
    this.last = current;
    this.actions = structuredClone(previous.actions);
    this.persist();
    return { ...this.findings(current), ...(compare ? {
      comparison: screenshots.map(shot => ({ label: shot.label, before: previous.screenshots.find(old => old.label === shot.label)?.path, after: shot.path,
        image: previous.screenshots.find(old => old.label === shot.label)?.hash === shot.hash ? 'unchanged' : 'changed' })),
      behavior: { before: previous.unmet, after: unmet }, note: 'Image changes are observations, not visual pass/fail judgments.',
    } : {}) };
  }
  private async save(request: TesterRequest, signal: AbortSignal) {
    const check = this.last;
    if (!check || check.unmet.length || !check.assertions.length) throw new Error('no passing outcome to save; ask with <expect>visible text</expect> first');
    const destination = workflowPath(request.name!);
    if (existsSync(destination)) throw new Error('workflow already exists; choose another name');
    const source = emit({ title: request.name!, url: this.record.url, steps: testerSteps(check.actions), assertions: check.assertions });
    const directory = backgroundDirectory(request.id);
    writeFileSync(workspacePath(`${directory}/candidate.spec.ts`), source, { flag: 'wx', mode: 0o600 });
    progress(request.id, 'Checking the saved interaction in a fresh browser. Model repair is disabled.');
    if (!await certifySource(source, directory)) throw new Error('fresh replay failed; workflow was not saved');
    signal.throwIfAborted();
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, source, { flag: 'wx' });
    return { status: 'saved', saved: relative(process.cwd(), destination), verification: 'fresh replay passed' };
  }
}

async function visualOpinion(screenshots: Snapshot[], instruction: string): Promise<string> {
  const key = modelCredential();
  if (!key) return 'Visual review unavailable without a model credential.';
  const response = await fetch(`${OPENROUTER_URL}/chat/completions`, {
    method: 'POST', signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: selectedModel(DEFAULT_MODEL), max_tokens: 350, messages: [{ role: 'user', content: [
      { type: 'text', text: `Review these before and after screenshots for: ${instruction}. Give at most 3 short visual findings. These are opinions, not verified behavior. Do not claim an animation or click worked from still images. If you cannot assess something, say so.` },
      ...screenshots.map(shot => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${readFileSync(workspacePath(shot.path)).toString('base64')}` } })),
    ] }] }),
  });
  if (!response.ok) return `Visual review unavailable (HTTP ${response.status}).`;
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return redact(data.choices?.[0]?.message?.content ?? 'No visual findings returned.').slice(0, 1500);
}
