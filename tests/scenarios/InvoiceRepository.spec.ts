import { describe, test, expect } from "vitest";

import { InMemoryInvoiceRepository }
from "../../src/repositories/InMemoryInvoiceRepository";

describe("Invoice Repository", () => {

  test(
    "saves and retrieves invoice",
    () => {

      const repository =
        new InMemoryInvoiceRepository();

      const invoice = {
        id: "inv_001",
        subscriptionId: "sub_001",
        amount: 4900,
        status: "SUCCESS" as const
      };

      repository.save(invoice);

      const result =
        repository.findById("inv_001");

      expect(result).toEqual(invoice);
    }
  );

});