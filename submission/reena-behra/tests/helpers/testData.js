// Test cards understood by the fake payment gateway (like Stripe test cards).
export const CARDS = {
  ok: 'card_ok',
  declined: 'card_declined',
  timeout: 'card_timeout',
};

// What we EXPECT each plan to cost, written from the requirements (not copied from the app code).
export const PLAN_PRICE = {
  basic: 1900,
  pro: 4900,
};

export const uniqueName = (prefix = 'customer') => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
