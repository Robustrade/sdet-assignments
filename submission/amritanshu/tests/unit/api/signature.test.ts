import { describe, expect, it } from "vitest";

import {
  generateSignature,
  verifySignature,
} from "../../../src/api/signature.js";

describe("Webhook signature", () => {
  const secret = "test-webhook-secret";
  const body = JSON.stringify({
    event_id: "evt_001",
    type: "payment.succeeded",
  });

  it("should generate a deterministic HMAC signature", () => {
    const first = generateSignature(body, secret);
    const second = generateSignature(body, secret);

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it("should accept a valid signature", () => {
    const signature = generateSignature(body, secret);

    expect(
      verifySignature(body, signature, secret),
    ).toBe(true);
  });

  it("should reject an invalid signature", () => {
    expect(
      verifySignature(
        body,
        "invalid-signature",
        secret,
      ),
    ).toBe(false);
  });

  it("should reject a missing signature", () => {
    expect(
      verifySignature(body, undefined, secret),
    ).toBe(false);
  });

  it("should reject a signature generated from a different body", () => {
    const signature = generateSignature(body, secret);

    const modifiedBody = JSON.stringify({
      event_id: "evt_999",
      type: "payment.succeeded",
    });

    expect(
      verifySignature(
        modifiedBody,
        signature,
        secret,
      ),
    ).toBe(false);
  });

  it("should reject a signature generated with a different secret", () => {
    const signature = generateSignature(
      body,
      "different-secret",
    );

    expect(
      verifySignature(body, signature, secret),
    ).toBe(false);
  });
});