import { describe, expect, test } from "vitest";

import { InMemoryAuditLogRepository }
from "../../src/repositories/InMemoryAuditLogRepository";

describe("Audit Log Repository", () => {

  test("stores audit events", () => {

    const repository =
      new InMemoryAuditLogRepository();

    repository.save({
      id: "audit_001",
      subscriptionId: "sub_001",
      event: "SUBSCRIPTION_CREATED",
      timestamp: new Date()
    });

    expect(
      repository.getAll().length
    ).toBe(1);

  });

});