# ExpenseFlow — Google Play Store Stage 1 Release Package

Exact Stage 1 store listing copy, Data Safety declarations, App Content responses, and GitHub Pages compliance URLs for **ExpenseFlow** (`com.expenseflow.app`).

---

## 1. Stage 1 App Listing Metadata (Offline-First Free Core)

### App Name (Title)
```text
ExpenseFlow: Budget & Tracker
```
*(29 / 30 characters)*

### Short Description
```text
Fast, private offline expense tracker with daily burn rate & purchase planner.
```
*(77 / 80 characters)*

### Full Description
```text
Take control of your personal finances with ExpenseFlow — the modern, private, offline-first expense tracker built to help you manage everyday spending without complexity.

★ 100% PRIVATE & OFFLINE-FIRST LOCAL STORAGE
Your expense records, monthly budgets, purchase plans, challenges, and regional preferences stay locally on your device. No account is required to track expenses, and ExpenseFlow gives you instant universal CSV exports ready for Excel and Google Sheets.

★ DAILY BURN RATE & BUDGET VELOCITY
Most budget tools only tell you after you overspend. ExpenseFlow computes your real-time Recommended Daily Allowance and spending velocity automatically so you always know what you can safely spend today.

★ PURCHASE AFFORDABILITY PLANNER & CHALLENGES
• Test major purchases against upcoming bills and buffers before buying.
• Track No-Spend Day goals and category spending caps.
• Supports 150+ worldwide ISO 4217 currencies and country formatting.

★ QUICK VOICE EXPENSE ENTRY
Tap the microphone button and speak naturally (e.g., "Dinner out 45 on card") to pre-fill amount, category, and payment method via on-device/WebView speech recognition.

★ OPTIONAL ACCOUNT & FULL DATA CONTROL
• Use ExpenseFlow completely offline with zero account required.
• Optional Firebase Email/Password sign-in with permanent in-app deletion (More > ExpenseFlow Account > Manage / Delete) and external web deletion.
```

---

## 2. Store Categorization & Developer Contact

- **Application Type:** App
- **Primary Category:** Finance
- **Tags:** Personal Finance, Budget Tracker, Expense Manager, Money Management, Spending Tracker
- **Store Contact Email:** Enter your own real, monitored developer contact email in Google Play Console (**Store settings**). *(No fabricated email address is hardcoded in the app.)*

---

## 3. Stage 1 Data Safety Form Declaration (Aligned Strictly to Active Stage 1 Code)

> Fill these answers for Stage 1 Internal Testing. Update Data Safety before activating Stage 2 Cloud Sync / AI Coach / Play Billing.

| Play Console Data Safety Field | Stage 1 Selection | Source-Verified Code Basis |
| :--- | :--- | :--- |
| **Does your app collect or share user data?** | **Yes** *(Optional Account Email/UID & Optional Usage Analytics)* | Firebase Authentication (`expenseflow-ad899`) if user creates an optional account, plus opt-out Firebase Analytics (`src/services/analytics.ts`). |
| **Is all collected user data encrypted in transit?** | **Yes** | Firebase Authentication and Firebase Analytics SDKs communicate exclusively over HTTPS / TLS. |
| **Do you provide a way for users to request that their data is deleted?** | **Yes** | In-app account deletion (`More > ExpenseFlow Account > Manage / Delete > Delete ExpenseFlow Account` with inline re-auth & optional local wipe) AND standalone web deletion page (`delete-account.html`). |
| **Personal Info: Email address & User IDs** | **Collected (Optional — App Functionality / Account Management)** | Collected by Firebase Authentication only when the user voluntarily registers or signs in. Never sold or used for advertising. |
| **Financial Info (Expenses, Budgets, Purchase History)** | **Not Collected off-device in Stage 1** | Stored strictly locally in device storage (`localStorage`); Stage 1 billing/AI Coach/cloud sync are disabled and no Firestore database exists. |
| **App Activity / Analytics** | **Optional (User Opt-out Toggle Provided)** | `analytics.ts` logs strictly non-financial allowlisted event names (`page_view`, `app_open`, `expense_added`, etc.—never amounts or notes). Toggleable anytime in `More > Data Storage & Privacy`. |
| **Audio files** | **Not Collected** | `RECORD_AUDIO` drives live WebView speech-to-text transcription; audio is never stored on disk or uploaded. |

---

## 4. App Content & Policy Declarations (GitHub Pages Public URLs)

1. **Privacy Policy URL (Permanent HTTPS Host via GitHub Pages `/docs`):**
   - `https://<your-github-username>.github.io/<your-repo-name>/privacy.html`
   - *Never submit temporary `ais-dev-*.run.app` or `ais-pre-*.run.app` preview URLs.*
2. **Account Deletion URL (External Deletion Flow Requirement):**
   - `https://<your-github-username>.github.io/<your-repo-name>/delete-account.html`
   - Independently signs in against Firebase Identity Toolkit (`expenseflow-ad899`) and permanently deletes the Firebase Auth account in any browser.
3. **Ads Declaration:** **No, my app does not contain ads.**
4. **App Access:** Core expense tracking is fully accessible with **zero login**. Optionally provide one test Firebase email/password account credential if Play reviewers wish to verify sign-in and account deletion inside the app.
5. **Target Audience & Content:** **18 and above** (Personal finance management utility; not directed at children).
6. **Content Rating (IARC):** Finance / Utility; Violence, sexual content, profanity: **None**.
7. **Financial Features Declaration:** Personal expense ledger and budgeting calculator only — NOT a bank, lender, payment processor, investment broker, or crypto wallet.

---

## 5. Stage 1 Internal Testing Release Notes (`1.0 (1)`)

```text
ExpenseFlow v1.0 (Build 1 — Stage 1 Offline-First Core)
• Android-first offline expense tracking with local storage preservation
• Dynamic daily burn rate, spending velocity, and Recommended Daily Allowance
• Purchase Affordability Planner and Savings Challenges
• Quick voice expense entry and universal RFC 4180 CSV export
• 150+ worldwide currencies and country formatting
• Optional Firebase account management with in-app and web deletion
• Stage 2 cloud features (AI Coach, Cloud Sync, Play Billing) disabled in Stage 1
```
