# Coverage Matrix

Current suite: **50 tests passing**.

| Area | What is covered | Primary scenario file(s) |
|---|---|---|
| Plan-specific creation | `basic` starts a 7-day trial with no immediate charge; `pro` performs an immediate billing attempt | `test_subscription_lifecycle.py`, `test_provider_interactions.py` |
| State machine | All 7 documented valid transitions; multiple invalid transitions; canceled is terminal | `test_state_machine.py`, `test_subscription_lifecycle.py`, `test_billing_lifecycle.py` |
| Trial-end billing | First trial-end provider attempt; pending-before-webhook; success/failure webhook finalization | `test_subscription_lifecycle.py` |
| Subscription creation | Valid creation, API↔DB consistency, provider arguments, initial invoice | `test_subscription_lifecycle.py`, `test_provider_interactions.py` |
| Validation | Unknown plan/customer, invalid payment method, unknown subscription, malformed/missing/unsupported webhooks | `test_validation.py` |
| Payment failures | Initial decline, timeout, recurring failure, retry failure, retry exhaustion | `test_provider_interactions.py`, `test_billing_lifecycle.py` |
| Retry semantics | New invoice/attempt, distinct idempotency key, provider called once, state remains `past_due` until webhook | `test_billing_lifecycle.py`, `test_provider_interactions.py` |
| Webhook idempotency | Duplicate event has no duplicate payment/audit/provider side effect | `test_webhook_reliability.py` |
| Out-of-order delivery | Late failure after successful payment cannot regress state | `test_webhook_reliability.py` |
| Terminal cancellation | Cancel from active/trialing; later success/failure/refund cannot reactivate | `test_subscription_lifecycle.py`, `test_webhook_reliability.py` |
| Persistence & audit | Invoice/payment status, provider reference, API↔DB consistency, lifecycle audit transitions, refund audit | `test_subscription_lifecycle.py`, `test_billing_lifecycle.py`, `test_webhook_reliability.py` |
| Provider seam | Protocol/DI, exact charge arguments, call count, no call for rejected creation or replayed webhook | `test_provider_interactions.py`, `test_validation.py`, `test_webhook_reliability.py` |
| End-to-end behavior | Creation → webhook outcome → recurring failure → retry → recovery/cancellation paths | `test_subscription_lifecycle.py`, `test_billing_lifecycle.py`, `test_webhook_reliability.py` |

## Priority interpretation

**Mandatory assignment areas:** lifecycle/state transitions, validation, provider interaction, webhook idempotency, out-of-order behavior, persistence/audit consistency, and API↔DB agreement are all executable in the suite.

**Deliberate scope boundaries:** wall-clock trial expiration, plan changes/proration, concurrent webhook races, and a production payment adapter are not implemented in the minimal fixture.
