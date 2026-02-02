
# JournalFinance Testing Suite

This directory contains automated testing scripts for the JournalFinance project.

## Scripts

### 1. `test` (Backend Unit/Integration Tests)
Runs unit and integration tests for the Cloudflare Worker backend logic using a simulated environment (Mock D1 binding, Requests, etc.).

**Command:**
```bash
npm test
# OR
node tests/worker.test.mjs
```

**Coverage:**
- Auth (Register, Login, Rate Limiting)
- Data (CRUD Operations, Security Checks)
- API Endpoint Logic

### 2. `test:frontend` (Frontend Validation)
Validates the existence of critical frontend files and checks for syntax errors in JavaScript files.

**Command:**
```bash
npm run test:frontend
# OR
node tests/validate_frontend.js
```

### 3. `test:syntax` (Legacy Syntax Check)
Quick check of main backend and frontend files.

**Command:**
```bash
npm run test:syntax
```

## Adding New Tests

- **Backend**: Add new test cases to `tests/worker.test.mjs`. Use the `test()` helper function.
- **Frontend**: API logic uses `fetch`. If you need to test UI interactions, consider adding Cypress or Playwright (requires separate setup).

## Notes
- `worker.test.mjs` uses a Mock D1 Database class to simulate SQL operations in memory. It does not connect to the real D1 database.
