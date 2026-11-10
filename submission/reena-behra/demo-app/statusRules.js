// Which status a subscription is allowed to move to from its current status.
// Anything not listed here is not allowed (for example canceled -> active).
export const ALLOWED_STATUS_CHANGES = {
  trialing: ['active', 'past_due', 'canceled'],
  active: ['past_due', 'canceled'],
  past_due: ['active', 'canceled'],
  canceled: [],
};

export function canChangeStatus(from, to) {
  return ALLOWED_STATUS_CHANGES[from].includes(to);
}
