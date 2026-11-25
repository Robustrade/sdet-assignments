
# Subscription Billing API Contract

## 1. Create Subscription

POST /subscriptions

Request:
{
  "customer_id": "cust_001",
  "plan": "pro",
  "payment_method_id": "pm_test_visa_4242"
}

Expected:
- HTTP 201
- Subscription ID returned
- Initial status follows plan configuration
- Payment provider called when immediate charging is required

Failure responses:
- 400: Invalid request
- 404: Unknown customer or plan

## 2. Get Subscription

GET /subscriptions/:id

Expected:
- HTTP 200
- Current subscription details returned

Failure:
- 404: Subscription not found

## 3. Cancel Subscription

POST /subscriptions/:id/cancel

Expected:
- HTTP 200
- Subscription status becomes canceled
- Future billing is stopped

Failure:
- 404: Subscription not found
- 409: Already canceled

## 4. Payment Webhook

POST /webhooks/payment-provider

Header:
X-Provider-Signature: <HMAC-SHA256 signature>

Supported event types:
- payment.succeeded
- payment.failed
- payment.refunded

Expected:
- HTTP 200 for successfully processed events
- HTTP 200 for recognized duplicate events
- HTTP 401 for invalid or missing signatures
- HTTP 400 for malformed payloads

## 5. Webhook Event Structure

{
  "event_id": "evt_001",
  "type": "payment.succeeded",
  "subscription_id": "sub_001",
  "invoice_id": "inv_001",
  "amount": 4900,
  "currency": "USD"
}
