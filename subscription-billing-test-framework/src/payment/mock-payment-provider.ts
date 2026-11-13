import { IPaymentProvider, ChargeRequest, ChargeResult } from './payment-provider.interface';
import { randomUUID } from 'crypto';

export class MockPaymentProvider implements IPaymentProvider {
  private mode: 'success' | 'decline' | 'timeout' = 'success';
  private callLog: ChargeRequest[] = [];

  public setMode(mode: 'success' | 'decline' | 'timeout'): void {
    this.mode = mode;
  }

  public getCallLog(): ChargeRequest[] {
    return [...this.callLog];
  }

  public clearLog(): void {
    this.callLog = [];
  }

  public async charge(request: ChargeRequest): Promise<ChargeResult> {
    this.callLog.push({ ...request });

    if (this.mode === 'timeout') {
      throw new Error('Payment gateway timeout');
    }

    if (this.mode === 'decline') {
      return {
        success: false,
        invoiceId: `inv_${randomUUID().substring(0, 8)}`,
        error: 'Card declined by issuing bank',
      };
    }

    return {
      success: true,
      invoiceId: `inv_${randomUUID().substring(0, 8)}`,
    };
  }
}