class MockPaymentProvider {
  constructor() {
    this.reset();
  }

  reset() {
    this.outcome = 'success';
    this.calls = [];
  }

  configure(outcome) {
    this.outcome = outcome;
  }

  charge(request) {
    this.calls.push({ ...request });

    if (this.outcome === 'timeout') {
      const error = new Error('Payment provider timeout');
      error.code = 'PROVIDER_TIMEOUT';
      throw error;
    }

    return { status: this.outcome === 'decline' ? 'failed' : 'succeeded' };
  }
}

module.exports = MockPaymentProvider;