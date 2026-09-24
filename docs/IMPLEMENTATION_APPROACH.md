# SDET Assignment - Implementation Approach

## 1. Understanding

The assignment requires an automated validation solution for a
Subscription and Billing Service.

The solution will validate the following areas:

- Subscription APIs
- Subscription lifecycle and state transitions
- Persistence and data integrity
- Payment provider interactions
- Webhook processing
- Webhook idempotency
- Invalid state transitions
- Error handling and validation

The implementation will focus on maintainable test architecture,
clear separation of responsibilities, and meaningful business
scenario coverage.

---

## 2. Technology Stack

The proposed solution will use:

- TypeScript
- Node.js
- Express
- Vitest
- Supertest
- In-memory persistence

The application and test code will follow an object-oriented
and modular design.

---

## 3. Proposed Architecture

The solution will separate business logic, persistence,
external dependencies, and API handling.

```text
                    API Layer
                       |
                       v
                Service Layer
                       |
                       v
              Domain / State Machine
                 /           \
                /             \
               v               v
        Repository        Payment Provider
               |               |
               v               v
        In-Memory DB      Mock Provider

                       |
                       v
                Webhook Handler