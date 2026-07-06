# Wallet Transfer Service API Automation

## Overview

This repository contains an automated API test suite for the Wallet Transfer Service using **Playwright** and **JavaScript**.

The framework is designed with a focus on maintainability, readability, and reusability by separating API interactions, test data, and test scenarios into dedicated modules.

---

## Tech Stack

- Playwright
- JavaScript (Node.js)
- REST API Testing

---

## Project Structure

```
sample-candidate-js-Soumya
│
├── tests
│   ├── api
│   │   ├── happyPath.spec.js
│   │   ├── validation.spec.js
│   │   ├── insufficientBalance.spec.js
│   │   ├── idempotency.spec.js
│   │   ├── wallet.spec.js
│   │   ├── transfer.spec.js
│   │   └── reliability.spec.js
│   │
│   └── helpers
│       ├── apiClient.js
│       ├── endpoints.js
│       └── testData.js
│
├── playwright.config.js
├── package.json
└── README.md
```

---

## Framework Design

The framework follows a modular design:

### API Client

Encapsulates all HTTP requests and API operations.

### Test Data

Provides reusable request payloads and wallet constants to avoid duplication across tests.

### Endpoints

Maintains API endpoint constants in a single location.

### Test Suites

Each specification file validates a specific functional area, improving readability and maintainability.

---

## Test Coverage

The automated suite covers the following scenarios:

### Happy Path

- Successful wallet transfer

### Validation

- Missing mandatory fields
- Invalid currency
- Zero transfer amount
- Same source and destination wallet

### Balance Validation

- Insufficient wallet balance
- Wallet balance updates after successful transfer

### Idempotency

- Repeated request with same payload and idempotency key
- Repeated request with different payload using the same idempotency key

### Transfer Retrieval

- Retrieve transfer details using Transfer ID

### Reliability

- Multiple concurrent transfer requests

---

## Prerequisites

- Node.js
- npm
- Python 3
- Flask

---

## Installation

Install project dependencies:

```bash
npm install
```

Install the Playwright browsers:

```bash
npx playwright install
```

Install the Python dependencies for the Wallet Transfer Service:

```bash
pip install -r requirements.txt
```

---

## Running the Wallet Transfer Service

Start the Flask application:

```bash
python run.py
```

The service will be available at:

```
http://localhost:3000
```

---

## Running the Test Suite

Execute all tests:

```bash
npx playwright test
```

Run an individual test file:

```bash
npx playwright test tests/api/happyPath.spec.js
```

---

## Test Report

Open the Playwright HTML report:

```bash
npx playwright show-report
```

---

## Assumptions

- The Wallet Transfer Service is running locally on port **3000**.
- Wallet data is pre-seeded by the application.
- Tests are executed sequentially (`workers: 1`) to prevent interference caused by shared application state.

---

## Future Enhancements

- Environment-based configuration
- CI/CD integration
- JSON Schema validation
- API request/response logging
- Enhanced reporting
- Test data generation utilities