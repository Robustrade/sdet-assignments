# My understanding and approach

## What the system does
A Subscription & Billing Service. A customer subscribes to a plan; the subscription moves through
`trialing → active → past_due → canceled`. Two things move it:
1. **API calls**: create, cancel, and the billing scheduler charging the card.
2. **Webhooks** from the payment provider: `payment.succeeded`, `payment.failed`, `payment.refunded`.

## What can go wrong (the risks I will test)
| Risk | Why it matters |
|---|---|
| Same webhook delivered twice | Customer charged / emailed twice, status changes twice |
| Webhooks arrive in the wrong order | A late "failed" could undo an "active" subscription |
| Provider times out | We don't know if they paid; retrying blindly can double-charge |
| Fake or tampered webhook | Attacker activates a subscription for free |
| Illegal state change | A canceled subscription comes back to life |
| API and database disagree | The customer sees one thing, billing does another |

## Approach
- **No service is provided**, so I build a small one (assignment Option 3, "Hybrid"):
  real HTTP API, real business logic, real state machine, real signature check, in-memory database.
  **Faked:** the payment provider (mock) and the clock.
- **Tool:** Playwright Test (TypeScript), using its API testing (`request`) and fixtures. No browser.
- **Every test gets its own server, database and mock** (Playwright fixtures), so tests never affect each other.
- **Every test checks 3 places:** the API response, the database, and the calls made to the payment provider.
- **After every test**, an automatic check confirms the business rules still hold in the database
  (for example: "never active without a successful payment").

## Design patterns (only where they solve a real problem)
| Pattern | Where | Problem it solves |
|---|---|---|
| State machine table | `src/stateMachine.ts` | One table of allowed moves; status can only change through it |
| Builder | `tests/helpers/builders.ts` | Tests show only what is different (`.without('plan')`) |
| Interface for the provider (dependency injection) | `src/paymentProvider.ts` | Tests plug in a fake provider |
| Repository | `src/database.ts` | All data access in one class, which enforces unique keys |
| Fixtures (factory) | `tests/fixtures.ts` | One fresh, isolated system per test |

## Test plan
| File | What it proves |
|---|---|
| `1-api.spec.ts` | Responses, status codes, validation errors; rejected requests save and charge nothing |
| `2-lifecycle.spec.ts` | Every allowed transition (through API and webhook) + blocked ones + plan rules |
| `3-webhooks.spec.ts` | Signatures, duplicates (idempotency), wrong order |
| `4-payment-provider.spec.ts` | Exact charge details, one call per attempt, decline, timeout, no double charge |
| `5-data-consistency.spec.ts` | API = database at every step, audit history, database rules |
| `6-end-to-end.spec.ts` | Full customer journeys across everything |

## Assumptions
- basic = $19.00 with a 14-day trial; pro = $49.00 with no trial (charged at signup).
- One invoice per billing attempt. 3 failed payments in a row → canceled.
- `POST /subscriptions/:id/charge` stands in for the billing scheduler.
- Timeout = outcome unknown → invoice stays `pending`, no new charge until a webhook settles it.
- Valid webhooks always get HTTP 200 (even ignored/duplicate), so the provider stops retrying.
- Refund marks the invoice refunded; it does not change the subscription status.
- Only `trialing`/`active` can be canceled by API (exactly as in the diagram).

## Out of scope / limitations
Plan changes (upgrade/downgrade), a real database, multi-server concurrency, billing calendar,
webhook replay time window, real provider integration.
