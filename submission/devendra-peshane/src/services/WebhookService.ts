import { createHmac, timingSafeEqual } from "node:crypto";
import { BillingRepository } from "../repositories/BillingRepository";

type EventType =
  | "payment.succeeded"
  | "payment.failed"
  | "payment.refunded";

interface ProviderEvent {
  id: string;
  type: EventType;
  data: {
    invoiceId: string;
    transactionId?: string;
    amount?: number;
  };
}

export class WebhookService {
  constructor(
    private readonly repository: BillingRepository,
    private readonly secret: string
  ) {}

  static sign(rawBody: string, secret: string): string {
    return createHmac("sha256", secret).update(rawBody).digest("hex");
  }

  async handle(
    rawBody: Buffer,
    signature: string | undefined
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    if (!signature || !/^(sha256=)?[a-fA-F0-9]{64}$/.test(signature)) {
      return { status: 401, body: { error: "Invalid webhook signature" } };
    }

    const supplied = signature.replace(/^sha256=/, "");
    const expected = WebhookService.sign(
      rawBody.toString("utf8"),
      this.secret
    );

    const suppliedBuffer = Buffer.from(supplied, "hex");
    const expectedBuffer = Buffer.from(expected, "hex");

    if (
      suppliedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(suppliedBuffer, expectedBuffer)
    ) {
      return { status: 401, body: { error: "Invalid webhook signature" } };
    }

    let event: ProviderEvent;

    try {
      event = JSON.parse(rawBody.toString("utf8")) as ProviderEvent;
    } catch {
      return { status: 400, body: { error: "Malformed JSON payload" } };
    }

    const validTypes: string[] = [
      "payment.succeeded",
      "payment.failed",
      "payment.refunded",
    ];

    if (
      !event ||
      typeof event.id !== "string" ||
      !event.id ||
      !validTypes.includes(event.type) ||
      !event.data ||
      typeof event.data.invoiceId !== "string" ||
      !event.data.invoiceId
    ) {
      return { status: 400, body: { error: "Invalid webhook payload" } };
    }

    if (this.repository.findEvent(event.id)) {
      return {
        status: 200,
        body: { received: true, duplicate: true },
      };
    }

    const invoice = this.repository.findInvoice(event.data.invoiceId);

    if (!invoice) {
      return { status: 404, body: { error: "Invoice not found" } };
    }

    if (event.type === "payment.succeeded") {
      if (invoice.status !== "refunded") {
        const transactionId =
          event.data.transactionId ?? `txn_${invoice.id}`;

        this.repository.saveInvoice({
          ...invoice,
          status: "paid",
          transactionId,
        });

        this.repository.savePayment({
          id: `pay_${invoice.id}`,
          invoiceId: invoice.id,
          amount: event.data.amount ?? invoice.amount,
          status: "succeeded",
          transactionId,
        });
      }
    } else if (event.type === "payment.failed") {
      if (invoice.status === "pending") {
        this.repository.saveInvoice({ ...invoice, status: "failed" });

        this.repository.savePayment({
          id: `pay_${invoice.id}`,
          invoiceId: invoice.id,
          amount: event.data.amount ?? invoice.amount,
          status: "failed",
        });
      }
    } else if (event.type === "payment.refunded") {
      if (invoice.status === "paid") {
        this.repository.saveInvoice({ ...invoice, status: "refunded" });

        this.repository.savePayment({
          id: `pay_${invoice.id}`,
          invoiceId: invoice.id,
          amount: event.data.amount ?? invoice.amount,
          status: "refunded",
          transactionId: invoice.transactionId,
        });
      }
    }

    this.repository.saveEvent({
      id: event.id,
      type: event.type,
      invoiceId: invoice.id,
      processed: true,
    });

    this.repository.addAudit({
      action: event.type,
      entityId: invoice.id,
      timestamp: new Date().toISOString(),
    });

    return {
      status: 200,
      body: { received: true, duplicate: false },
    };
  }
}