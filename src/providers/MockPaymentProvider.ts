import { IPaymentProvider } from "./IPaymentProvider";

export class MockPaymentProvider
  implements IPaymentProvider {

  public calls: {
    customerId: string;
    amount: number;
  }[] = [];

  public shouldSucceed = true;

  async charge(
    customerId: string,
    amount: number
  ): Promise<boolean> {

    this.calls.push({
      customerId,
      amount
    });

    return this.shouldSucceed;
  }
}