
import { WebhookSignature } from "../../src/services/WebhookSignature";

describe("Webhook signature verification", () => {
  const verifier = new WebhookSignature("test_secret");

  const payload = JSON.stringify({
    event_id: "evt_001",
    type: "payment.succeeded"
  });

  test("generates a valid HMAC signature", () => {
    const signature = verifier.sign(payload);

    expect(signature).toMatch(/^[a-f0-9]{64}$/);
  });

  test("accepts a valid signature", () => {
    const signature = verifier.sign(payload);

    expect(verifier.verify(payload, signature))
      .toBe(true);
  });

  test("rejects a tampered payload", () => {
    const signature = verifier.sign(payload);

    expect(verifier.verify("modified_payload", signature))
      .toBe(false);
  });

  test("rejects an invalid signature", () => {
    expect(verifier.verify(payload, "invalid_signature"))
      .toBe(false);
  });

  test("rejects a missing signature", () => {
    expect(verifier.verify(payload, ""))
      .toBe(false);
  });

  test("rejects a signature generated with a wrong secret", () => {
    const wrongVerifier = new WebhookSignature("wrong_secret");

    const signature = wrongVerifier.sign(payload);

    expect(verifier.verify(payload, signature))
      .toBe(false);
  });

  test("generates consistent signatures for the same payload", () => {
    expect(verifier.sign(payload))
      .toBe(verifier.sign(payload));
  });

  test("rejects an empty webhook secret", () => {
    expect(() => new WebhookSignature(""))
      .toThrow("Webhook secret is required");
  });
});
