# Wallet Transfer SDET Automation

## Run Instructions

Terminal 1:
cd api-server
npm install
node server.js

Terminal 2:
npm install
npx playwright test

Coverage:
- Successful transfer
- Validation failures
- Insufficient balance
- Idempotency duplicate request
- Different payload same idempotency key
- Concurrency duplicate requests
- API contract validation