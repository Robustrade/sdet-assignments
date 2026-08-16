import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    clearMocks: true,
    restoreMocks: true,
  },
});