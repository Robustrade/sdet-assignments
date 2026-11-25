export interface IPaymentProvider {
  charge(
    customerId: string,
    amount: number
  ): Promise<boolean>;
}