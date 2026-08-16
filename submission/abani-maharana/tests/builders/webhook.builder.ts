import { createHmac } from "node:crypto";

import { WebhookType } from "../../src/domain/types";

export interface TestWebhook {
  event_id: string;

  type: WebhookType | string;

  subscription_id: string;

  invoice_id: string;

  amount: number;

  currency: string;
}

export class WebhookBuilder {
  private payload: TestWebhook = {
    event_id: "evt_test_001",

    type: "payment.succeeded",

    subscription_id: "sub_test",

    invoice_id: "inv_test",

    amount: 999,

    currency: "USD",
  };

  withEventId(eventId: string): this {
    this.payload.event_id = eventId;

    return this;
  }

  /*
   * Deliberately accepts string so tests can
   * construct malformed webhook payloads.
   *
   * The production route remains protected
   * by Zod's WebhookType validation.
   */
  withType(type: WebhookType | string): this {
    this.payload.type = type;

    return this;
  }

  withSubscriptionId(id: string): this {
    this.payload.subscription_id = id;

    return this;
  }

  withInvoiceId(id: string): this {
    this.payload.invoice_id = id;

    return this;
  }

  withAmount(amount: number): this {
    this.payload.amount = amount;

    return this;
  }

  build(): TestWebhook {
    return structuredClone(this.payload);
  }

  buildSigned(secret: string): {
    payload: TestWebhook;

    signature: string;
  } {
    const payload = this.build();

    /*
     * Sign the exact JSON representation
     * that is sent to the HTTP endpoint.
     */
    const rawBody = JSON.stringify(payload);

    const signature = createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");

    return {
      payload,
      signature,
    };
  }
}
