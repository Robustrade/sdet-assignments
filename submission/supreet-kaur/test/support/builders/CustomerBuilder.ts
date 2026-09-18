/**
 * The service fixture doesn't model a full Customer entity (out of scope per the assignment's
 * Non-Goals), but tests still need readable, intention-revealing customer identities rather
 * than magic strings copy-pasted everywhere. CustomerBuilder centralizes the small set of
 * known personas used across the suite; the "known customer" allow-list itself lives in
 * SubscriptionService, which is what actually enforces "unknown customer" validation.
 */
export class CustomerBuilder {
  static known(): string {
    return "cust_001";
  }

  static secondKnown(): string {
    return "cust_002";
  }

  static unknown(): string {
    return "cust_does_not_exist";
  }
}
