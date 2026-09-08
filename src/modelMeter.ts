import { appendFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { readRunLogs, runLogPaths } from './runLogs.js';

/**
 * One model request, appended to the file named by SCHWIFLY_MODEL_LOG.
 *
 * Discovery runs in this process and repair runs in a Playwright child, so the meter is a file
 * rather than an in-memory counter. The record shape is the contract a benchmark reads: any
 * future Stagehand adapter that calls a model must append the same fields, or its cost column
 * is empty while its latency column is not.
 */
export interface ModelCall {
  /** OpenRouter model id, without an AI SDK provider prefix. */
  model: string;
  /** 1-based index within the calling process. Two processes both start at 1. */
  call: number;
  /** Wall-clock duration of the provider request. */
  ms: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  ok: boolean;
}

export function modelLogPath(): string | undefined {
  return process.env.SCHWIFLY_MODEL_LOG || undefined;
}

export function recordModelCall(record: ModelCall, path = modelLogPath()): void {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(record) + '\n');
}

export function readModelCalls(path: string): ModelCall[] {
  return readRunLogs<ModelCall>(path);
}

export function clearModelCalls(path: string): void {
  for (const file of runLogPaths(path)) rmSync(file, { force: true });
}

export interface ModelUsage {
  calls: number;
  failedCalls: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  /** Sum of provider request durations. Lower than wall clock when calls overlap. */
  latencyMs: number;
  /** True when a successful call reported no token counts, so the totals are a lower bound. */
  partialTokens: boolean;
}

export function summarizeModelCalls(calls: ModelCall[]): ModelUsage {
  const total = (pick: (call: ModelCall) => number | null): number =>
    calls.reduce((sum, call) => sum + (pick(call) ?? 0), 0);
  return {
    calls: calls.length,
    failedCalls: calls.filter((call) => !call.ok).length,
    inputTokens: total((call) => call.inputTokens),
    outputTokens: total((call) => call.outputTokens),
    cachedInputTokens: total((call) => call.cachedInputTokens),
    latencyMs: total((call) => call.ms),
    partialTokens: calls.some((call) => call.ok && (call.inputTokens === null || call.outputTokens === null)),
  };
}
