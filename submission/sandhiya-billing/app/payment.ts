export interface PaymentCall {
  customer_id: string;
  payment_method_id: string;
  amount_cents: number;
  currency: string;
}

export interface PaymentProvider {
  charge(
    customerId: string,
    paymentMethodId: string,
    amountCents: number,
    currency?: string,
  ): boolean;
}

export class RecordingPaymentProvider {
  readonly calls: PaymentCall[] = [];
  private readonly outcomes: boolean[];

  constructor(outcomes: boolean[] = [true]) {
    this.outcomes = [...outcomes];
  }

  charge(customerId: string, paymentMethodId: string, amountCents: number, currency = "USD"): boolean {
    this.calls.push({
      customer_id: customerId,
      payment_method_id: paymentMethodId,
      amount_cents: amountCents,
      currency,
    });
    if (this.outcomes.length === 0) {
      return true;
    }
    return Boolean(this.outcomes.shift());
  }
}

export class FakePaymentProvider {
  readonly calls: PaymentCall[] = [];
  private readonly success: boolean;
  private readonly timeout: boolean;

  constructor({ success = true, timeout = false }: { success?: boolean; timeout?: boolean } = {}) {
    this.success = success;
    this.timeout = timeout;
  }

  charge(customerId: string, paymentMethodId: string, amountCents: number, currency = "USD"): boolean {
    this.calls.push({
      customer_id: customerId,
      payment_method_id: paymentMethodId,
      amount_cents: amountCents,
      currency,
    });
    if (this.timeout) {
      throw new Error("payment provider timeout");
    }
    return this.success;
  }
}
