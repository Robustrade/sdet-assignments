/**
 * Builds the schema in a scratch database and checks it is complete and consistent with the
 * state machine. Exits non-zero on any problem. Run: npm run validate-schema
 */
import { SubscriptionStateMachine } from '../src/domain/SubscriptionStateMachine';
import { Database } from '../src/persistence/Database';
import { EXPECTED_TABLES } from '../src/persistence/schema';

const EXPECTED_INDEXES = ['invoices_one_open_per_subscription', 'invoices_one_per_period'];
const EXPECTED_TRIGGERS = ['subscriptions_enforce_lifecycle', 'subscriptions_initial_status'];

async function main(): Promise<void> {
  const db = await Database.open();
  const problems: string[] = [];
  const names = (type: string) => db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name", [type]).map((r) => r.name);

  const tables = names('table');
  for (const t of EXPECTED_TABLES) if (!tables.includes(t)) problems.push(`missing table ${t}`);
  for (const t of tables) if (!(EXPECTED_TABLES as readonly string[]).includes(t)) problems.push(`unexpected table ${t}`);
  for (const i of EXPECTED_INDEXES) if (!names('index').includes(i)) problems.push(`missing index ${i}`);
  for (const t of EXPECTED_TRIGGERS) if (!names('trigger').includes(t)) problems.push(`missing trigger ${t}`);

  const seeded = db
    .all<{ from_status: string; to_status: string }>('SELECT from_status, to_status FROM allowed_status_transitions')
    .map((r) => `${r.from_status}->${r.to_status}`)
    .sort();
  const machine = SubscriptionStateMachine.statusEdges().map(([f, t]) => `${f}->${t}`).sort();
  if (JSON.stringify(seeded) !== JSON.stringify(machine)) problems.push(`allowed_status_transitions ${seeded} != state machine ${machine}`);

  const fk = db.get<{ foreign_keys: number }>('PRAGMA foreign_keys');
  if (fk?.foreign_keys !== 1) problems.push('foreign keys are not enforced');

  db.close();
  if (problems.length > 0) {
    console.error(`Schema validation FAILED:\n  - ${problems.join('\n  - ')}`);
    process.exit(1);
  }
  console.log(`Schema OK: ${tables.length} tables, ${EXPECTED_INDEXES.length} indexes, ${EXPECTED_TRIGGERS.length} triggers, ${machine.length} allowed status transitions.`);
}

void main();
