# Database Design — Subscription & Billing Service

**Status:** Implemented in `src/db/schema.ts` and `src/repositories/`. Validated by `npm run validate:schema` and `tests/persistence/`.
**Database:** SQLite via `better-sqlite3` (design decision)
**Purpose:** Define entities, relationships, constraints, transaction boundaries and persistence verification before implementation.

> **Requirement (assignment "Required Database Coverage"):** at minimum `subscriptions`, `invoices` or `payments`, `webhook_events` (or equivalent) and an audit/event log per subscription. Document which entities are checked, which invariants are asserted, how data is seeded and cleaned, and how false positives from stale data are avoided.
> **Design decision:** this fixture models both `invoices` and `payments` (separate attempt rows), plus `customers` and `plans`, so that retries and conflicting events can be represented and verified.

## 1. Design goals

- Durable subscription lifecycle state.
- Customer and plan references.
- Invoice history and an individual row per payment attempt.
- Webhook idempotency, including a record of duplicates that were no-op'd (a requirement).
- Auditable subscription state history (a requirement).
- Transactional webhook processing.
- Independent test verification through repositories.

## 2. Entity relationships

```text
customers 1 ──< subscriptions >── 1 plans
                    │
                    ├──< invoices ──< payments (one row per attempt)
                    │
                    ├──< webhook_events          (one row per distinct event_id)
                    │
                    ├──< subscription_events     (audit: one row per state change)
                    │
                    └──  idempotency_keys        (0..1 per subscription; client Idempotency-Key)
```

A **webhook event** is a delivery from the provider. A **payment** row is one outbound charge attempt and its outcome. They are linked by `invoice_id` and, optionally, by `provider_reference`, but they are not interchangeable.

## 3. Tables

### 3.1 customers

| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK |
| name | TEXT | NOT NULL |
| email | TEXT | NOT NULL, UNIQUE |
| created_at | TEXT | NOT NULL |

### 3.2 plans

| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK (`basic`, `pro`; the value used in the `plan` request field) |
| price_minor | INTEGER | NOT NULL, CHECK ≥ 0 |
| currency | TEXT | NOT NULL |
| trial_days | INTEGER | NOT NULL, CHECK ≥ 0. `0` means immediate billing |
| billing_interval_days | INTEGER | NOT NULL, CHECK > 0 (seed: 30) |

Seed values are **illustrative test data, not real Kulu prices**:

| id | price_minor | currency | trial_days |
|---|---:|---|---:|
| basic | 1900 | USD | 0 |
| pro | 4900 | USD | 7 |

Immediate billing is derived from `trial_days = 0` rather than stored in a separate flag. This avoids two columns that could contradict each other.

### 3.3 subscriptions

| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK |
| customer_id | TEXT | FK → customers, NOT NULL |
| plan_id | TEXT | FK → plans, NOT NULL |
| payment_method_id | TEXT | NOT NULL |
| status | TEXT | NOT NULL, CHECK IN (`trialing`,`active`,`past_due`,`canceled`) |
| trial_end | TEXT | NOT NULL (equals `created_at` for immediate-billing plans) |
| current_period_end | TEXT | NULL until first `active` |
| created_at | TEXT | NOT NULL |
| updated_at | TEXT | NOT NULL |
| canceled_at | TEXT | NULL; CHECK (`status = 'canceled'`) = (`canceled_at IS NOT NULL`) |

**Only the four required states are allowed.** A provider timeout is stored on the payment attempt (`timed_out`), never on the subscription.

### 3.4 invoices

| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK |
| subscription_id | TEXT | FK → subscriptions, NOT NULL |
| amount_minor | INTEGER | NOT NULL, CHECK ≥ 0 |
| currency | TEXT | NOT NULL |
| status | TEXT | CHECK IN (`open`,`paid`,`void`,`refunded`) |
| period_start / period_end | TEXT | NOT NULL |
| created_at / updated_at | TEXT | NOT NULL |

- `open` means awaiting a successful payment. It may already have failed or timed-out attempts.
- `paid` means a successful attempt exists.
- `void` means the subscription was canceled or retries were exhausted before payment.
- `refunded` means a `payment.refunded` webhook was applied.

### 3.5 payments (one row per attempt)

| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK |
| invoice_id | TEXT | FK → invoices, NOT NULL |
| subscription_id | TEXT | FK → subscriptions, NOT NULL |
| attempt_number | INTEGER | NOT NULL, CHECK ≥ 1; UNIQUE (`invoice_id`, `attempt_number`) |
| idempotency_key | TEXT | NOT NULL, UNIQUE (planned format `<invoice_id>:<attempt_number>`) |
| provider_reference | TEXT | NULL; UNIQUE when present |
| amount_minor | INTEGER | NOT NULL, CHECK ≥ 0 |
| currency | TEXT | NOT NULL |
| status | TEXT | CHECK IN (`pending`,`succeeded`,`failed`,`timed_out`,`refunded`) |
| failure_code | TEXT | NULL (e.g. a decline code) |
| created_at / updated_at | TEXT | NOT NULL |

- `pending`: the attempt is committed but the provider has not answered yet. This status also persists if the local update after a provider call fails.
- `timed_out`: the provider did not answer in time and the outcome is **unknown**. It is not a failure and is not re-charged automatically.
- Allowed moves: `pending → succeeded | failed | timed_out`, `timed_out → succeeded | failed`, `succeeded → refunded`. Any other move is rejected by the service.

### 3.6 webhook_events

| Column | Type | Constraints |
|---|---|---|
| event_id | TEXT | PK (the idempotency boundary for duplicate delivery) |
| event_type | TEXT | NOT NULL |
| subscription_id | TEXT | FK → subscriptions, NOT NULL |
| invoice_id | TEXT | FK → invoices, NOT NULL |
| provider_reference | TEXT | NULL |
| payload | TEXT | NOT NULL (raw body, for audit) |
| processing_status | TEXT | CHECK IN (`processed`,`ignored`,`quarantined`) |
| ignore_reason | TEXT | NULL; set only when `ignored` or `quarantined` (e.g. `subscription_canceled`, `invoice_already_paid`, `no_unresolved_attempt`, `ambiguous_payment_attempt`) |
| matched_payment_id | TEXT | NULL; FK → payments. The attempt the event was matched to (`API_CONTRACTS.md` §6.1) |
| delivery_count | INTEGER | NOT NULL DEFAULT 1. Incremented on each duplicate delivery |
| first_received_at / last_received_at | TEXT | NOT NULL |

This table meets the requirement that webhook events are recorded, "including duplicates that were correctly no-op'd". A duplicate leaves exactly one row and raises `delivery_count`.

Rejected deliveries (bad signature, malformed payload, unknown references) are **not** stored. They are rejected before any business mutation. A rolled-back event is not stored either, so a provider redelivery can still process it once.

### 3.7 subscription_events (audit history)

| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK |
| subscription_id | TEXT | FK → subscriptions, NOT NULL |
| sequence | INTEGER | NOT NULL; UNIQUE (`subscription_id`, `sequence`) |
| previous_status | TEXT | NULL (null for creation) |
| new_status | TEXT | NOT NULL |
| trigger | TEXT | NOT NULL (`api_create`, `api_cancel`, `billing_charge`, `billing_retry`, `retries_exhausted`, `webhook`) |
| reference_id | TEXT | NULL (payment id or event_id that caused the change) |
| created_at | TEXT | NOT NULL |

There is one row per actual state change. Ignored, quarantined or duplicate events add **no** audit row, and their trace lives in `webhook_events`. Refunds do not change state, so they are traced via `payments`, `invoices` and `webhook_events`.

`quarantined` means the event could not be matched to exactly one payment attempt, so no payment state was changed (`API_CONTRACTS.md` §6.1). Resolving it would be a manual step, which is out of scope.

### 3.8 idempotency_keys (duplicate `POST /subscriptions` protection)

| Column | Type | Constraints |
|---|---|---|
| key | TEXT | PK (the client's `Idempotency-Key`) |
| request_hash | TEXT | NOT NULL (SHA-256 of the normalised create payload) |
| subscription_id | TEXT | FK → subscriptions, NOT NULL, UNIQUE |
| created_at | TEXT | NOT NULL |

The row is inserted in the **same transaction** as the subscription it created, so neither can exist without the other. Requests rejected by validation store no key.

## 4. Integrity rules

| # | Rule | Enforced by |
|---|---|---|
| 1 | Subscription references an existing customer and plan | FK |
| 2 | Invoice and payment reference existing parents | FK |
| 3 | A payment's `subscription_id` equals its invoice's `subscription_id` | Repository + invariant check |
| 4 | A webhook's invoice belongs to its subscription | Service validation (422 otherwise) |
| 5 | `event_id` is unique | PK |
| 6 | The payment idempotency key is unique; there is one row per `(invoice, attempt_number)` | UNIQUE |
| 7 | `provider_reference` identifies at most one attempt | UNIQUE (NULLs allowed) |
| 8 | Statuses are restricted to known values | CHECK |
| 9 | Amounts are non-negative integer minor units | CHECK |
| 10 | `canceled_at` is set if and only if the status is `canceled` | CHECK |

Foreign keys are enforced with `PRAGMA foreign_keys = ON` on every connection. Cross-table rules that SQLite cannot express as a `CHECK` are enforced by the service and verified by the test invariant checker (§7).

## 5. Uniqueness distinctions

| Identifier | Prevents |
|---|---|
| `webhook_events.event_id` | Applying the same provider event twice (duplicate delivery) |
| `payments.idempotency_key` | Creating or charging the same logical attempt twice. It is also sent to the provider |
| `payments.provider_reference` | Treating two reports about one external transaction as two charges |
| `(invoice_id, attempt_number)` | Ambiguous retries. A genuine retry is a **new** row with the next number and a new key |
| `idempotency_keys.key` | A retried client `POST /subscriptions` creating a second subscription and charge |

## 6. Transaction boundaries

`better-sqlite3` transactions are synchronous, so a transaction cannot contain the asynchronous provider call. The external/local boundary is therefore explicit.

### 6.1 Create subscription (trial plan)

One transaction: insert the subscription (`trialing`), an audit row and the `idempotency_keys` row (if a key was sent), then commit. There is no invoice and no provider call.

Before any transaction, if the key already exists: a matching `request_hash` means a replay (return the existing subscription, write nothing, no provider call); a different hash means `422 IDEMPOTENCY_KEY_REUSED`.

### 6.2 Any charge (immediate creation, trial end, recurring, retry)

1. **Tx A:** insert the invoice if needed and a `pending` payment attempt with its idempotency key, then commit. For immediate creation this transaction also inserts the subscription, its creation audit row and the `idempotency_keys` row (if a key was sent). The `BillingRunner` never creates a new attempt while the invoice still has an unresolved (`pending` or `timed_out`) one.
2. **No transaction:** call `PaymentProvider.charge(...)`.
3. **Tx B:** apply the outcome:
   - success: payment `succeeded`, invoice `paid`, subscription transition, audit row;
   - decline: payment `failed`, subscription transition, audit row; or `void` the invoice and cancel the subscription if the attempts are exhausted;
   - timeout: payment `timed_out`; no subscription change.

**This is not atomic across the provider and SQLite, and the design does not claim it is.** If Tx B fails after the provider charged the customer, the attempt stays `pending` with its idempotency key. The provider's later webhook for that invoice reconciles it. A test covers this (`TEST_STRATEGY.md` PF-02).

### 6.3 Webhook processing

One transaction, after the signature and schema checks:

1. Look up `event_id`. If it exists, increment `delivery_count`, commit and return a duplicate result.
2. Validate the subscription, invoice ownership, amount and currency. If invalid, roll back (4xx).
3. Match the event to a payment attempt (`API_CONTRACTS.md` §6.1): prefer `provider_reference`, otherwise use the invoice's single unresolved attempt. If more than one attempt could match, decide `quarantined`.
4. Check applicability against the subscription and payment transition tables.
5. Apply the payment, invoice and subscription updates and the audit row, or decide `ignored` or `quarantined` with no business mutation.
6. Insert the `webhook_events` row and commit.

Any exception rolls back **everything**, including the event row, so redelivery is safe.

### 6.4 Concurrent duplicate delivery (optional coverage)

The `event_id` primary key is the final guard. A second concurrent insert gets a constraint error, which the service maps to a duplicate acknowledgment. Testing this is optional.

## 7. Persistence invariants (checked by tests)

| ID | Invariant | Verification |
|---|---|---|
| DB-INV-01 | Subscription status ∈ the 4 required states | CHECK + invariant checker |
| DB-INV-02 | `active` ⇒ at least one `succeeded` (or later `refunded`) payment exists for the subscription | Invariant checker |
| DB-INV-03 | Payment and invoice subscription references agree | Invariant checker |
| DB-INV-04 | No duplicate `event_id`; duplicates increase only `delivery_count` | PK + duplicate tests |
| DB-INV-05 | At most one `succeeded` payment per invoice | Invariant checker |
| DB-INV-06 | A `paid` invoice has exactly one `succeeded` (or `refunded`) payment; an `open` invoice has none | Invariant checker |
| DB-INV-07 | Persisted subscription equals the `GET` response | API vs. repository comparison |
| DB-INV-08 | The latest audit row's `new_status` equals the current subscription status; audit `sequence` has no gaps | Invariant checker |
| DB-INV-09 | Invalid signature or malformed payload changes nothing | Before/after table snapshot |
| DB-INV-10 | `canceled` subscriptions have no `pending` charges created after `canceled_at` | Invariant checker |
| DB-INV-11 | Failed or timed-out attempts are never represented as `succeeded` | Status assertions |
| DB-INV-12 | Invoice amount and currency equal the plan price and currency | Invariant checker |

The **invariant checker** is a planned test-support class that runs DB-INV-01, 02, 03, 05, 06, 08, 10 and 12 for every subscription after every test, as well as in explicit assertions. A test that leaves an inconsistent database fails even if its own assertions pass.

## 8. Repository-based verification

Tests never embed raw SQL. Planned repository methods include:

- `subscriptions.findById(id)`
- `invoices.findBySubscription(id)`
- `payments.findByInvoice(id)` and `payments.findByProviderReference(ref)`
- `webhookEvents.findById(eventId)`
- `subscriptionEvents.findBySubscription(id)`
- `snapshot()` (row counts and contents for the before/after "no mutation" assertions)

Raw SQL lives only in the schema module and the repositories.

## 9. Seed, cleanup and stale-data avoidance

1. Each test gets a **fresh in-memory SQLite database** (`:memory:`), so there is no file cleanup and no shared state.
2. Enable foreign keys, apply the schema and seed the known customers and plans.
3. Create scenario data through builders or the API, never by editing rows directly, unless a test deliberately sets up a corrupt state.
4. Use a fresh mock provider and a controllable clock per test.
5. Assertions look up records **by the IDs the scenario created**, never "the latest row", which avoids false positives from stale data.

## 10. Failure injection (partial failures)

The fixture will expose narrow test-only failure points, injected through the repositories or services, not via global flags in production paths:

| Injection | Expected behavior |
|---|---|
| Repository throws during webhook processing (after the payment update, before commit) | 500; nothing persisted (no event row, no payment, invoice, subscription or audit change); redelivery of the same event then processes once |
| Provider returns success, then Tx B fails | Attempt stays `pending`; provider called once; a later `payment.succeeded` webhook reconciles it to `succeeded`/`active` without a second charge |
| Provider timeout | Attempt `timed_out`; subscription unchanged; no automatic re-charge; a later webhook reconciles it |

## 11. Implementation checklist

- [ ] Schema for all eight tables, with FKs, CHECKs and UNIQUE constraints.
- [ ] `PRAGMA foreign_keys = ON`.
- [ ] Repositories and a transaction helper.
- [ ] Seed fixture and in-memory database per test.
- [ ] Invariant checker.
- [ ] Constraint-level tests (duplicate `event_id`, duplicate idempotency key, bad status).
- [ ] Rollback and reconciliation tests.

## 12. Limitations

- SQLite is a test fixture choice. It is not a statement about Kulu's production database.
- In-process SQLite does not reproduce multi-node concurrency behavior.
- Late money movement for a canceled subscription (for example, a delayed success) is ignored at state level. Refund or reconciliation workflows are not modelled.
- The design does not claim distributed atomicity between SQLite and the payment provider.
