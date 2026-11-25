
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.ts"],
  clearMocks: true,

  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.d.ts"
  ],

  coverageDirectory: "coverage",

  coverageReporters: [
    "text",
    "html",
    "lcov"
  ],

  coverageThreshold: {
    global: {
      statements: 90,
      branches: 85,
      functions: 90,
      lines: 90
    }
  }
};
