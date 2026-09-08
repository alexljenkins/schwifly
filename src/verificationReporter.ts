import type { FullResult, Reporter, TestCase, TestError, TestResult } from '@playwright/test/reporter';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { redact } from './secrets.js';

/** The terminal shows the verdict. Runner chatter remains available in one log. */
export default class VerificationReporter implements Reporter {
  private tests = new Map<TestCase, TestResult>();
  private errors: TestError[] = [];
  private log = '.schwifly/verification.log';
  onBegin() {
    mkdirSync('.schwifly', { recursive: true });
    writeFileSync(this.log, '', { mode: 0o600 });
    process.stdout.write(`Checking tests. Progress log: ${this.log}\n`);
  }
  onStdOut(chunk: string | Buffer) { this.append(chunk.toString()); }
  onStdErr(chunk: string | Buffer) { this.append(chunk.toString()); }
  onError(error: TestError) { this.errors.push(error); this.append(error.message ?? String(error)); }
  onTestEnd(test: TestCase, result: TestResult) {
    this.tests.set(test, result);
    this.append(`${result.status}: ${test.titlePath().filter(Boolean).join(' > ')}\n`);
    for (const error of result.errors) this.append((error.stack ?? error.message ?? String(error)) + '\n');
  }
  onEnd(result: FullResult) {
    let passed = 0; let failed = 0; let skipped = 0; let flaky = 0;
    for (const [test, check] of this.tests) {
      if (check.status === 'skipped') skipped++;
      else if (test.outcome() === 'flaky') flaky++;
      else if (test.outcome() === 'expected') passed++;
      else {
        failed++;
        process.stdout.write(`FAILED ${test.location.file}:${test.location.line} ${redact(test.title)}\n`);
        const message = check.errors[0]?.message?.replace(/\u001b\[[0-9;]*m/g, '').split('\n').find(line => line.trim());
        if (message) process.stdout.write(`  ${redact(message).slice(0, 300)}\n`);
      }
    }
    for (const error of this.errors) process.stdout.write(`ERROR ${redact(error.message ?? 'runner error').slice(0, 300)}\n`);
    process.stdout.write(`${result.status.toUpperCase()}  ${passed} passed  ${failed} failed  ${skipped} skipped${flaky ? `  ${flaky} flaky` : ''}  ${(result.duration / 1000).toFixed(1)}s\n`);
    if (failed || flaky || this.errors.length) process.stdout.write(`Details: ${this.log}\n`);
  }
  private append(text: string) { appendFileSync(this.log, redact(text)); }
}
