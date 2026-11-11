/** Port/Adapter seam: production code can provide another implementation. */
export class PaymentProviderAdapter {
  async charge(_request) { throw new Error('Payment provider adapter not implemented'); }
}

export class MockPaymentProvider extends PaymentProviderAdapter {
  constructor(outcomes = []) { super(); this.calls = []; this.outcomes = [...outcomes]; }
  async charge(request) {
    this.calls.push(structuredClone(request));
    const outcome = this.outcomes.shift() ?? 'success';
    if (outcome === 'decline') return { success: false, status: 'declined', code: 'card_declined' };
    if (outcome === 'timeout') throw new Error('Payment provider timeout');
    return { success: true, status: 'succeeded', provider_reference: `pp_ref_${request.invoiceId}` };
  }
}
