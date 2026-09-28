# Interview Prep: walkthrough + optimisations to add when asked

## 60-second pitch
"I built a small but real service fixture and an OOP test framework around it. The lifecycle is
an explicit transition table, and only one class (`LifecycleManager`) can change status. The
payment provider is behind an interface, and tests inject a strict mock that records every call.
Webhooks are signed by a simulator that doesn't share code with the verifier. Every test starts
in a fresh isolated environment and ends with a global invariant check, so each test also proves
the DB has no contradictory records. I ran mutation checks to show the suite catches real bugs."

## How one request flows (be ready to draw this)
```
Test ─► SubscriptionApiClient ─► Express route ─► SubscriptionService
                                                    ├─ validate (400/422)
                                                    ├─ repo.insert (trialing)
                                                    └─ trialDays==0? BillingEngine.runDue
                                                          └─ PaymentProvider.charge  ◄── MockPaymentProvider (scripted)
                                                               ├─ succeeded → settleSuccess → LifecycleManager.apply(PAYMENT_SUCCEEDED)
                                                               ├─ declined  → settleFailure → apply(PAYMENT_FAILED | RETRIES_EXHAUSTED)
                                                               └─ timeout   → pending payment, NO transition

WebhookSimulator ─► /webhooks ─► WebhookService: verify HMAC → parse → ledger lookup → dispatch → settle*
```
`LifecycleManager.apply` = state machine check → `repo.saveTransition` → audit → notify.

## Likely questions & answers
- **Why is timeout not treated as a failure?** The provider may have charged the card. Marking
  it failed and retrying could double-charge. So I record `pending` and let the webhook decide.
- **Why does `payment.failed` need a pending attempt?** A sync decline plus its echo webhook
  would otherwise count as two dunning failures and cancel the customer too early.
- **Why return 200 for an unknown subscription?** A 4xx/5xx makes the provider retry forever.
  I acknowledge the event and record it as `ignored` with a reason for investigation.
- **Why sign in the simulator with `node:crypto` rather than reuse the verifier?** If the
  verifier had a bug, both sides would agree and the test would pass falsely.
- **Why is the mock strict?** A default of "succeed" hides unexpected charges. Strict mode plus
  the `unusedOutcomes` check catches both extra and missing charges.
- **How do you avoid false positives from stale data?** There is a new DB per test, reads return
  clones, and a test (`each test starts from an empty ... database`) proves it.
- **How do you know every transition is covered?** A tracker reads the audit log after each test,
  and `afterAll` fails the file if a diagram transition is missing.
- **Isn't the invariant checker also code that can be wrong?** Yes, so it has its own tests that
  corrupt data on purpose (`testing the tester`).

## Optimisations / next steps (held back on purpose — add when asked)
Ordered roughly by value. Each one has what to say and what to change.

1. **Concurrent webhook delivery (the bonus item).**
   - *Say:* In-memory processing is synchronous, so there is no interleaving today. With a real DB,
     two workers could both pass the "event seen?" check.
   - *Do:* Make the ledger insert atomic (a `UNIQUE(event_id)` constraint with insert-or-fail).
     Use the existing `version` column for optimistic locking; `ConcurrentModificationError` is
     already thrown. Add a test that fires the same event with `Promise.all` and asserts one effect.
     Add another with success and failure in parallel on the same invoice.

2. **Real embedded DB (better-sqlite3) behind the same repositories.**
   - *Say:* The Repository pattern means specs don't change; only the implementations do.
   - *Do:* Add `SqliteSubscriptionRepository` etc., and wrap `settle*` in a transaction.
     Run the whole suite against both backends with `describe.each([memory, sqlite])`.

3. **Transactional outbox for notifications.** Today notify happens right after the save. With a
   real DB, write an outbox row in the same transaction and assert exactly one row per event.

4. **Schema validation** with zod or ajv for request, response and webhook bodies. Share the
   schemas between the fixture and `SubscriptionApiClient` so contract tests assert the schema,
   not hand-written shapes.

5. **Property-based state-machine testing** (fast-check). Generate random sequences of
   API calls, billing runs and webhooks (including duplicates and reordering). After each step,
   assert `InvariantChecker.violations()` is empty. This finds orderings nobody thought to write.

6. **Real provider adapter plus nock.** Add `HttpPaymentProviderAdapter`, and test the actual
   request, 5xx and socket-timeout mapping with nock.

7. **Environment-aware API client factory.** `ApiClientFactory.for('local' | 'staging')`:
   supertest locally, and a base-URL HTTP client against a deployed environment. The same specs
   then become smoke tests.

8. **Webhook hardening.**
   - Timestamp in the signature, with a replay window (e.g. reject events older than 5 minutes).
   - Reject the same `event_id` arriving with a *different* payload hash.
   - Secret rotation: accept two secrets for a while.

9. **Business extras.** Proration on plan change, grace periods, a retry schedule based on the
   clock (not on each run), and automatic refund on `payment.succeeded_after_cancel`.

10. **CI and reporting.** A GitHub Actions workflow (lint, build, test with coverage threshold)
    and a jest-junit reporter. Stryker for automated mutation testing, instead of my manual
    `sed` mutations.

11. **Performance of the suite.** Already about 5s. If it grows, run specs in parallel (they are
    isolated by design), and share an app instance per file with a DB reset where safe.

## Mutation checks I ran (mention these; they show the tests are meaningful)
| Mutation | Result |
|---|---|
| Skip duplicate `event_id` check | 4 tests fail |
| Allow `canceled → active` + remove canceled guard | 4 tests fail |
| Allow re-charge while an attempt is pending | 1 test fails |
