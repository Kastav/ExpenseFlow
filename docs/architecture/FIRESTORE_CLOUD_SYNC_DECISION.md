# Firestore Cloud Sync — Architecture Decision

**Status:** Accepted for implementation planning; production rollout deferred  
**Date:** 2026-11-18

## Decision

Cloud Sync remains a Premium-only capability. The production app must continue to work fully offline and retain local-first financial data behavior.

Do not link a Google Cloud Billing account, upgrade Firebase from Spark to Blaze, deploy Cloud Run/Cloud Functions, or enable any paid infrastructure as part of this decision.

## Why

1. A client-side Premium flag is not an authorization boundary. A modified client can bypass it.
2. Secure Premium access requires a trusted server-side entitlement check, based on verified Google Play purchase state.
3. The current Firebase Spark setup supports the existing Auth/Firestore foundation, but the planned Cloud Run backend deployment requires a Cloud Billing account and a Blaze billing relationship.
4. Shipping a cloud-sync toggle that cannot securely authorize, persist, recover, and reconcile data would create data-loss and trust risks.

## Required architecture before launch

- Keep local storage as the source of truth until a successful sync protocol is implemented.
- Authenticate every sync request with a Firebase ID token; verify the token server-side.
- Verify Google Play purchase tokens server-side. Never trust a client-provided Premium boolean or plan name.
- Enforce Premium entitlement on the server for every sync operation.
- Scope every Firestore document and query to the authenticated UID. Never accept a client-supplied UID as authority.
- Use additive, versioned sync records and conflict metadata. Do not overwrite or delete local records during initial migration.
- Make sync operations idempotent and retry-safe; handle offline queues, duplicate submissions, clock skew, and partial failures.
- Keep secrets and Google Play service credentials out of the client and repository.
- Provide account deletion and data export/deletion behavior consistent with the published privacy policy.

## Rollout gates

Cloud Sync must remain disabled until all of the following are true:

1. A trusted backend is deployed under an explicitly approved billing arrangement.
2. Google Play purchase verification and entitlement refresh are tested, including cancellation, expiration, refund/revocation, pending purchase, and restore flows.
3. Firestore Security Rules deny cross-user reads/writes and are tested against authenticated and unauthenticated cases.
4. Sync tests cover first sync, multi-device merge, offline retry, duplicate events, conflict resolution, account switching, and deletion.
5. A tested backup/recovery path exists and no sync failure can silently erase local data.
6. Privacy disclosures and Play Store data-safety declarations accurately describe the shipped behavior.
7. Production monitoring and a kill switch are in place.

## Current operational posture

- Firebase Spark: remain on this plan.
- Firestore: retain Locked mode; do not loosen rules to make an unimplemented client sync appear functional.
- Cloud Sync: disabled and not advertised as an available Premium feature until rollout gates pass.
- Existing local-first expense, budget, and financial calculations: preserve unchanged.
- AI Coach and Play Billing: treat as separate release tracks; do not assume this decision validates their production readiness.

## Next implementation sequence

1. Audit the existing entitlement and server code against the requirements above.
2. Define sync data schema and conflict-resolution semantics without enabling client writes.
3. Implement and test backend authorization and sync endpoints in isolation.
4. Reassess hosting only after the implementation is testable; obtain explicit approval before any billing upgrade or paid deployment.
5. Enable a limited internal test only after all security and recovery gates pass.
