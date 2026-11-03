/**
 * The lifecycle diagram from the assignment, transcribed by hand. This is the test oracle:
 * it is intentionally *not* derived from the service's transition table.
 */
export const DIAGRAM_EDGES = [
  'trialing->active',
  'trialing->past_due',
  'active->past_due',
  'past_due->active',
  'past_due->canceled',
  'active->canceled',
  'trialing->canceled',
] as const;

export type DiagramEdge = (typeof DIAGRAM_EDGES)[number];

/** Expected trigger table, including the two status-preserving self-loops. */
export const EXPECTED_TRIGGERS: Record<string, string> = {
  'trialing+charge_succeeded': 'active',
  'trialing+charge_failed': 'past_due',
  'trialing+cancel_requested': 'canceled',
  'active+charge_succeeded': 'active',
  'active+charge_failed': 'past_due',
  'active+cancel_requested': 'canceled',
  'past_due+charge_succeeded': 'active',
  'past_due+retry_failed': 'past_due',
  'past_due+retries_exhausted': 'canceled',
};
