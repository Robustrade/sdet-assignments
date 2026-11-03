import { defineConfig } from "@playwright/test";
import dotenv from "dotenv";

dotenv.config();

const apiBaseUrl = process.env.API_BASE_URL;

if (!apiBaseUrl) {
  throw new Error("API_BASE_URL is missing in the .env file.");
}

export default defineConfig({
  testDir: "./tests",
  timeout: 30000,

  expect: {
    timeout: 5000
  },

  fullyParallel: false,
  workers: 1,
  retries: 0,

  reporter: [
    ["list"],
    [
      "html",
      {
        outputFolder: "playwright-report",
        open: "never"
      }
    ]
  ],

  use: {
    baseURL: apiBaseUrl,
    extraHTTPHeaders: {
      Accept: "application/json"
    },
    trace: "retain-on-failure"
  }
});
