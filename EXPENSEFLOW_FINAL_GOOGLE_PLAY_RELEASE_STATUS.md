# EXPENSEFLOW — STAGE 1 GOOGLE PLAY RELEASE READINESS STATUS

**Application:** ExpenseFlow (`com.expenseflow.app`)  
**Firebase Project:** `expenseflow-ad899`  
**Target SDK:** 36 | **Min SDK:** 24 | **Version:** `1.0` (`versionCode` 1)  
**Stack:** React 19 + TypeScript + Vite 8 + Tailwind CSS v4 + Capacitor 8 + Express + Firebase Auth/Analytics

---

## 1. Stage 1 Scope & Truthful Verification Matrix

> **Stage 1 Objective:** Offline-first free core release for Google Play **Internal Testing** with **$0 paid cloud infrastructure** (no GCP billing, no Firestore database, no Cloud Run deployment).  
> **Classification Rules:** `VERIFIED` = observed & executed in this workspace. `NOT CONFIGURED` = owner setup required (Play Console, GitHub Secrets/Pages). `NOT TESTED` = requires Android SDK/JDK build or physical Android device.

| Domain | Classification | Stage 1 State & Workspace Evidence |
| :--- | :--- | :--- |
| **App Identity & Canonical Storage** | **VERIFIED** | App name `ExpenseFlow`, package `com.expenseflow.app`, and all 6 canonical localStorage keys (`expenseflow_transactions_v1`, `expenseflow_budget_v1`, `expenseflow_plan_v1`, `expenseflow_currency_v1`, `expenseflow_country_v1`, `expenseflow_challenges_v1`) preserved with zero loss. |
| **Core Offline Tracking, Planner, Insights & CSV** | **VERIFIED** | Dashboard, inline add/edit/delete, monthly budget burn rate, purchase planner, challenges, CSV export, country/currency picker, voice entry, and mobile responsive UI (`320px`–`412px`) verified. |
| **Stage 1 Gating for Billing / AI Coach / Cloud Sync** | **VERIFIED** | `stageAvailability.ts` fails closed when `VITE_API_BASE_URL` is unset (Android) or backend billing/persistence is inactive. `PremiumUpgradeModal`, `AiSpendingCoachModal`, `InsightsView`, `PurchasePlanner`, and `MoreView` disable active purchases/AI calls and clearly mark them **Stage 2 · Coming Later**. |
| **Firebase Auth & In-App Account Deletion** | **VERIFIED (Client + Mock Auth)** | Real Firebase Web Auth (`expenseflow-ad899`), inline `auth/requires-recent-login` password re-authentication (`reauthenticateWithCredential`), explicit unchecked opt-in checkbox to optionally erase local data, and prominent access via `More` -> `ExpenseFlow Account`. |
| **Standalone External Deletion & Privacy Policy** | **VERIFIED** | `public/privacy.html`, `public/delete-account.html` (backed directly by Google Identity Toolkit REST for `expenseflow-ad899`), and identical `/docs/` GitHub Pages files tested cleanly via Express + automated tests. No fabricated emails (`support@expenseflow.app`) or temporary preview URLs remain. |
| **Android CI Signing Workflow (`build-android.yml`)** | **VERIFIED (Workflow Config)** | JDK 21, `bun run lint`, `bun run test`, fail-closed keystore secret validation (`ANDROID_KEYSTORE_*`), `jarsigner -verify`, and Stage 1 support (allows empty `VITE_API_BASE_URL` while blocking `http://` or `localhost` if set). |
| **Local Android `.aab` / `.apk` Gradle Compilation** | **NOT TESTED (Blocked in Container)** | No JDK (`java`/`javac`) or Android SDK (`ANDROID_HOME`) is installed in this sandbox container; Gradle release bundle must be compiled on GitHub Actions (`build-android.yml`) or a local Android Studio/JDK 21 machine. |
| **GitHub Pages, Keystore Secrets & Play Console** | **NOT CONFIGURED** | Owner must enable GitHub Pages (`main` `/docs`), supply real developer support email in Play Console, add keystore secrets to GitHub Actions, and upload the signed `.aab` to Internal Testing (`EXPENSEFLOW_FINAL_GOOGLE_PLAY_OWNER_ACTIONS.md`). |
| **Live Device Play Billing & Stage 2 Backend** | **OUT OF SCOPE FOR STAGE 1** | Cloud Run, Firestore Native DB, Google Play RTDN, and live `$14.99/mo` / `$109.99/yr` Play purchases remain preserved in code for Stage 2 without deploying paid infrastructure now. |

---

## 2. Locked Canonical Constants (Unchanged)

- **Canonical Local Storage Keys:**
  `expenseflow_transactions_v1`, `expenseflow_budget_v1`, `expenseflow_plan_v1`, `expenseflow_currency_v1`, `expenseflow_country_v1`, `expenseflow_challenges_v1`.
- **Stage 2 Planned Billing Product IDs (Preserved in Code, Inactive in Stage 1):**
  - `expenseflow_premium_monthly` / Base Plan `monthly-standard` — `$14.99/month`
  - `expenseflow_premium_annual` / Base Plan `annual-standard` — `$109.99/year`
