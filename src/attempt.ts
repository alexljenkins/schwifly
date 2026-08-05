import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import type { Page } from '@playwright/test';
import { emit, type EmitAssertion, type EmitStep } from './emit';
import { stableSelector } from './generate';
import { openSharedSession } from './sharedCdp';
import { redact } from './secrets';
import { clearRunLogs, readRunLogs, STEP_LOG } from './runLogs';
import type { StepResult } from './workflow';
import {
  contractFromTicket,
  normalizeActions,
  proposedContract,
  type CapturedAction,
  type OutcomeContract,
} from './capture';

// task-to-verified-flow: an arbitrary ticket becomes a BOUNDED agent attempt, whose useful
// observed actions become a deterministic .spec.ts, which is then replayed agent-free and saved
// only on GREEN.
//
// Two rules make this trustworthy:
//   1. The outcome contract comes from the TICKET, up front — the concrete observable end state.
//      The emitted spec asserts it; the replay gate is the judge. An agent that claims success
//      while the contract does not hold FAILS, exits non-zero, and saves nothing.
//   2. Nothing the agent says is evidence. Its narration, message, done.reasoning and
//      self-reported success are debug context only (see capture.ts).

export interface Discovery {
  /** Successful, concrete browser actions, in order (agent narration already discarded). */
  actions: CapturedAction[];
  /** Contract checks that were observed to hold, bound to a real page locator. */
  assertions: EmitAssertion[];
  /** Contract checks that did NOT hold on the final page. Non-empty => the attempt failed. */
  unmet: string[];
  /** Agent testimony. Debug only — never an assertion. */
  notes: string;
}

export interface DiscoveryRequest {
  ticket: string;
  url: string;
  maxSteps: number;
  visible: boolean;
  contract: OutcomeContract;
}

export interface AttemptOptions {
  ticket: string;
  url: string;
  title: string;
  out: string;
  maxSteps?: number;
  visible?: boolean;
  /** Seams: the live implementations are the defaults; tests inject fakes to stay key-free. */
  discover?: (req: DiscoveryRequest) => Promise<Discovery>;
  resolveContract?: (ticket: string, url: string, visible: boolean) => Promise<OutcomeContract | null>;
  replay?: (file: string) => Promise<boolean>;
}

export interface AttemptResult {
  ok: boolean;
  /** Why it failed, already redacted. Present only when ok === false. */
  reason?: string;
  /** Path the workflow was written to. Present ONLY on success. */
  saved?: string;
  /** Candidate spec source, kept as debug evidence when the run fails. */
  candidate?: string;
  contract?: OutcomeContract;
}

// Small fixed defaults. A bounded attempt is a locked constraint, not a knob.
export const MAX_STEPS = 12;
const DEBUG = process.env.SCHWIFLY_DEBUG === '1';
// Candidates live in their own depth-1 dir: '../src/...' imports resolve, the `candidate`
// Playwright project can find them, and `schwifly run workflows/` never picks one up.
const CANDIDATE = 'candidates/candidate.spec.ts';

/**
 * The whole loop: contract -> bounded attempt -> normalize -> emit -> agent-free replay -> save.
 * Every failure path returns ok:false and leaves no workflow behind.
 */
export async function attemptFlow(opts: AttemptOptions): Promise<AttemptResult> {
  const maxSteps = opts.maxSteps ?? MAX_STEPS;
  const visible = opts.visible ?? false;

  // 1. Resolve the outcome contract BEFORE trusting anything the attempt produces.
  const resolve = opts.resolveContract ?? proposeContractLive;
  const contract = contractFromTicket(opts.ticket) ?? (await resolve(opts.ticket, opts.url, visible));
  if (!contract) {
    return { ok: false, reason: 'no outcome contract: state the expected result, e.g. <expect>Delete</expect>' };
  }

  // 2. Bounded, same-origin attempt. Discovery observes the browser; it does not interview the agent.
  const discover = opts.discover ?? liveDiscover;
  const discovery = await discover({ ticket: opts.ticket, url: opts.url, maxSteps, visible, contract });

  // 3. The contract is the judge. A lying agent dies here, before anything is emitted or saved.
  if (discovery.unmet.length || !discovery.assertions.length) {
    return {
      ok: false,
      contract,
      reason: redact(`outcome contract not met: ${discovery.unmet.join('; ') || 'no observable evidence'}`),
    };
  }

  const steps = normalizeActions(discovery.actions);
  const source = emit({
    title: opts.title,
    url: opts.url,
    steps,
    assertions: discovery.assertions,
    contract: { summary: contract.summary, checks: contract.checks.map((c) => c.intent), source: contract.source },
  });

  // 4. Certification: replay the candidate in a FRESH session with the agent and the heal tier
  //    both disabled, so discovery cannot certify itself by healing an inaccurate capture.
  write(CANDIDATE, source);
  const replay = opts.replay ?? replayAgentFree;
  const green = await replay(CANDIDATE);
  if (!green) {
    // Candidate stays on disk as redacted debug evidence; no workflow is created or overwritten.
    return { ok: false, contract, candidate: source, reason: `replay failed; candidate kept at ${CANDIDATE}` };
  }

  write(opts.out, source);
  rmSync(CANDIDATE, { force: true });
  return { ok: true, saved: opts.out, contract, candidate: source };
}

function write(file: string, source: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source);
}

// --- live replay gate ---------------------------------------------------------------------
// A fresh Playwright process, the emitted spec only, no autonomous agent, and SCHWIFLY_NO_HEAL=1
// so a broken locator fails instead of being quietly repaired.
//
// The process exit code alone is NOT the gate: step() deliberately records a failed step and
// keeps going (the verdict table, not an exception, is how a run reports itself), so a spec whose
// every step failed still exits 0. GREEN means the step log says every step ran ok.
async function replayAgentFree(file: string): Promise<boolean> {
  clearRunLogs(STEP_LOG);
  const r = spawnSync('npx', ['playwright', 'test', file, '--reporter=line'], {
    stdio: 'inherit',
    env: { ...process.env, SCHWIFLY_NO_HEAL: '1' },
  });
  const results = readRunLogs<StepResult>(STEP_LOG).filter((s) => s.file?.endsWith(basename(file)));
  const green = replayGreen(r.status ?? 1, results);
  if (!green) {
    const bad = results.filter((s) => s.status !== 'ok').map((s) => redact(s.intent));
    console.error(`schwifly attempt: replay NOT green (${bad.join('; ') || 'no steps recorded'})`);
  }
  return green;
}

/**
 * The certification decision, pure so it can be proven key-free.
 *
 * A zero exit code is NOT enough: a failed step is recorded and the run continues, so a spec whose
 * every step failed still exits 0. A healed step is not enough either — healing is disabled for
 * this replay, so a 'healed' status would mean the gate ran without its guard.
 */
export function replayGreen(exitCode: number, results: StepResult[]): boolean {
  return exitCode === 0 && results.length > 0 && results.every((s) => s.status === 'ok');
}

// --- live discovery -----------------------------------------------------------------------

// Vague ticket ("the user can reset their password") -> concrete observable text, resolved UP
// FRONT against the start page. It must land on deterministic page assertions; this proposal is
// the ONLY judgement call, and it happens before the attempt, never at replay time.
async function proposeContractLive(ticket: string, url: string, visible: boolean): Promise<OutcomeContract | null> {
  const session = await openSharedSession({ headed: visible });
  try {
    await session.page.goto(url);
    const answer = await session.stagehand.extract(
      `A tester was given this request: "${ticket}". List the exact on-screen text snippets ` +
        `(one per line, at most 3, each under 60 characters, copied verbatim from what the page ` +
        `would show) that must be visible for the request to be satisfied. Text only, no commentary.`,
      { page: session.page as never },
    );
    const texts = String(answer?.extraction ?? '')
      .split('\n')
      .map((l) => l.replace(/^[-*\d.\s]+/, '').replace(/^["']|["']$/g, '').trim())
      .filter((l) => l.length > 0 && l.length <= 60)
      .slice(0, 3);
    return proposedContract(ticket, texts);
  } finally {
    await session.close();
  }
}

/**
 * Run the bounded attempt and capture BROWSER FACTS:
 * pair each successful `step_finished` (which carries the real Playwright selector/method/args)
 * with the following `step_observed` post-step URL, then verify the contract against the final
 * page and bind each satisfied check to a stable locator.
 */
export async function liveDiscover(req: DiscoveryRequest): Promise<Discovery> {
  const session = await openSharedSession({ evidence: true, headed: req.visible });
  try {
    const { page, stagehand } = session;
    await guardOrigin(page, req.url);
    await page.goto(req.url);

    const actions: CapturedAction[] = [];
    let pending: CapturedAction[] = [];
    // Stagehand wraps tool results in an AI SDK envelope: the native return value (and with it
    // the real Playwright selector) lives at result.output, not result.
    const onEvidence = async (event: { type: string; [k: string]: unknown }): Promise<void> => {
      if (DEBUG) console.error(`[attempt:evidence] ${event.type} ${redact(JSON.stringify(event.toolOutput ?? event.url ?? '')).slice(0, 600)}`);
      if (event.type === 'step_finished') {
        const out = event.toolOutput as { ok?: boolean; result?: { output?: Record<string, unknown> } } | undefined;
        const payload = (out?.result?.output ?? out?.result) as Record<string, unknown> | undefined;
        const native = payload?.playwrightArguments as
          | { selector?: string; description?: string; method?: string; arguments?: unknown[] }
          | undefined;
        if (!native?.selector || !native.method) return; // reasoning/ariaTree/screenshot tools
        // Stagehand's own outcome, never the agent's opinion of it.
        const ok = out?.ok === true && payload?.success !== false;
        const captured: CapturedAction = {
          method: native.method,
          // Rewrite the raw xpath into the same stable plain-string selector shape `schwifly gen`
          // emits, while the element is still on the page.
          selector: await stableSelector(page.locator(native.selector).first(), native.selector).catch(
            () => native.selector as string,
          ),
          description: native.description ?? '',
          args: (native.arguments ?? []).map((a) => String(a)),
          ok,
        };
        actions.push(captured);
        pending.push(captured);
        if (req.visible) console.error(`[attempt] ${captured.method} ${redact(captured.description)}`);
      } else if (event.type === 'step_observed') {
        // One probe covers every step since the previous probe (Stagehand's documented semantics).
        for (const p of pending) p.postUrl = String(event.url ?? '');
        pending = [];
      }
    };

    const agent = stagehand.agent({ mode: 'dom' });
    const result = await agent.execute({
      instruction:
        `${req.ticket}\n\nStay on ${new URL(req.url).origin}. Do not open other sites. ` +
        `Stop as soon as this is true: ${req.contract.checks.map((c) => c.intent).join('; ')}.`,
      maxSteps: req.maxSteps,
      page: page as never,
      callbacks: { onEvidence } as never,
    });

    const { assertions, unmet } = await bindContract(page, req.contract);
    return { actions, assertions, unmet, notes: redact(String(result?.message ?? '')) };
  } finally {
    await session.close();
  }
}

// Same-origin at the BROWSER, not in the prompt: any cross-origin navigation is aborted, so the
// bounded attempt physically cannot wander off the app under test. Cross-origin subresources
// (fonts, CDN scripts) are left alone — blocking those breaks rendering without bounding anything.
async function guardOrigin(page: Page, url: string): Promise<void> {
  const origin = new URL(url).origin;
  await page.context().route('**/*', (route) => {
    const req = route.request();
    if (!req.isNavigationRequest()) return route.continue();
    let target: string;
    try {
      target = new URL(req.url()).origin;
    } catch {
      return route.continue();
    }
    return target === origin ? route.continue() : route.abort();
  });
}

// The contract, checked against the page the agent actually left behind. Each satisfied check
// becomes an expectText assertion on a stable locator; each unsatisfied one fails the run.
async function bindContract(
  page: Page,
  contract: OutcomeContract,
): Promise<{ assertions: EmitAssertion[]; unmet: string[] }> {
  const assertions: EmitAssertion[] = [];
  const unmet: string[] = [];
  for (const check of contract.checks) {
    const loc = page.getByText(check.text, { exact: false }).first();
    const visible = await loc.isVisible({ timeout: 5000 }).catch(() => false);
    if (!visible) {
      unmet.push(check.intent);
      continue;
    }
    const locator = await stableSelector(loc, `text=${check.text}`).catch(() => `text=${check.text}`);
    assertions.push({ type: 'exact', value: check.text, intent: check.intent, locator });
  }
  return { assertions, unmet };
}

export type { CapturedAction, OutcomeContract };
export type { EmitStep };
