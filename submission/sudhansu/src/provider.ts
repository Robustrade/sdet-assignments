export interface ChargeRequest {
  subscriptionId: string; invoiceId: string; customerId: string;
  paymentMethodId: string; amount: number; currency: 'USD'; idempotencyKey: string;
}
export type ChargeResult = { outcome: 'success' | 'decline'; reference: string };
export interface PaymentProvider { charge(request: ChargeRequest): Promise<ChargeResult> }
export class FakePaymentProvider implements PaymentProvider {
  calls: ChargeRequest[] = [];
  outcome: 'success' | 'decline' | 'timeout' = 'success';
  async charge(request: ChargeRequest): Promise<ChargeResult> {
    this.calls.push(structuredClone(request));
    if (this.outcome === 'timeout') throw new Error('PROVIDER_TIMEOUT');
    return { outcome: this.outcome, reference: `provider_${request.invoiceId}` };
  }
}
