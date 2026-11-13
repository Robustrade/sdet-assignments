import { describe, expect, it } from "vitest";
import { TestDatabase } from "../../src/infrastructure/database";
import { CustomerRepository } from "../../src/infrastructure/customer-repository";

describe("Customer Repository", () => {
  it("saves and retrieves a customer", async () => {
    const database = await TestDatabase.create();

    try {
      const repository = new CustomerRepository(database);
      const customer = {
        id: "cust_001",
        name: "Ankit Kumar"
      };

      repository.save(customer);

      expect(repository.findById("cust_001")).toEqual(customer);
    } finally {
      database.close();
    }
  });

  it("returns undefined for an unknown customer", async () => {
    const database = await TestDatabase.create();

    try {
      const repository = new CustomerRepository(database);

      expect(repository.findById("cust_unknown")).toBeUndefined();
    } finally {
      database.close();
    }
  });
});