export const SESSION_TIMEOUT_MS = 120_000;
export const MODEL_TIMEOUT_MS = 30_000;
export const MAX_DISCOVERY_STEPS = 12;

export function discoverySteps(value = MAX_DISCOVERY_STEPS): number {
  if (!Number.isInteger(value) || value < 1 || value > MAX_DISCOVERY_STEPS) {
    throw new Error(`maxSteps must be an integer from 1 to ${MAX_DISCOVERY_STEPS}`);
  }
  return value;
}

export async function bounded<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void work.catch(() => {}); signal.throwIfAborted(); }
  let abort: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([work, cancelled]); }
  finally { signal.removeEventListener('abort', abort); }
}

export class CancelledError extends Error {
  constructor() { super('operation cancelled'); this.name = 'CancelledError'; }
}
