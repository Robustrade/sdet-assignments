export type InvoiceStatus = | "pending" | "succeeded" | "failed";

export interface Invoice { id: string; subscriptionId: string; customerId: string; amountInCents: number; currency: "USD"; status: InvoiceStatus; providerReference: string | null; idempotencyKey: string; createdAt: string; updatedAt: string; }