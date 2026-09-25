import { describe, expect, it } from "vitest";

import { CustomerBuilder } from "../../../src/builders/customer-builder.js";

describe("CustomerBuilder", () => {
  it("should build a customer with default values", () => {
    const customer = new CustomerBuilder().build();

    expect(customer).toEqual({
      id: "cust_001",
      name: "Test Customer",
      email: "customer@example.com",
    });
  });

  it("should allow customer properties to be customized", () => {
    const customer = new CustomerBuilder()
      .withId("cust_123")
      .withName("John Doe")
      .withEmail("john@example.com")
      .build();

    expect(customer).toEqual({
      id: "cust_123",
      name: "John Doe",
      email: "john@example.com",
    });
  });
});