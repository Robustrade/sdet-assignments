/**
 * Centralized config for the application. Values are read from environment
 * variables with sensible defaults for local/testing use.
 */
export const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'test_webhook_secret';

export default {
  WEBHOOK_SECRET
};
