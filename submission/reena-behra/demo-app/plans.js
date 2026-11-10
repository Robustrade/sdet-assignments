// Prices are in cents (4900 = $49.00).
export const PLANS = {
  basic: { price: 1900, chargeAtSignup: false }, // free trial first, charged later
  pro: { price: 4900, chargeAtSignup: true }, // charged immediately
};

export const MAX_FAILED_PAYMENTS = 3;
