class FakePaymentProvider {
  constructor() {
    this.calls = [];
    this.outcomeByReference = new Map();
    this.defaultOutcome = 'success';
  }

  setDefaultOutcome(outcome) {
    this.defaultOutcome = outcome;
  }

  setOutcomeFor(reference, outcome) {
    this.outcomeByReference.set(reference, outcome);
  }

  async charge(request) {
    this.calls.push({ ...request });
    const outcome =
      this.outcomeByReference.get(request.reference) || this.defaultOutcome;

    if (outcome === 'timeout') {
      const err = new Error('PAYMENT_TIMEOUT');
      err.code = 'PAYMENT_TIMEOUT';
      throw err;
    }

    if (outcome === 'decline') {
      return { ok: false, reason: 'card_declined' };
    }

    return { ok: true, providerChargeId: `ch_${request.reference}` };
  }
}

module.exports = {
  FakePaymentProvider,
};
