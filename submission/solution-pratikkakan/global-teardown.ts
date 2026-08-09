import fs from 'fs';
import path from 'path';
import { serverState } from './server-state';

export default async function globalTeardown(): Promise<void> {
  await new Promise<void>((resolve) => {
    if (serverState.server) {
      serverState.server.close(() => resolve());
    } else {
      resolve();
    }
  });

  if (serverState.dbPath && fs.existsSync(serverState.dbPath)) {
    fs.unlinkSync(serverState.dbPath);
  }

  const envFile = path.join(__dirname, '.test-env.json');
  if (fs.existsSync(envFile)) {
    fs.unlinkSync(envFile);
  }

  console.log('[teardown] Server stopped, database removed.');
}
