import { test, expect } from "@playwright/test";
import { ApiClient } from "../../src/clients/api-client";

test.describe("OrangeHRM Login Page", () => {
  test("should load the login page successfully", async ({ request }) => {
    const apiClient = new ApiClient(request);

    const response = await apiClient.get(
      "https://opensource-demo.orangehrmlive.com/web/index.php/auth/login"
    );

    expect(response.status()).toBe(200);

    const contentType = response.headers()["content-type"];

    expect(contentType).toContain("text/html");

    const responseBody = await response.text();

    expect(responseBody).toContain("OrangeHRM");
  });
});
