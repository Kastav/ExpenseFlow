# ExpenseFlow — Google Play Store Complete Release Package

This document contains every exact copy, metadata attribute, questionnaire response, and configuration step required to submit and launch **ExpenseFlow** (`com.expenseflow.app`) on the Google Play Store.

---

## 1. App Listing Metadata

### App Name (Title)
```text
ExpenseFlow: Budget & Tracker
```
*(29 / 30 characters maximum)*

### Short Description
```text
Smart personal expense tracking, daily burn rate budgets & AI Spending Coach.
```
*(77 / 80 characters maximum)*

### Full Description
```text
Take control of your personal finances with ExpenseFlow — the modern, private, and fast personal expense tracker designed to help you build healthy spending habits and reach your financial goals.

Whether you want to track daily coffee runs, plan upcoming major purchases, or understand your monthly spending burn rate, ExpenseFlow gives you complete financial clarity with zero unnecessary complexity.

★ 100% PRIVATE & OFFLINE-READY LOCAL STORAGE
Your financial records are stored securely on your device. ExpenseFlow gives you complete ownership of your data with fast local logging and universal CSV export ready for Excel and Google Sheets.

★ DAILY BURNING RATE & BUDGET VELOCITY
Most budget apps only tell you when it's too late. ExpenseFlow's dynamic burn rate calculates your exact Recommended Daily Allowance, adjusting automatically every day so you always know what you can safely spend.

★ EXPENSEFLOW PREMIUM — AI PERSONAL SPENDING COACH
Unlock next-generation financial reasoning powered by Google Gemini 3.8 Flash:
• Conversational spending velocity guidance
• Actionable recommendations to trim discretionary leaks
• Real-time affordability analysis before making major purchases
• Privacy-first data minimization: individual transactions are never shared; only high-level summary metrics are analyzed.

★ QUICK VOICE EXPENSE ENTRY
On the go? Simply tap the microphone and speak naturally (e.g. "Dinner out $45 on credit card"). ExpenseFlow parses amounts, categories, and payment methods instantly.

★ HABIT CHALLENGES & PURCHASE PLANNER
• No-Spend Day tracking and category spending caps.
• Purchase Affordability Planner to test major expenses against your cash buffer before buying.
• Support for 150+ worldwide ISO 4217 currencies and regional formatting.

★ SUBSCRIPTION PRICING
• ExpenseFlow Free: 100% Free Forever with unlimited local expense tracking, monthly budgets, velocity metrics, and CSV export.
• ExpenseFlow Premium Monthly: $14.99 / month
• ExpenseFlow Premium Annual: $109.99 / year (Save 38%)

Manage your subscriptions anytime in your Google Play account settings.
```
*(1,980 / 4,000 characters maximum)*

---

## 2. Store Categorization & Tags

- **Application Type:** App
- **Primary Category:** Finance
- **Tags:** Personal Finance, Budget Tracker, Expense Manager, Money Management, Spending Tracker
- **Store Contact Email:** `support@expenseflow.app`

---

## 3. Data Safety Form Declaration

Complete the Google Play Console **Data Safety** section with these answers:

| Question | Answer | Rationale |
| :--- | :--- | :--- |
| **Does your app collect or share any user data?** | **Yes** | App shares aggregated financial summary metrics with Gemini proxy only when the user opens the optional AI Coach. |
| **Is all user data encrypted in transit?** | **Yes** | All network traffic uses HTTPS (TLS 1.3). |
| **Can users request their data be deleted?** | **Yes** | Transactions are stored locally and can be deleted anytime in app or by clearing device data. |
| **Financial Info: Other financial info** | **Collected (Aggregated Only)** | Month-to-date total spend, budget limit, and category percentages are processed ephemerally for the AI Coach. Not linked to user identity; not shared with brokers. |
| **Audio Files: Voice recordings** | **Not Collected** | Microphone is used locally for speech-to-text dictation only. Audio is never stored or uploaded. |
| **App Performance & Crash Logs** | **Collected** | Firebase Analytics (standard anonymous app open and section view events). |

---

## 4. App Content Declarations

1. **Privacy Policy URL:**
   `https://expenseflow-2984.ai.studio/privacy.html` (or your custom domain)
2. **Ads Declaration:**
   Select: **"No, my app does not contain ads."**
3. **App Access:**
   Select: **"All functionality is available without restrictions."** (All core budgeting features are free; Premium requires subscription).
4. **Target Audience & Content:**
   - Target age: **18 and above**.
   - Not directed to children.
5. **Content Rating (IARC Questionnaire):**
   - Category: Utility / Productivity / Finance.
   - Violence, sexual content, profanity: **None**.
   - Result: **PEGI 3 / ESRB Everyone / General**.
6. **Financial Features Declaration:**
   - App is a **personal budget planner**. It is NOT a money lending service, cryptocurrency exchange, or banking institution.

---

## 5. Google Play Console Subscription Products Setup

Navigate to **Monetize > Products > Subscriptions** in Google Play Console:

### Subscription 1: Monthly
- **Product ID:** `expenseflow_premium_monthly`
- **Name:** ExpenseFlow Premium Monthly
- **Base Plan ID:** `monthly-standard`
- **Billing Period:** 1 Month
- **Renewal:** Auto-renewing
- **Default Price:** $14.99 USD (Play Console automatically calculates localized exchange rates for worldwide territories).

### Subscription 2: Annual
- **Product ID:** `expenseflow_premium_annual`
- **Name:** ExpenseFlow Premium Annual
- **Base Plan ID:** `annual-standard`
- **Billing Period:** 1 Year
- **Renewal:** Auto-renewing
- **Default Price:** $109.99 USD (Play Console automatically calculates localized exchange rates).

---

## 6. Release Track Notes

### Internal / Closed Testing (Track 1)
```text
ExpenseFlow v1.0.0 (Build 1)
• Mobile-first personal expense tracking with light-mode interface.
• Daily spending velocity and recommended allowance calculations.
• Purchase Affordability Planner and Savings Challenges.
• Voice expense dictation.
• AI Personal Spending Coach with Gemini 3.8 Flash.
• Google Play In-App Billing integration.
```

### Production Release (Track 2)
```text
Welcome to ExpenseFlow 1.0!
• Track expenses with zero friction and total local privacy.
• Monitor your daily burning rate and know your exact safe daily allowance.
• Try the AI Personal Spending Coach for smart budget recommendations.
• Universal CSV export for spreadsheets.
```
