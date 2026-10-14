export type PaymentResult =
  | { status: "success"; transactionId: string }
  | { status: "declined"; reason: string }
  | { status: "timeout"; reason: string };

export interface PaymentProvider {
  charge(
    customerId: string,
    amount: number,
    idempotencyKey: string
  ): Promise<PaymentResult>;
}

export type MockPaymentOutcome = "success" | "declined" | "timeout";

export class MockPaymentProvider implements PaymentProvider {
  readonly calls: Array<{
    customerId: string;
    amount: number;
    idempotencyKey: string;
  }> = [];

  constructor(
    private outcome: MockPaymentOutcome = "success"
  ) {}

  setOutcome(outcome: MockPaymentOutcome): void {
    this.outcome = outcome;
  }

  async charge(
    customerId: string,
    amount: number,
    idempotencyKey: string
  ): Promise<PaymentResult> {
    this.calls.push({ customerId, amount, idempotencyKey });

    switch (this.outcome) {
      case "success":
        return {
          status: "success",
          transactionId: `txn_${idempotencyKey}`,
        };

      case "declined":
        return {
          status: "declined",
          reason: "Payment declined",
        };

      case "timeout":
        return {
          status: "timeout",
          reason: "Payment provider timed out",
        };
    }
  }
}
