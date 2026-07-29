# Wallet Transfer SDET Automation

## Tech Stack

- TypeScript
- Playwright API Testing
- Node.js
- Express Mock API


## Project Structure

Wallet_Transfer_Ashvini

├── api-server
├── src
├── tests
├── playwright.config.ts
└── README.md


## Execution Steps

### Install dependencies

npm install


### Start Mock Wallet API

cd api-server

npm install

node server.js


### Execute Automation

npx playwright test


### Test Result

4 scenarios automated successfully:

✓ Successful wallet transfer

✓ Duplicate request handling using idempotency key

✓ Invalid transfer validation

✓ Concurrent duplicate request handling