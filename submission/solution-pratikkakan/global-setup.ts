import path from 'path';
import os from 'os';
import fs from 'fs';
import type { AddressInfo } from 'net';
import { createDatabase } from './src/service/db';
import { createApp } from './src/service/server';
import { serverState } from './server-state';

export default async function globalSetup(): Promise<void> {
  const dbPath = path.join(os.tmpdir(), `wallet-test-${Date.now()}.db`);
  const db = createDatabase(dbPath);
  const app = createApp(db);

  await new Promise<void>((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      // address() is only valid after the listen callback fires
      const address = server.address() as AddressInfo;
      const baseURL = `http://127.0.0.1:${address.port}`;

      serverState.server = server;
      serverState.dbPath = dbPath;

      fs.writeFileSync(
        path.join(__dirname, '.test-env.json'),
        JSON.stringify({ baseURL, dbPath }),
      );

      console.log(`[setup] Server ready → ${baseURL}`);
      resolve();
    });
    server.once('error', reject);
  });
}
