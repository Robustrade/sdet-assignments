export interface ChargeRequest {
  subscriptionId: string; invoiceId: string; customerId: string;
  paymentMethodId: string; amount: number; currency: 'USD'; idempotencyKey: string;
}
export type ChargeResult = { outcome: 'success' | 'decline'; reference: string };
export interface PaymentGateway { submitCharge(request: ChargeRequest): Promise<ChargeResult> }
export class FakePaymentGateway implements PaymentGateway {
  calls: ChargeRequest[] = [];
  outcome: 'success' | 'decline' | 'timeout' = 'success';
  async submitCharge(request: ChargeRequest): Promise<ChargeResult> {
    this.calls.push(structuredClone(request));
    if (this.outcome === 'timeout') throw new Error('PROVIDER_TIMEOUT');
    return { outcome: this.outcome, reference: `provider_${request.invoiceId}` };
  }
}
