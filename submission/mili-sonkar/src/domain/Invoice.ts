export type InvoiceState =
    | 'pending'
    | 'succeeded'
    | 'failed'
    | 'refunded';

export interface Invoice {
    id: string;
    subscriptionId: string;
    amount: number;
    currency: string;
    status: InvoiceState;
}