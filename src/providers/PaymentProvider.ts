export interface ChargeRequest {

    customerId: string;

    amount: number;

    paymentMethodId: string;

    referenceId: string;

}


export interface ChargeResponse {

    success: boolean;

    transactionId?: string;

    error?: string;

}


export interface PaymentProvider {

    charge(
        request: ChargeRequest
    ): Promise<ChargeResponse>;

}