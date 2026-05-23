import type { Server } from 'http';

/**
 * Module-level singleton shared between global-setup and global-teardown.
 * Both run in the same Node.js process, so the module cache is shared.
 */
export const serverState: {
  server: Server | null;
  dbPath: string | null;
} = {
  server: null,
  dbPath: null,
};
