// Test data used by the tests.

// The card decides what the fake payment gateway does.
export const CARDS = {
  ok: 'card_ok', // payment succeeds
  declined: 'card_declined', // payment fails
  timeout: 'card_timeout', // gateway does not answer
};

export const PLANS = {
  basic: 'basic', // free trial, no payment
  pro: 'pro', // paid right away
  unknown: 'gold', // does not exist
};

export const PRO_PRICE = 4900; // in cents
