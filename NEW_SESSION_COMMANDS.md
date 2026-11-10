# Commands for New Claude Session

## 🚀 Quick Start - Resuming the Assignment

### Step 1: Verify Current Status

```bash
# Navigate to project
cd c:/Projects/Assignment/sdet-assignments

# Verify tests are passing
npm test

# Expected output:
# ✅ Test Suites: 1 passed
# ✅ Tests: 23 passed
# ✅ Time: ~2 seconds
```

### Step 2: Tell Claude What You Need

Copy and paste **ONE** of these prompts to Claude in your new session:

---

### **Option A: Complete the Entire Assignment** (Recommended)

```
I'm working on the API automation assignment in c:\Projects\Assignment\sdet-assignments

Phase 1 is complete with 23 tests passing. I need help completing Phase 2 and Phase 3:

Phase 2 (Next):
- Create Express API endpoints (POST /subscriptions, GET /subscriptions/:id, POST /subscriptions/:id/cancel, POST /webhooks/payment-provider)
- Write integration tests for API, database, and payment provider
- Implement webhook signature validation

Phase 3 (Final):
- Write end-to-end flow tests
- Create PR description

Please help me build Phase 2 step by step, starting with the Express API setup.

Reference: Check PROGRESS_SUMMARY.md and API_AUTOMATION_FRAMEWORK_DESIGN.md for full context.
```

---

### **Option B: Just Create the Express API** (Smaller Task)

```
I have the API automation framework foundation complete (Phase 1 done, 23 tests passing).

Now I need help creating the Express API endpoints:
- POST /subscriptions (create subscription)
- GET /subscriptions/:id (get subscription)
- POST /subscriptions/:id/cancel (cancel subscription)
- POST /webhooks/payment-provider (webhook handler with HMAC signature validation)

The design patterns are already implemented:
- State Pattern in src/domain/subscription/states/
- Repository Pattern in src/infrastructure/persistence/
- Strategy Pattern (MockPaymentProvider) ready to inject

Please help me create:
1. src/api/app.ts (Express app)
2. src/api/subscriptionRoutes.ts
3. src/api/webhookRoutes.ts
4. src/domain/subscription/SubscriptionService.ts (business logic)

Project location: c:\Projects\Assignment\sdet-assignments
```

---

### **Option C: Just Write Integration Tests** (If API Already Exists)

```
I need help writing integration tests for the subscription billing API.

The Express API endpoints exist:
- POST /subscriptions
- GET /subscriptions/:id
- POST /subscriptions/:id/cancel
- POST /webhooks/payment-provider

Test framework already set up:
- Builders (SubscriptionBuilder, WebhookPayloadFactory)
- Helpers (DatabaseAssertions)
- Repositories (in-memory)

Please help me write:
1. tests/integration/api/createSubscription.test.ts
2. tests/integration/api/webhookEndpoint.test.ts
3. tests/integration/database/webhookIdempotency.test.ts

Project: c:\Projects\Assignment\sdet-assignments
Reference: PROGRESS_SUMMARY.md for detailed context
```

---

### **Option D: Focus on Documentation & PR** (If Tests Complete)

```
I've completed the implementation and tests for the API automation assignment.

Now I need help with:
1. Writing the PR description using pull_request_template_sdet.md
2. Documenting design pattern choices and justifications
3. Creating AI usage statement
4. Final review checklist

Project: c:\Projects\Assignment\sdet-assignments

Please review PROGRESS_SUMMARY.md and help me create a comprehensive PR description.
```

---

## 📋 What You Have So Far

### ✅ Completed (Phase 1)

| Component | Status | Location |
|-----------|--------|----------|
| State Pattern | ✅ Complete | `src/domain/subscription/states/` |
| Builder Pattern | ✅ Complete | `tests/builders/` |
| Strategy Pattern | ✅ Complete | `src/infrastructure/payment/` |
| Repository Pattern | ✅ Complete | `src/infrastructure/persistence/` |
| Factory Pattern | ✅ Complete | `tests/builders/WebhookPayloadFactory.ts` |
| Unit Tests | ✅ 23 passing | `tests/unit/states/` |
| Documentation | ✅ Complete | `API_AUTOMATION_FRAMEWORK_DESIGN.md` |

### 📋 To Do (Phase 2 & 3)

| Component | Status | Estimated Time |
|-----------|--------|----------------|
| Express API | 🚧 Next | 1 hour |
| SubscriptionService | 🚧 Next | 30 min |
| Webhook Handler | 🚧 Next | 30 min |
| API Contract Tests | 📋 Planned | 1.5 hours |
| Database Tests | 📋 Planned | 1 hour |
| Provider Mock Tests | 📋 Planned | 45 min |
| E2E Flow Tests | 📋 Planned | 1.5 hours |
| PR Documentation | 📋 Final | 30 min |

---

## 🎯 Recommended Approach

### **For New Session - Best Practice**

1. **Start with verification**:
   ```bash
   cd c:/Projects/Assignment/sdet-assignments
   npm test
   ```

2. **Tell Claude**:
   ```
   Continue the API automation assignment from Phase 1. 
   Check PROGRESS_SUMMARY.md for context. 
   I want to build Phase 2 (Express API + integration tests).
   ```

3. **Let Claude guide you** through:
   - Creating Express app
   - Writing first integration test (Red)
   - Implementing endpoint (Blue)
   - Refactoring (Green)
   - Repeat for remaining endpoints and tests

---

## 📂 Key Files to Reference

When Claude asks or you need context:

| File | Purpose | When to Reference |
|------|---------|-------------------|
| `PROGRESS_SUMMARY.md` | Detailed status, next steps | Always start here |
| `API_AUTOMATION_FRAMEWORK_DESIGN.md` | Complete architecture | Design questions |
| `QUICK_START.md` | Quick reference, templates | Copy-paste examples |
| `SDET_ASSIGNMENT.md` | Original requirements | Verify coverage |
| `README.md` | Project overview | Setup/running tests |

---

## 🔥 Fastest Path to Complete

If you have **limited time**, focus on:

1. **Create minimal Express API** (1 hour)
   - Just POST /subscriptions and POST /webhooks
   - Basic validation

2. **Write 10-15 integration tests** (2 hours)
   - API contract tests (5 tests)
   - Webhook idempotency (3 tests)
   - Database validation (3 tests)
   - Mock provider verification (3 tests)

3. **Write PR description** (30 min)
   - Explain design patterns
   - Show test coverage
   - Document approach

**Total**: 3.5 hours (within assignment limit)

---

## 💡 Tips for Success

1. **Always verify tests pass** before asking Claude for help:
   ```bash
   npm test
   ```

2. **Reference existing code** - You have great examples in:
   - `tests/unit/states/SubscriptionState.test.ts` (test structure)
   - `src/domain/subscription/states/` (clean code patterns)
   - `tests/builders/` (builder pattern examples)

3. **Use Red-Blue-Green**:
   - Write failing test first (Red)
   - Minimum code to pass (Blue)
   - Refactor (Green)

4. **Don't rebuild** what exists:
   - Use SubscriptionBuilder for test data
   - Use WebhookPayloadFactory for webhooks
   - Use DatabaseAssertions for verification

---

## 🆘 If Things Break

### Tests fail after reopening project?

```bash
# Reinstall dependencies
npm install

# Run tests
npm test
```

### Claude doesn't remember context?

Say:
```
Check your memory for "api-automation-progress-phase1"
Read PROGRESS_SUMMARY.md in c:\Projects\Assignment\sdet-assignments
```

### Need to start over?

Don't! You have 23 passing tests. Just say:
```
Verify my current test status and help me continue from where I left off.
Project: c:\Projects\Assignment\sdet-assignments
```

---

## ✅ Verification Commands

Before telling Claude you're done, run these:

```bash
# All tests pass
npm test

# Check coverage (optional)
npm run test:coverage

# List all test files
ls tests/**/*.test.ts

# Count passing tests
npm test | grep "Tests:"
```

---

**Ready to resume?** Pick Option A above and paste it to Claude in your new session! 🚀
