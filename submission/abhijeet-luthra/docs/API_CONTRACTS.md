# API Contracts — Subscription & Billing Service

**Status:** Implemented (`src/http/`, `src/services/`) and covered by `tests/api/` and `tests/webhooks/`.
**Base path:** none (the assignment's paths are used as given)
**Content type:** `application/json`
**Date/time format:** ISO 8601 UTC
**Money representation:** integer minor units (USD 49.00 = `4900`), matching the assignment's example `"amount": 4900`

> The assignment supplies the four routes, an example create request, an example webhook payload and the signature header. It does **not** specify status codes, response bodies or error formats. Everything below is marked either **Requirement** (from the assignment) or **Design decision / Assumption** (proposed for this fixture). Assumption IDs (A-xx) refer to the register in `PRE_IMPLEMENTATION_DESIGN.md` §19.

## 1. Requirement vs. design at a glance

| Topic | Requirement (assignment) | Design decision / assumption (fixture) |
|---|---|---|
| Endpoints | `POST /subscriptions`, `GET /subscriptions/{id}`, `POST /subscriptions/{id}/cancel`, `POST /webhooks/payment-provider` | No `/api/v1` prefix and no extra endpoints |
| Create request | `customer_id`, `plan`, `payment_method_id` | All three required (A-02) |
| Duplicate create requests | Not specified (the recruiter highlighted "duplicate requests") | `Idempotency-Key` request header on `POST /subscriptions` (§3.1, A-16) |
| Validation failures to cover | invalid plan, missing fields, unknown customer, invalid payment method, cancel an already-canceled subscription | Status codes and error codes in §§3–5 |
| Webhook payload | `event_id`, `type`, `subscription_id`, `invoice_id`, `amount`, `currency` | Optional extra `provider_reference` (A-13) |
| Webhook event types | `payment.succeeded`, `payment.failed`, `payment.refunded` | Others → `400` |
| Signature | `X-Provider-Signature`: HMAC over the raw body | HMAC-SHA256, lowercase hex, no prefix (A-10) |
| Webhook responses | valid/invalid signature and malformed payload must be handled | `200`/`400`/`401`/`404`/`422`/`500` mapping in §6 |

## 2. Common conventions (design decisions)

### Identifiers

Identifiers are opaque strings such as `cust_001`, `sub_…`, `inv_…`, `pay_…` and `evt_…`. Tests must not depend on sequential generation unless the fixture is explicitly configured for it.

### Error response shape

```json
{
  "error": {
    "code": "INVALID_PLAN",
    "message": "The selected plan is not supported"
  }
}
```

Field-level validation errors add `details`:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [{ "field": "customer_id", "message": "customer_id is required" }]
  }
}
```

### Subscription representation

Used by `GET` and by successful `POST /subscriptions` responses:

| Field | Type | Notes |
|---|---|---|
| id | string | |
| customer_id | string | |
| plan | string | `basic` or `pro` in seed data |
| status | string | `trialing` \| `active` \| `past_due` \| `canceled`, and nothing else |
| trial_end | string \| null | Equals `created_at` for immediate-billing plans (zero-length trial, A-01) |
| current_period_end | string \| null | Set when the subscription becomes `active` |
| created_at | string | |
| canceled_at | string \| null | |

## 3. Create subscription

`POST /subscriptions`  *(Requirement: route and request fields)*

```json
{
  "customer_id": "cust_001",
  "plan": "pro",
  "payment_method_id": "pm_test_visa_4242"
}
```

| Field | Type | Required | Rules (design decision) |
|---|---|---|---|
| customer_id | string | Yes | Must reference an existing customer |
| plan | string | Yes | Must reference a configured plan |
| payment_method_id | string | Yes | Non-empty and must start with `pm_` (fixture validation rule) |

### Outcomes

| Scenario | HTTP | `status` in body | Provider calls | Persisted |
|---|---|---|---|---|
| Trial plan (`pro`) | 201 | `trialing` | 0 | subscription + audit (`null → trialing`) |
| Immediate plan (`basic`), provider success | 201 | `active` | 1 | subscription, invoice `paid`, payment `succeeded`, audit `null → trialing → active` |
| Immediate plan, provider decline | 201 (A-03) | `past_due` | 1 | subscription, invoice `open`, payment `failed`, audit `null → trialing → past_due` |
| Immediate plan, provider timeout | 201 (A-04) | `trialing` | 1 | subscription, invoice `open`, payment `timed_out`, audit `null → trialing` |

Example, trial plan:

```json
{
  "id": "sub_001",
  "customer_id": "cust_001",
  "plan": "pro",
  "status": "trialing",
  "trial_end": "2026-11-25T10:00:00.000Z",
  "current_period_end": null,
  "created_at": "2026-11-18T10:00:00.000Z",
  "canceled_at": null
}
```

A timeout is **not** treated as a decline. The attempt is not re-charged automatically, and a later provider webhook reconciles it.

### 3.1 Duplicate requests: `Idempotency-Key` (design decision, A-16)

A client that times out waiting for `POST /subscriptions` may retry. Without protection, the retry would create a second subscription and charge the customer a second time.

```text
Idempotency-Key: <client-generated string, 1–255 characters>
```

| Rule | Behavior |
|---|---|
| Header present, key **not seen before** | Normal processing. The key is stored **in the same transaction** that inserts the subscription (Tx A), together with a SHA-256 hash of the normalised request body (`customer_id`, `plan`, `payment_method_id`) and the new `subscription_id`. |
| Same key, **same** payload | **No** new subscription, invoice or payment, and **no** provider call. Responds `201` with the **current** representation of the original subscription and the header `Idempotent-Replayed: true`. |
| Same key, **different** payload | `422 IDEMPOTENCY_KEY_REUSED`. No mutation and no provider call. |
| Header present but empty or longer than 255 characters | `400 VALIDATION_ERROR` |
| Header absent | Processed normally **without** de-duplication. The header stays optional so the assignment's example request remains valid. This limitation is documented. |
| Request rejected by validation (400/404/422) | The key is **not** stored, because nothing was created. A corrected retry with the same key is processed normally. |

The replay returns the subscription's *current* state rather than a byte-for-byte copy of the first response. After an immediate charge the original response is only known after Tx B, and storing it separately would add a second write path for little test value. The ID and every persisted fact are the same, and nothing new happens. Keys are global, because the fixture has no authentication (A-15). Two concurrent in-flight requests with the same key are an optional scenario: the unique key constraint is the guard.

### Errors (design decision)

| HTTP | Code | Condition | Side effects |
|---|---|---|---|
| 400 | VALIDATION_ERROR | Missing field, wrong type or malformed JSON | None; no provider call |
| 404 | CUSTOMER_NOT_FOUND | Unknown `customer_id` | None; no provider call |
| 422 | INVALID_PLAN | Unknown `plan` | None; no provider call |
| 422 | INVALID_PAYMENT_METHOD | `payment_method_id` fails the fixture rule | None; no provider call |
| 422 | IDEMPOTENCY_KEY_REUSED | `Idempotency-Key` already used with a different payload | None; no provider call |
| 500 | INTERNAL_ERROR | Unexpected failure | Local transaction rolled back |

## 4. Retrieve subscription

`GET /subscriptions/{id}`  *(Requirement: route)*

| HTTP | Body |
|---|---|
| 200 | Subscription representation (§2) |
| 404 | `SUBSCRIPTION_NOT_FOUND` |

Tests assert that the response equals the persisted row, and that `GET` never mutates anything.

## 5. Cancel subscription

`POST /subscriptions/{id}/cancel`  *(Requirement: route. Behavior: "stops future billing and is irreversible via further webhooks")*

No request body.

| Current state | HTTP | Result |
|---|---|---|
| `trialing` | 200 | `canceled`, `canceled_at` set, open invoices `void`, audit row |
| `active` | 200 | Same as above |
| `canceled` | 409 `INVALID_TRANSITION` | Unchanged; no audit row (requirement: "canceling an already-canceled subscription") |
| `past_due` | 409 `INVALID_TRANSITION` | Unchanged (A-07: cancel is listed only from trialing/active) |
| unknown id | 404 `SUBSCRIPTION_NOT_FOUND` | No mutation |

Cancellation never calls the payment provider. After cancellation, `BillingRunner` skips the subscription and payment webhooks cannot change its state.

## 6. Payment provider webhook

`POST /webhooks/payment-provider`  *(Requirement: route, payload example, signature header)*

### Signature

```text
X-Provider-Signature: <hex(HMAC-SHA256(secret, rawBody))>
```

- Computed over the **exact raw bytes** of the body, never over re-serialized JSON.
- Compared with a timing-safe comparison.
- The secret is fixture configuration that the test webhook simulator also knows.

### Payload

| Field | Type | Required | Source |
|---|---|---|---|
| event_id | string | Yes | Requirement |
| type | `payment.succeeded` \| `payment.failed` \| `payment.refunded` | Yes | Requirement |
| subscription_id | string | Yes | Requirement |
| invoice_id | string | Yes | Requirement |
| amount | integer ≥ 0 | Yes | Requirement; must equal the invoice amount (design decision) |
| currency | string | Yes | Requirement; must equal the invoice currency (design decision) |
| provider_reference | string | No | **Assumption A-13**. When present, it is used to match and reconcile a specific attempt |

Example (requirement example, unchanged):

```json
{
  "event_id": "evt_8c1f4f0b",
  "type": "payment.succeeded",
  "subscription_id": "sub_001",
  "invoice_id": "inv_001",
  "amount": 4900,
  "currency": "USD"
}
```

### Processing outcomes (design decision)

| Situation | HTTP | Body | Side effects |
|---|---|---|---|
| Missing or invalid signature, or body modified after signing | 401 | `INVALID_SIGNATURE` | None, and nothing stored |
| Malformed JSON, missing fields or unsupported `type` | 400 | `INVALID_EVENT` | None |
| Unknown subscription or invoice | 404 | `SUBSCRIPTION_NOT_FOUND` / `INVOICE_NOT_FOUND` | None (A-11) |
| Invoice not owned by the subscription, or amount/currency mismatch | 422 | `EVENT_REFERENCE_MISMATCH` | None (A-11) |
| New event, applicable | 200 | `{"status":"processed"}` | Payment, invoice, subscription and audit updated once; event stored `processed` |
| New event, not applicable (canceled subscription, invoice already paid, no unresolved attempt, etc.) | 200 | `{"status":"ignored","reason":"…"}` | Event stored `ignored` with the reason; **no business mutation** |
| New event, **ambiguous**: no `provider_reference` and more than one unresolved attempt on the invoice (§6.1) | 200 | `{"status":"quarantined","reason":"ambiguous_payment_attempt"}` | Event stored `quarantined`; **no payment, invoice, subscription or audit mutation** |
| Same `event_id` already stored | 200 | `{"status":"duplicate"}` | Only `delivery_count` is incremented |
| Unexpected processing failure | 500 | `INTERNAL_ERROR` | Whole local transaction rolled back, including the event row, so a provider redelivery can process it once |

Why `200` for ignored, quarantined and duplicate events: a non-2xx response would make a real provider retry an event that can never apply. Acknowledging it and recording why keeps it auditable.

### 6.1 Matching an event to a payment attempt (design decision, A-17)

`provider_reference` is optional (A-13), so the service must decide which payment attempt an event refers to. The rule is **never guess**. After the subscription, invoice, amount and currency checks pass:

| Step | Condition | Result |
|---|---|---|
| 1 | `provider_reference` present **and** stored on an attempt of **this** invoice | Match that attempt (the preferred path) |
| 2 | `provider_reference` present **and** stored on an attempt of a **different** invoice | `422 EVENT_REFERENCE_MISMATCH`; no mutation |
| 3 | `provider_reference` absent, **or** present but not yet stored on any attempt (e.g. the attempt timed out before the provider returned a reference) | Consider the invoice's **unresolved** attempts (`pending` or `timed_out`) |
| 3a | Exactly **one** unresolved attempt | Match it. If a reference was supplied, store it on the attempt |
| 3b | **Zero** unresolved attempts | No attempt to reconcile. The event is decided by invoice state: `ignored` (`invoice_already_paid` or `no_unresolved_attempt`) |
| 3c | **Two or more** unresolved attempts | **Quarantine**: store the event as `quarantined` (`ambiguous_payment_attempt`) and change nothing else. Manual reconciliation is out of scope and is documented as a limitation |

`payment.refunded` matches by `provider_reference` when present. Otherwise it matches the invoice's single `succeeded` payment, of which at most one can exist (DB-INV-05).

Matching uses state, not timestamps. In normal operation step 3c should not happen, because the `BillingRunner` never creates a new attempt while an invoice still has an unresolved one. Quarantine is a defensive guard against provider or local inconsistencies, and it is tested by seeding that state deliberately.

### Event semantics

| Type | Effect when applicable |
|---|---|
| `payment.succeeded` | Payment attempt `succeeded`, invoice `paid`; subscription `trialing → active` or `past_due → active` |
| `payment.failed` | Payment attempt `failed`; subscription `trialing → past_due` or `active → past_due`. Ignored if the invoice is already `paid` |
| `payment.refunded` | Payment `refunded`, invoice `refunded`; **no subscription transition** (A-08) |

## 7. Error catalogue

| Code | Meaning |
|---|---|
| VALIDATION_ERROR | Request validation failed |
| CUSTOMER_NOT_FOUND | Unknown customer |
| INVALID_PLAN | Unknown plan |
| INVALID_PAYMENT_METHOD | Payment method rejected by the fixture rule |
| IDEMPOTENCY_KEY_REUSED | `Idempotency-Key` reused with a different request payload |
| SUBSCRIPTION_NOT_FOUND | Unknown subscription |
| INVALID_TRANSITION | Lifecycle transition not permitted |
| INVALID_SIGNATURE | Webhook signature missing or invalid |
| INVALID_EVENT | Webhook payload malformed or of an unsupported type |
| INVOICE_NOT_FOUND | Unknown invoice |
| EVENT_REFERENCE_MISMATCH | Webhook references do not match stored records |
| INTERNAL_ERROR | Unexpected failure |

## 8. Contract-to-persistence expectations

| API call | Expected persistence |
|---|---|
| Create, trial | Subscription + audit; no invoice or payment |
| Create, immediate | Subscription + invoice + one payment attempt + audit row(s) |
| Create with `Idempotency-Key` | Additionally one `idempotency_keys` row |
| Create replay (same key and payload) | Nothing new |
| Create, key reused with a different payload | Nothing |
| Retrieve | No mutation |
| Cancel (allowed) | Status, `canceled_at`, voided open invoices, audit row |
| Cancel (rejected) | No mutation |
| Webhook processed | Event row + payment/invoice update + subscription/audit update where a transition applies |
| Webhook ignored | Event row (`ignored` + reason) only |
| Webhook quarantined | Event row (`quarantined` + reason) only |
| Webhook duplicate | `delivery_count` + 1 only |
| Webhook 4xx | Nothing |

## 9. Optional contract extensions (not in the mandatory scope)

- A plan-change endpoint (A-14).
- Concurrent in-flight requests sharing one `Idempotency-Key`.

(The `Idempotency-Key` on `POST /subscriptions` was moved into the mandatory scope; see §3.1.)

## 10. Contract testing checklist

- [ ] Success request/response shape for every endpoint.
- [ ] Each required validation failure, with no side effects and no provider call.
- [ ] Documented status codes and error codes.
- [ ] Signature verified over the raw body: valid, wrong secret, missing, tampered body.
- [ ] Malformed and unsupported-type webhook payloads.
- [ ] Duplicate, ignored and quarantined acknowledgment bodies.
- [ ] `Idempotency-Key` replay (same payload) and rejection (different payload).
- [ ] Event-to-attempt matching with and without `provider_reference`.
- [ ] API response equals SQLite state.
