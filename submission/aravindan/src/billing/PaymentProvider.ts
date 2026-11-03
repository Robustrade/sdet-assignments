export class PaymentProviderMock {
  calls: any[];
  responses: any[];

  constructor(initialResponses: any[] = []) {
    this.calls = [];
    this.responses = [...initialResponses];
  }

  queueResponse(response: any) {
    this.responses.push(response);
  }

  setResponses(responses: any[]) {
    this.responses = [...responses];
  }

  async charge({ subscriptionId, customerId, amount, currency, paymentMethodId }: any) {
    const entry = {
      subscriptionId,
      customerId,
      amount,
      currency,
      paymentMethodId,
      timestamp: new Date().toISOString(),
    };

    this.calls.push(entry);

    const nextResponse = this.responses.shift() ?? { ok: true };
    if (nextResponse && typeof nextResponse === 'object' && 'ok' in nextResponse) {
      return { ...nextResponse, providerCall: entry };
    }

    return { ok: true, providerCall: entry };
  }
}

module.exports = { PaymentProviderMock };
