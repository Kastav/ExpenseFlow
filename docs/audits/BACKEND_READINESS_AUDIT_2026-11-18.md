# ExpenseFlow Backend Readiness Audit

**Branch:** feat/firestore-cloud-sync  
**Reviewed:** 2026-11-18  
**Scope:** Firebase Admin, Firestore entitlement persistence, Google Play verification, AI Coach authorization, and Cloud Sync readiness.

## Confirmed safeguards

- `src/utils/stageAvailability.ts` sets `cloudSyncEnabled: false` in the default state and in the resolved runtime state.
- `firestore.rules` uses a global default-deny rule. Billing, RTDN, and AI quota collections are explicitly backend-only.
- `src/server/firebaseAdmin.ts` verifies Firebase ID tokens with revocation checking and fails closed when Admin credentials are absent.
- Production entitlement-store selection requires `ENTITLEMENT_STORE_BACKEND=firestore`; production does not silently fall back to the local JSON store.
- The AI Coach route verifies Firebase identity when Admin auth is configured, validates the signed entitlement against durable purchase storage and caller UID, and applies durable per-token quotas.
- The purchase verification route authenticates the Firebase caller before processing a purchase token.

## Important limits / unresolved release gates

1. `src/utils/phase2AuthFirestore.test.ts` explicitly uses mock Auth and an in-memory Firestore driver. It does not prove connectivity, rules behavior, transaction behavior, or purchase lifecycle behavior against the live Firebase project or Google Play.
2. `getEntitlementStoreStatus()` reports Firestore ready based on configuration flags and Admin credential presence. It does not perform a live Firestore read/write health probe. A successful `/api/billing/status` response therefore must not be treated as proof that production persistence is operational.
3. No Cloud Sync endpoints, client sync queue, merge protocol, conflict resolution, or restore workflow were found in `server.ts` or the reviewed availability module. Cloud Sync is not implemented merely because Firestore exists.
4. RTDN configuration is separate from purchase verification. Its OIDC audience, service-account identity, Pub/Sub subscription, replay handling, and lifecycle updates still require a real deployment test.
5. No production backend URL or live production deployment was verified in this review.

## Release decision

- Do not enable Cloud Sync or expose it as a working feature.
- Do not weaken Firestore rules or write client financial records directly to Firestore as a shortcut.
- Do not claim Phase 2 is production-ready based on mock tests.
- Keep local financial storage untouched and retain Firebase Spark until the user explicitly approves any billing relationship or paid deployment.

## Next technical work

1. Add a real Firestore connectivity/readiness probe that performs a bounded, non-sensitive server-side operation and reports failure accurately.
2. Add emulator-backed rules tests for user isolation before any client-owned data collection is introduced.
3. Design Cloud Sync schema, idempotency, versioning, conflict handling, and recovery before implementing writes.
4. Run real Google Play purchase lifecycle and RTDN tests in an internal track with a deployed trusted backend.
5. Obtain explicit cost approval before linking billing or deploying Cloud Run/other billable services.
