# 🧪 QA TEST SCENARIOS - JOURNALFINANCE
**Version**: 1.0 (Post-Audit 2.4.0)  
**Target**: Production API & Logic  
**Tools**: Automated Script (`tests/qa_comprehensive.test.mjs`)

---

## 🟢 SCENARIO 1: AUTHENTICATION FLOWS

### 1.1 User Registration
- **Input**: Valid email, username, password (strong).
- **Expectation**: HTTP 200, Success payload, `userId` returned.
- **Validation**:
    - Invalid email format → HTTP 400
    - Weak password (<8 chars) → HTTP 400
    - Username taken → HTTP 400 (if implemented, or duplicate email)

### 1.2 User Login (Security Check)
- **Input**: Registered email + password.
- **Expectation**: HTTP 200.
    - `accessToken` (1h expiry)
    - `refreshToken` (7d expiry)
    - `user` object
- **Validation**:
    - Wrong password → HTTP 401
    - Rate limiting → Block after 100 attempts

### 1.3 Token Refresh (New Feature)
- **Input**: Valid `refreshToken` to `/api/auth/refresh`.
- **Expectation**: HTTP 200, New `accessToken` returned.
- **Validation**:
    - Invalid/Expired refresh token → HTTP 403/401
    - Old refresh token (after logout all) → HTTP 401

### 1.4 Logout All Devices
- **Action**: Call `/api/auth/logout-all` with valid token.
- **Expectation**: HTTP 200, `token_version` incremented in DB.
- **Validation**:
    - Old access token usage → HTTP 401
    - Old refresh token usage → HTTP 401

---

## 🟢 SCENARIO 2: CORE ENTRIES (CRUD)

### 2.1 Create Entry (Input Validation)
- **Input**: Full payload (Title, Amount, Type, Date, etc.).
- **Boundary Tests**:
    - Max Title (201 chars) → HTTP 400
    - Max Amount (1e13) → HTTP 400
    - Invalid Type ("random") → HTTP 400
    - Future Timestamp (>24h) → Auto-corrected handled
- **Expectation**: HTTP 200, Entry saved.

### 2.2 Read Entries
- **Action**: GET `/api/entries`.
- **Expectation**: HTTP 200, List of entries (no `image_data`).
- **Validation**: Ensure data integrity (amounts, dates match).

### 2.3 Read Image (Lazy Load)
- **Action**: GET `/api/entries/:id/image`.
- **Expectation**: HTTP 200, Base64 image returned.

### 2.4 Update Entry
- **Action**: POST `/api/entries` with existing ID.
- **Expectation**: HTTP 200, data updated.

### 2.5 Delete Entry
- **Action**: DELETE `/api/entries/:id`.
- **Expectation**: HTTP 200.
- **Validation**: Subsequent GET returns 404 or empty list.

---

## 🟢 SCENARIO 3: SECURITY & LIMITS

### 3.1 Rate Limiting (DoS Protection)
- **Action**: Spam 105 requests in < 1 minute.
- **Expectation**:
    - Req 1-100: HTTP 200/400
    - Req 101+: HTTP 429 Too Many Requests

### 3.2 CORS Check
- **Action**: Send request with `Origin: https://evil.com`.
- **Expectation**: Response header `Access-Control-Allow-Origin` should NOT match evil.com (or default to allow if strict mode not set, but our code whitelists specific domains).

---

## 🟢 SCENARIO 4: DATA SYNC (OFFLINE SUPPORT)

### 4.1 Bulk Sync
- **Input**: Array of 50+ entries to `/api/data/sync`.
- **Expectation**: HTTP 200, all processed.
- **Validation**: Check DB count matches.

---

## ✅ EXECUTION STRATEGY

Run the comprehensive automation suite:
```bash
node tests/qa_comprehensive.test.mjs
```
