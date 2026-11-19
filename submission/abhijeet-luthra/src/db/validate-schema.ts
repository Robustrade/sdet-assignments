/**
 * `npm run validate:schema` - builds a fresh database, seeds it, and proves the
 * key constraints actually reject bad data. Exits non-zero on any failure.
 */
import { createRepositories } from '../repositories';
import { createDatabase } from './database';
import { TABLE_NAMES } from './schema';
import { seedReferenceData } from './seed';

type Check = { name: string; run: () => void; expectFailure: boolean };

function main(): number {
  const db = createDatabase();
  const repos = createRepositories(db);
  const now = new Date().toISOString();
  seedReferenceData(repos, now);

  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
    (t) => t.name,
  );
  const missing = TABLE_NAMES.filter((t) => !tables.includes(t));
  const fkOn = db.pragma('foreign_keys', { simple: true }) === 1;

  const insertSub = (id: string, status: string, canceledAt: string | null, customerId = 'cust_001') =>
    db
      .prepare(
        `INSERT INTO subscriptions (id, customer_id, plan_id, payment_method_id, status, trial_end, created_at, updated_at, canceled_at)
         VALUES (?, ?, 'pro', 'pm_x', ?, ?, ?, ?, ?)`,
      )
      .run(id, customerId, status, now, now, now, canceledAt);

  const checks: Check[] = [
    { name: 'valid subscription row accepted', run: () => insertSub('sub_ok', 'trialing', null), expectFailure: false },
    { name: 'fifth subscription status rejected', run: () => insertSub('sub_bad', 'pending', null), expectFailure: true },
    { name: 'canceled without canceled_at rejected', run: () => insertSub('sub_c', 'canceled', null), expectFailure: true },
    { name: 'unknown customer rejected (FK)', run: () => insertSub('sub_fk', 'trialing', null, 'nobody'), expectFailure: true },
    {
      name: 'negative plan price rejected',
      run: () => db.prepare("INSERT INTO plans VALUES ('neg', -1, 'USD', 0, 30)").run(),
      expectFailure: true,
    },
  ];

  let failures = missing.length > 0 || !fkOn ? 1 : 0;
  console.log(`tables present: ${TABLE_NAMES.length - missing.length}/${TABLE_NAMES.length}${missing.length ? ` (missing: ${missing.join(', ')})` : ''}`);
  console.log(`foreign keys enforced: ${fkOn}`);
  for (const check of checks) {
    let failed = false;
    try {
      check.run();
    } catch {
      failed = true;
    }
    const ok = failed === check.expectFailure;
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${check.name}`);
  }
  db.close();
  console.log(failures === 0 ? 'Schema validation passed.' : `Schema validation FAILED (${failures}).`);
  return failures === 0 ? 0 : 1;
}

process.exitCode = main();
