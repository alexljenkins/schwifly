import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { workerLogPath } from './runLogs';
import type { ProofRecord } from './proofs';

export const PROOF_LOG = '.schwifly/proofs.ndjson';

export function writeProofRecord(record: ProofRecord, path: string = PROOF_LOG): void {
  const file = workerLogPath(path);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(record)}\n`);
}
