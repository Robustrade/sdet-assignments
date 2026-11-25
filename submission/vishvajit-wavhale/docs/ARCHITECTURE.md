
# Framework Architecture

## 1. Architecture Overview

The project follows a layered architecture.

The application under test and the automation framework are separated.

## 2. Application Layers

### API Layer
Handles HTTP requests, responses and input validation.

### Service Layer
Contains subscription and webhook business operations.

### Domain Layer
Contains subscription entities, plans, payment models and lifecycle rules.

### Repository Layer
Handles database persistence and retrieval.

### Provider Layer
Defines the external payment provider contract.

## 3. Automation Framework Layers

### Test Scenarios
Describe business behavior and expected outcomes.

### API Client
Encapsulates HTTP requests using Supertest.

### Builders
Construct reusable test data.

### Fixtures
Initialize the application, database and payment provider.

### Assertions
Validate API responses, persisted state and provider interactions.

### Helpers
Provide webhook signing and common utilities.

## 4. Dependency Flow

Test Scenarios
    |
    v
API Client
    |
    v
Express API
    |
    v
Service Layer
    |
    +------> Repository Layer ------> SQLite
    |
    +------> Payment Provider Interface
                  |
                  v
              Mock Provider

Database verification is performed separately through repositories.

## 5. Design Principles

- Single Responsibility Principle
- Encapsulation
- Dependency Injection
- Interface-based design
- Reusability
- Separation of concerns
- Test isolation
