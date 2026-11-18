# Premium Cloud Sync — Security & Implementation Plan

Status: backend API foundation implemented on the feature branch; client integration, live Firebase verification, and production deployment are NOT complete.
Branch: feat/firestore-cloud-sync
Base: current branch head at the time this plan was added.

## Product contract

- Cloud Sync is a Premium-only feature.
- Free users remain fully usable in local/offline mode. No sign-in is required for local-only use.
- No Firebase client SDK writes or reads are permitted for financial cloud documents.
- The Express backend is the only component allowed to access cloud-sync documents through Firebase Admin.
- Cloud Sync stays disabled until backend configuration, entitlement verification, and end-to-end tests all pass.
- Do not upgrade Firebase Spark to Blaze, link a billing account, deploy paid infrastructure, or enable paid services without explicit owner approval.

## Existing repository facts

- Firebase project: expenseflow-ad899.
- Android application ID: com.expenseflow.app.
- Firestore rules currently default-deny client access.
- Firebase Admin token verification exists in src/server/firebaseAdmin.ts.
- Google Play purchase verification and durable entitlement storage exist in src/server/playBillingVerification.ts and src/server/entitlementStore.ts.
- Entitlement lookup by Firebase UID is implemented. If the UID index is missing, the store reconciles against legacy `billing_entitlements` records and repairs the UID/token indexes. A fast path avoids repeated repair writes for healthy active subscriptions.
- src/utils/stageAvailability.ts currently hard-disables cloudSyncEnabled. Keep it fail-closed until the backend reports verified readiness.
- Financial records are stored locally by src/utils/storage.ts. Preserve the existing localStorage keys and migration behavior.

## Implemented on the feature branch

- `GET /api/cloud-sync/snapshot` and `PUT /api/cloud-sync/snapshot` are registered in the Express server.
- Every request requires a Firebase ID token; UID is derived only from the verified token.
- Every request checks the current server-side Play entitlement for the same UID and supported monthly/annual product.
- Snapshots are stored at `users/{uid}/cloud_sync/snapshot` through Firebase Admin only.
- PUT requires `baseRevision` and an `idempotencyKey`; stale revisions return HTTP 409 and exact retries are idempotent.
- Snapshot schema is versioned and validates transaction, budget, plan, currency, country, and challenge data. The current snapshot cap is 48 KiB; the Express JSON parser cap remains 64 KiB.
- A Firestore-backed rolling per-UID rate limit allows up to 30 GET/PUT requests per minute.
- Client-supplied UID and Premium headers are ignored. Firestore client rules remain default-deny.
- Automated route tests cover unauthenticated denial, Free-user spoofing denial, UID isolation, valid upload/readback, invalid schema, idempotent retry, revision conflict, and rate limiting.
- Legacy entitlement reconciliation has a regression test proving a missing UID index is repaired from the existing purchase record.

**Not implemented yet:** client-side sync UI/service, first-sync merge/restore flow, live Firebase/Play verification, deployment, and enabling `cloudSyncEnabled`. Local storage remains the source of truth and Cloud Sync remains disabled.

## Required server design

1. Authenticate every sync request with a Firebase ID token in the Authorization: Bearer header. Verify signature, project, and revocation with Firebase Admin. Derive UID only from the verified token; never accept a client-supplied UID as authority.
2. Add an entitlement-store method that resolves the caller's current active Premium subscription from durable server-side purchase records. Require matching userId, ownershipStatus=bound, supported product ID, active status, not revoked, and expiryTimeMillis > server time. Treat missing/unavailable entitlement storage as denial.
3. Do not trust client plan flags, X-ExpenseFlow-Entitlement-Tier, locally cached purchase state, or a client-supplied expiry timestamp.
4. Add versioned sync API endpoints (for example GET/PUT /api/cloud-sync/snapshot) protected by both Firebase authentication and the server-side Premium entitlement check.
5. Validate payload schema and size server-side. Store documents under a UID-scoped path, such as users/{uid}/cloud_sync/{snapshotId}; derive the UID from the verified token. Never permit cross-user document paths.
6. Use server timestamps, schemaVersion, revision/ETag, and idempotency metadata. Reject stale writes with a conflict response; do not silently replace newer remote data.
7. Keep financial deletion semantics explicit. A normal snapshot upload must not imply deletion. If record-level tombstones are introduced, they must be explicit, validated, versioned, and recoverable.
8. Firestore client rules remain default-deny. Backend Admin SDK bypasses rules and must enforce all authorization itself.
9. Add rate/size limits and avoid logging financial payloads, tokens, or sensitive notes.

## Client and migration behavior

- Keep local storage as the source of truth until the user explicitly enables sync and a verified initial migration completes.
- First sync must compare local and remote revisions and present a safe merge/restore path; never silently choose one side or clear local data.
- Preserve all existing storage keys, currencies, transaction IDs, timestamps, budget, plan, and challenge data.
- Handle offline state, expired subscription, sign-out, account switching, and backend errors without blocking local app use.
- On downgrade/expiry, stop cloud operations but retain local data. Do not delete cloud data automatically.
- Do not cache a Premium entitlement as permanent authorization. Re-check server authorization for every sync operation (or use a short, explicitly bounded server-side cache if later justified).

## Required tests before enabling

- Missing/invalid/revoked Firebase ID token is denied.
- User A cannot read/write User B data, including manipulated IDs and paths.
- Free, expired, canceled-inactive, paused, on-hold, revoked, unbound, missing, or mismatched entitlement is denied.
- Active monthly and annual Premium subscriptions for the same UID are allowed.
- Client-supplied plan tier, UID, product ID, and expiry cannot grant access.
- Entitlement-store outage fails closed.
- Oversized/malformed payloads and rate-limit violations are rejected.
- Concurrent writes and stale revisions produce deterministic conflict handling.
- Initial migration preserves local records on every failure path; duplicate retries are idempotent.
- Sign-out/account switch cannot leak data between users.
- Firestore rules emulator tests prove all direct client access remains denied.
- Existing storage, billing, AI coach, and release-readiness suites remain green.

## Release gate

Cloud Sync may only be enabled when the authenticated Premium entitlement lookup, API routes, migration/conflict logic, security tests, and production backend are verified together. The current Spark-only project can be used for development within its available quotas, but production hosting for this existing Express backend must be separately evaluated. Any billing-plan change or potentially billable deployment requires explicit approval first.
