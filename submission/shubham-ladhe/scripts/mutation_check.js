#!/usr/bin/env node
/**
 * Targeted mutation check: does the suite catch the bugs that matter in a billing system?
 *
 * Each mutant below is a realistic, hand-picked bug planted in the service (double charge on
 * retry, canceled subscription reactivated, signature check bypassed, ...). For each one the
 * project is copied to a temp dir, the bug is applied, and the full suite is run. A mutant is
 * "killed" if at least one test fails. Mutants marked `survives` are known-equivalent (another
 * layer of defence makes the bug harmless) and are listed to show that on purpose.
 *
 *   node scripts/mutation_check.js            # all mutants
 *   node scripts/mutation_check.js retry      # only mutants whose id contains "retry"
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

const MUTANTS = [
  {
    id: 'lifecycle-canceled-can-reactivate',
    file: 'src/domain/lifecycle.ts',
    find: '  canceled: {},',
    replace: "  canceled: { payment_succeeded: { kind: 'move', to: 'active' } },",
  },
  {
    id: 'lifecycle-past-due-cancelable-by-api',
    file: 'src/domain/lifecycle.ts',
    find: "    retries_exhausted: { kind: 'move', to: 'canceled' },\n  },",
    replace: "    retries_exhausted: { kind: 'move', to: 'canceled' },\n    cancel_requested: { kind: 'move', to: 'canceled' },\n  },",
  },
  {
    id: 'outcome-ignores-canceled-guard',
    file: 'src/services/PaymentOutcomes.ts',
    find: "    if (outcome.subscription.status === 'canceled') return { applied: false, reason: 'subscription_canceled' };\n",
    replace: '',
  },
  {
    id: 'outcome-stale-failure-overwrites-paid-invoice',
    file: 'src/services/PaymentOutcomes.ts',
    find: "    if (outcome.invoice.status !== 'open') return { applied: false, reason: `invoice_${outcome.invoice.status}` };\n",
    replace: '',
  },
  {
    id: 'outcome-resettles-already-settled-attempt',
    file: 'src/services/PaymentOutcomes.ts',
    find: "return fresh && (fresh.status === 'pending' || fresh.status === 'unknown') ? fresh : 'already_settled';",
    replace: "return fresh ?? 'already_settled';",
  },
  {
    id: 'outcome-never-exhausts-retries',
    file: 'src/services/PaymentOutcomes.ts',
    find: "      this.move(afterFailure, 'retries_exhausted', outcome, 'retries_exhausted');\n",
    replace: '',
  },
  {
    id: 'plan-retry-budget-off-by-one',
    file: 'src/domain/plans.ts',
    find: 'if (failedAttempts >= this.maxAttempts) return null;',
    replace: 'if (failedAttempts > this.maxAttempts) return null;',
  },
  {
    id: 'signature-check-bypassed',
    file: 'src/services/WebhookSignature.ts',
    find: 'return given.length === expected.length && timingSafeEqual(given, expected);',
    replace: 'return true;',
  },
  {
    id: 'webhook-amount-not-checked',
    file: 'src/services/WebhookService.ts',
    find: '    if (event.amount !== invoice.amountCents || event.currency !== CURRENCY) {',
    replace: '    if (false) {',
  },
  {
    id: 'webhook-not-atomic',
    file: 'src/services/WebhookService.ts',
    find: '      return this.db.transaction(() => {',
    replace: '      return ((work: () => WebhookReceipt) => work())(() => {',
  },
  {
    id: 'webhook-duplicate-precheck-removed',
    file: 'src/services/WebhookService.ts',
    find: "    if (seen) return { event_id: event.event_id, outcome: 'duplicate' };\n",
    replace: '',
    survives: 'UNIQUE(event_id) rejects the second insert and the whole transaction rolls back - defence in depth',
  },
  {
    id: 'charge-new-idempotency-key-on-every-send',
    file: 'src/services/BillingEngine.ts',
    find: '        idempotencyKey: attempt.idempotencyKey,',
    replace: '        idempotencyKey: `${attempt.idempotencyKey}:${Math.random()}`,',
  },
  {
    id: 'charge-reserve-ignores-in-flight-attempt',
    file: 'src/services/BillingEngine.ts',
    find: "    if (attempts.some((a) => a.status === 'pending' || a.status === 'unknown')) return null;\n",
    replace: '',
  },
  {
    id: 'charge-timeout-treated-as-decline',
    file: 'src/services/BillingEngine.ts',
    find: '        this.repos.attempts.markUnknown(attempt.id);\n        this.repos.audit.append({',
    replace:
      "        this.repos.attempts.markUnknown(attempt.id);\n        this.outcomes.apply({ subscription: sub, invoice, result: 'declined', providerChargeId: null, attempt: { ...attempt, status: 'unknown' }, source, reference: attempt.id, at: this.clock.now() });\n        this.repos.audit.append({",
  },
  {
    id: 'cancel-leaves-invoice-collectable',
    file: 'src/services/SubscriptionService.ts',
    find: "      if (open) this.repos.invoices.transition(open.id, 'voided', now);\n",
    replace: '',
  },
  {
    id: 'signup-accepts-other-customers-card',
    file: 'src/services/SubscriptionService.ts',
    find: 'if (!pm || pm.customerId !== input.customer_id || pm.status !== \'active\') {',
    replace: "if (!pm || pm.status !== 'active') {",
  },
  {
    id: 'idempotency-key-not-reserved-before-work',
    file: 'src/services/SubscriptionService.ts',
    find: '    this.repos.idempotencyKeys.save(idempotencyKey, requestHash, 0, null, this.clock.now());\n',
    replace: '',
  },
  {
    id: 'success-does-not-advance-billing-period',
    file: 'src/services/PaymentOutcomes.ts',
    find: '    this.repos.subscriptions.updatePeriod(outcome.subscription.id, outcome.invoice.periodStart, outcome.invoice.periodEnd, outcome.at);\n',
    replace: '',
  },
];

function copyProject(dest) {
  for (const entry of ['src', 'tests', 'package.json', 'tsconfig.json', 'jest.config.js']) {
    fs.cpSync(path.join(ROOT, entry), path.join(dest, entry), { recursive: true });
  }
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dest, 'node_modules'), 'dir');
}

function runSuite(cwd) {
  const jest = path.join(ROOT, 'node_modules', 'jest', 'bin', 'jest.js');
  const env = { ...process.env, PROPERTY_RUNS: process.env.PROPERTY_RUNS ?? '40' };
  return spawnSync(process.execPath, [jest, '--silent', '--bail', '--ci'], { cwd, env, encoding: 'utf8' });
}

function main() {
  const filter = process.argv[2];
  const selected = MUTANTS.filter((m) => !filter || m.id.includes(filter));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'billing-mutants-'));
  copyProject(work);

  const results = [];
  try {
    const baseline = runSuite(work);
    if (baseline.status !== 0) {
      console.error('Baseline suite is failing; fix it before running mutants.\n' + baseline.stdout + baseline.stderr);
      process.exit(1);
    }

    for (const m of selected) {
      const target = path.join(work, m.file);
      const original = fs.readFileSync(target, 'utf8');
      if (original.split(m.find).length !== 2) throw new Error(`Mutant ${m.id}: pattern must match exactly once in ${m.file}`);
      fs.writeFileSync(target, original.replace(m.find, m.replace));
      const started = Date.now();
      const run = runSuite(work);
      fs.writeFileSync(target, original);

      const killed = run.status !== 0;
      const firstFailure = (run.stdout + run.stderr).match(/● (.+)/)?.[1]?.trim() ?? '';
      results.push({ ...m, killed, firstFailure, seconds: ((Date.now() - started) / 1000).toFixed(1) });
      const mark = killed ? 'KILLED  ' : m.survives ? 'EXPECTED' : 'SURVIVED';
      console.log(`${mark} ${m.id} (${results.at(-1).seconds}s)${killed ? `\n         by: ${firstFailure}` : m.survives ? `\n         why: ${m.survives}` : ''}`);
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }

  const unexpected = results.filter((r) => !r.killed && !r.survives);
  const counted = results.filter((r) => !r.survives);
  const killed = counted.filter((r) => r.killed).length;
  console.log(`\nMutation score: ${killed}/${counted.length} killed` + (results.length > counted.length ? ` (+${results.length - counted.length} known-equivalent)` : ''));
  if (unexpected.length > 0) {
    console.error(`Surviving mutants: ${unexpected.map((r) => r.id).join(', ')}`);
    process.exit(1);
  }
}

main();
