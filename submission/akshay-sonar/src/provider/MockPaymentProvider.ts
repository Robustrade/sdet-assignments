import {
  PaymentProvider,
  PaymentRequest,
  PaymentResult,
  PaymentOutcome,
} from "./PaymentProvider";

export class MockPaymentProvider implements PaymentProvider {
  private outcome: PaymentOutcome = "success";
  private readonly requests: PaymentRequest[] = [];

  setOutcome(outcome: PaymentOutcome): void {
    this.outcome = outcome;
  }

  async charge(request: PaymentRequest): Promise<PaymentResult> {
    this.requests.push({ ...request });

    if (this.outcome === "timeout") {
      throw new Error("Payment provider timeout");
    }

    return {
      success: this.outcome === "success",
      providerPaymentId: `mock_payment_${this.requests.length}`,
      outcome: this.outcome,
    };
  }

  getCallCount(): number {
    return this.requests.length;
  }

  getLastRequest(): PaymentRequest | undefined {
    return this.requests[this.requests.length - 1];
  }

  getRequests(): PaymentRequest[] {
    return [...this.requests];
  }

  reset(): void {
    this.requests.length = 0;
    this.outcome = "success";
  }
}