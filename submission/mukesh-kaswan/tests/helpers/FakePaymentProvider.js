const { PaymentProviderTimeoutError } = require('../../src/paymentProvider');

/**
 * Test double for the payment provider. Implements the same charge() contract
 * as a real provider, lets a test choose the outcome, and records every call.
 */
class FakePaymentProvider {
  constructor() {
    this.calls = [];
    this.outcome = { type: 'success' };
  }

  willSucceed() {
    this.outcome = { type: 'success' };
    return this;
  }

  willDecline(declineCode = 'card_declined') {
    this.outcome = { type: 'decline', declineCode };
    return this;
  }

  willTimeout() {
    this.outcome = { type: 'timeout' };
    return this;
  }

  async charge(request) {
    this.calls.push({ ...request });
    const chargeId = `ch_fake_${this.calls.length}`;

    if (this.outcome.type === 'timeout') throw new PaymentProviderTimeoutError();
    if (this.outcome.type === 'decline') {
      return { status: 'declined', charge_id: chargeId, decline_code: this.outcome.declineCode };
    }
    return { status: 'succeeded', charge_id: chargeId };
  }
}

module.exports = { FakePaymentProvider };
