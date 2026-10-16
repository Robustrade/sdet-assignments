export type PaymentOutcome = | "succeeded" | "declined" | "timeout";

export interface ChargeRequest { customerId: string; paymentMethodId: string; amountInCents: number; currency: "USD"; idempotencyKey: string; }

export interface ChargeResult { outcome: PaymentOutcome; providerReference: string | null; message?: string; }

export interface PaymentProvider { charge(request: ChargeRequest): Promise<ChargeResult>; }