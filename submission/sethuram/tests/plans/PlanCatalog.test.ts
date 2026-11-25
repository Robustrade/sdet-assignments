
import { PlanCatalog } from "../../src/domain/Plan";

describe("Subscription plan configuration", () => {
  let catalog: PlanCatalog;

  beforeEach(() => {
    catalog = new PlanCatalog();
  });

  test("basic plan has correct price", () => {
    expect(catalog.getPlan("plan_basic").amount)
      .toBe(1900);
  });

  test("basic plan has 14 days trial", () => {
    expect(catalog.getPlan("plan_basic").trialDays)
      .toBe(14);
  });

  test("pro plan has correct price", () => {
    expect(catalog.getPlan("plan_pro").amount)
      .toBe(4900);
  });

  test("pro plan requires immediate billing", () => {
    expect(catalog.getPlan("plan_pro").trialDays)
      .toBe(0);
  });

  test("rejects an unknown plan", () => {
    expect(() => catalog.getPlan("invalid_plan"))
      .toThrow("Invalid plan");
  });

  test("plan currency is USD", () => {
    expect(catalog.getPlan("plan_pro").currency)
      .toBe("USD");
  });
});
