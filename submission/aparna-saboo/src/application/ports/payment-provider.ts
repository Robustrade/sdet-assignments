import type { CurrencyCode } from '../../domain/models/subscription';

export type PaymentOutcome = 'success' | 'decline' | 'timeout';

export interface ChargeCustomerArgs {
  customerId: string;
  amount: number;
  currency: CurrencyCode;
  paymentMethodId: string;
  subscriptionId: string;
}

export interface ChargeCustomerResult {
  success: boolean;
  outcome: PaymentOutcome;
  providerReference?: string;
  error?: string;
}

export interface PaymentProvider {
  chargeCustomer(args: ChargeCustomerArgs): Promise<ChargeCustomerResult>;
}
