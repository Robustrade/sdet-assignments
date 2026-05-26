async function globalTeardown() {
  if (process.env.SERVICE_PID) {
    try {
      process.kill(Number(process.env.SERVICE_PID));
      console.log('Wallet Transfer Service stopped');
    } catch (e) {
      // Already stopped
    }
  }
}

export default globalTeardown;
