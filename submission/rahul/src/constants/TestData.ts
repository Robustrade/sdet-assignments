export const TestData = {
  subscriptionPlans: {
    basic: 'basic',
    premium: 'premium',
    enterprise: 'enterprise',
  },

  subscriptionStatuses: {
    active: 'active',
    cancelled: 'cancelled',
    expired: 'expired',
  },

  billingStatuses: {
    pending: 'pending',
    paid: 'paid',
    failed: 'failed',
  },
} as const;
