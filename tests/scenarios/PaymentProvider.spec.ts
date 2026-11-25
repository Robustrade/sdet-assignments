import { describe, test, expect } from "vitest";

import { MockPaymentProvider }
from "../../src/providers/MockPaymentProvider";

describe("Mock Payment Provider", () => {

  test(
    "records charge requests",
    async () => {

      const provider =
        new MockPaymentProvider();

      await provider.charge(
        "cust_001",
        4900
      );

      expect(
        provider.calls.length
      ).toBe(1);

      expect(
        provider.calls[0]
      ).toEqual({
        customerId: "cust_001",
        amount: 4900
      });
    }
  );

});