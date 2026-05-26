import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

let serviceProcess: ChildProcess;

async function globalSetup() {
  // Start the wallet transfer service before tests run
  serviceProcess = spawn('node', [path.join(__dirname, '../service/server.js')], {
    env: { ...process.env, PORT: '3000' },
    stdio: 'pipe',
  });

  // Wait for service to be ready
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Service failed to start')), 10000);

    serviceProcess.stdout?.on('data', (data: Buffer) => {
      if (data.toString().includes('running on port')) {
        clearTimeout(timeout);
        resolve();
      }
    });

    serviceProcess.on('error', reject);
  });

  // Store PID for teardown
  process.env.SERVICE_PID = String(serviceProcess.pid);
  console.log(`Wallet Transfer Service started (PID: ${serviceProcess.pid})`);
}

export default globalSetup;
