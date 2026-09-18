export interface PaymentRequest {
    subscriptionId: string;
    amount: number;
    currency: string;
}

export interface PaymentResult {
    success: boolean;
    providerPaymentId: string;
    amount: number;
    currency: string;
    errorCode?: string;
    errorMessage?: string;
}

export interface PaymentProvider {
    charge(request: PaymentRequest): PaymentResult;
}