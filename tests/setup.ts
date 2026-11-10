/**
 * Jest Test Setup
 *
 * Runs before all tests to configure the test environment.
 */

// Extend Jest timeout for integration tests
jest.setTimeout(10000);

// Suppress console logs during tests (optional)
// global.console = {
//   ...console,
//   log: jest.fn(),
//   debug: jest.fn(),
//   info: jest.fn(),
// };
