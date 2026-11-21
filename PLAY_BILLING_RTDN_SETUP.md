# ExpenseFlow Google Play Billing, Firebase & RTDN Setup (Stage 2 Architecture Reference)

> **Stage 1 Notice:** This document describes **Stage 2** cloud billing & AI backend architecture. In **Stage 1 (Offline-First Internal Testing)**, Google Play purchases, AI Spending Coach, and Cloud Sync are cleanly disabled in the client UI (`src/utils/stageAvailability.ts`), and **no** Firestore database, Cloud Run deployment, or GCP billing activation is required or active yet.

This reference covers the preserved Stage 2 backend environment variables, Firebase services, and Google Cloud Pub/Sub Real-Time Developer Notifications (RTDN) configuration for `com.kastav.expenseflow` (Firebase project `expenseflow-ad899`).

---

## 1. Environment Variables Reference

| Variable | Side | Purpose |
| --- | --- | --- |
| `NODE_ENV` | Server | Set to `production` on Cloud Run (enforces Firestore persistence + strict CORS allowlist without wildcard preview domains). |
| `VITE_API_BASE_URL` | Frontend / Android Build | Permanent public `https://` backend origin compiled into Android Capacitor builds (never `localhost` or `http://`). |
| `PLAY_BILLING_SIGNING_SECRET` | Server | High-entropy HMAC secret (`>= 16` chars) used to sign verified entitlement tokens. |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_KEY` | Server | Service account JSON key with Google Play Android Developer API permissions (`View financial data, orders, and cancellation survey responses` + `Manage orders and subscriptions` granted in Play Console). |
| `GOOGLE_PUBSUB_AUDIENCE` | Server | Exact Cloud Run push endpoint URL (e.g., `https://expenseflow-api-...a.run.app/api/billing/rtdn`). Required to enable RTDN. |
| `GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL` | Server *(Recommended)* | Expected OIDC push invoker service account email verified in RTDN Pub/Sub JWT claims. |
| `ENTITLEMENT_STORE_BACKEND` | Server | Set to `firestore` in production (fails closed `503` otherwise). Use `file` strictly in local dev/tests. |
| `USE_GCP_ADC` | Server | Set to `true` on Cloud Run running inside `expenseflow-ad899` so Firebase Admin / Firestore uses Application Default Credentials cleanly without inline JSON. |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | Server *(Alt to ADC)* | Inline service account JSON for Firebase Admin SDK (`expenseflow-ad899`) if hosting outside GCP Cloud Run. |
| `GEMINI_API_KEY` | Server | Server-only Google Gemini API key powering `gemini-4-hydrogen` AI Spending Coach. |
| `ALLOWED_ORIGINS` | Server | Comma-separated production browser origins allowed for CORS (Android `https://localhost` is always permitted). |

---

## 2. Firebase Collections & Security Rules (`expenseflow-ad899`)

`firestore.rules` enforces default-deny (`allow read, write: if false;`) on all client SDK traffic. Only the Express backend (`firebase-admin`) reads and writes these 4 collections using Cloud Firestore Native mode. The names below match the constants in `src/server/entitlementStore.ts`:

1. `billing_entitlements/{tokenHash}` — Hashed purchase token (`SHA-256`), Firebase UID (`null` while unbound), `obfuscatedAccountId`, subscription status, expiry, `acknowledgementState`, and event timestamps. Raw purchase tokens are **never** stored.
2. `billing_token_index/{tokenId}` — First 16 hex chars of `tokenHash` -> maps short HMAC entitlement `tokenId` back to `tokenHash` & `userId`.
3. `rtdn_notifications/{messageId}` — Lease-based Pub/Sub deduplication (`processing`, `completed`, `failed`).
4. `ai_usage_quotas/{quotaKey}` — Durable per-subscription rate limit (5/min) and monthly cap (100/month).

## 3. Google Cloud Pub/Sub & Play Console RTDN Setup

1. **Create Pub/Sub Topic in `expenseflow-ad899`:**
   - Topic: `projects/expenseflow-ad899/topics/play-billing-rtdn`
   - Grant `roles/pubsub.publisher` on the topic to:
     `google-play-developer-notifications@system.gserviceaccount.com`
2. **Create Authenticated Push Subscription:**
   - Endpoint URL: `https://<your-cloud-run-host>/api/billing/rtdn`
   - Enable **Authentication** using a dedicated push service account (matching `GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL`) and set **Audience** to match `GOOGLE_PUBSUB_AUDIENCE`.
3. **Link Topic in Google Play Console:**
   - Google Play Console -> `ExpenseFlow` (`com.kastav.expenseflow`) -> **Monetize > Monetization setup** -> enter `projects/expenseflow-ad899/topics/play-billing-rtdn`.
   - Click **Send test notification** and inspect Cloud Run logs to confirm `200` OIDC-verified delivery.

---

## 4. End-to-End Play Billing Verification Checklist (Physical Android Device + Play License Tester)

After uploading `expenseflow-signed-release.aab` to **Internal testing**:

| # | Scenario | Expected App & Backend Result | Status |
| --- | --- | --- | --- |
| 1 | Sign in on Android app, upgrade via `expenseflow_premium_monthly` ($14.99/mo) with Google Play test card | Native Billing v7 passes `obfuscatedAccountId`; `POST /api/billing/verify` returns `200`, acknowledges with Play API, unlocks AI Coach (`gemini-4-hydrogen`). | **NOT TESTED (Requires Play Console + device)** |
| 2 | Force-stop & reopen app, then tap **Restore Purchases** on same Firebase UID | `syncSubscriptionOnAppActive` & `restoreSubscriptionPurchases` confirm active entitlement cleanly. | **NOT TESTED (Requires Play Console + device)** |
| 3 | Attempt **Restore Purchases** while signed into a different Firebase UID using same Play account | Server returns HTTP `409` (`ownership_mismatch`); client clears local Premium cache and protects original UID. | **Verified via automated test (`phase2` + `releaseReadiness`)** |
| 4 | Cancel/revoke test subscription from Play Console Order Management | RTDN `SUBSCRIPTION_REVOKED` (`type=12`) revokes entitlement in Firestore; `/api/coach/chat` immediately returns `403` and app reverts to Free on resume. | **Verified via mock RTDN test; live Play RTDN NOT TESTED** |
| 5 | Select `Slow test card, approves after a few minutes` in Play test checkout | App keeps `PENDING` status and does **NOT** unlock Premium until payment settles and RTDN/sync confirms `PURCHASED`. | **Verified via unit test (`billing.test.ts`); live test card NOT TESTED** |
