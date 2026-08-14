export type ChargeResult = { success: boolean; providerChargeId?: string; errorCode?: string };

export interface PaymentProvider {
    charge(args: { amount: number; currency: string; customerId: string; paymentMethodId: string; idempotencyKey?: string }): Promise<ChargeResult>;
}

export class FakePaymentProvider implements PaymentProvider {
    calls: Array<any> = [];
    nextResult: ChargeResult = { success: true, providerChargeId: "ch_1" };

    async charge(args: { amount: number; currency: string; customerId: string; paymentMethodId: string; idempotencyKey?: string }) {
        this.calls.push(args);
        // simulate async
        return this.nextResult;
    }
}
