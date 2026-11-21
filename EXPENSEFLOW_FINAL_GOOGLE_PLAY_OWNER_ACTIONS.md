# EXPENSEFLOW — STAGE 1 & STAGE 2 GOOGLE PLAY OWNER ACTIONS

**Application:** ExpenseFlow (`com.expenseflow.app`)  
**Firebase Project:** `expenseflow-ad899`  
**Target Platform:** Google Play Store (Android — Stage 1 Offline-First Core)  
**Owner / Tester Account:** `kastavrathor269@gmail.com`  
**Stage 1 Infrastructure Cost:** ₹0 / Free (No Cloud Run, No Firestore DB, No GCP Billing Activation Needed)

---

## Stage 1 — Zero-Cost Internal Testing Release Checklist (~15 mins total)

Follow these steps **without** creating Firestore, Cloud Run, or enabling Cloud Billing.

### Step 1 — Publish Permanent Public Privacy Policy & Account Deletion Pages on GitHub Pages (~3 mins)

1. Commit and push the repository (including the ready-to-serve `/docs` folder containing `index.html`, `privacy.html`, `delete-account.html`, and `.nojekyll`) to GitHub (`main` branch).
2. On GitHub, open **Settings > Pages**:
   - **Source:** `Deploy from a branch`
   - **Branch:** `main` -> Folder: **`/docs`** -> **Save**
3. Wait ~60 seconds for GitHub Pages to publish:
   - **Privacy Policy URL:** `https://<your-github-username>.github.io/<your-repo-name>/privacy.html`
   - **Account Deletion URL:** `https://<your-github-username>.github.io/<your-repo-name>/delete-account.html`
4. Verify in Firebase Console (**Authentication > Settings > Authorized domains**) that `<your-github-username>.github.io` is listed if needed (the external `delete-account.html` page uses Firebase Identity Toolkit REST directly for `expenseflow-ad899`, so also test once with a disposable test email).
   - *Important:* Never submit temporary `ais-dev-*.run.app` or `ais-pre-*.run.app` URLs to Google Play Console.

### Step 2 — Generate Android Upload Keystore & Build Signed Stage 1 AAB (~8 mins)

1. Generate your upload keystore locally (never commit `*.keystore` or `*.jks` to Git):
   ```bash
   keytool -genkeypair -v \
     -keystore expenseflow-release.keystore \
     -alias expenseflow_release_key \
     -keyalg RSA \
     -keysize 2048 \
     -validity 10000 \
     -storetype PKCS12
   ```
2. Base64-encode `expenseflow-release.keystore` cleanly (one line, no line breaks):
   - macOS: `base64 -i expenseflow-release.keystore | pbcopy`
   - Linux: `base64 -w 0 expenseflow-release.keystore`
   - Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("expenseflow-release.keystore")) | Set-Clipboard`
3. In GitHub repo **Settings > Secrets and variables > Actions**:
   - **Do NOT set `VITE_API_BASE_URL` for Stage 1** — leaving it unset builds the offline-first Stage 1 AAB where Premium Billing, AI Coach, and Cloud Sync are cleanly marked **Stage 2 · Coming Later / Unavailable** with zero dead API errors.
   - Add **Repository Secrets**:
     - `ANDROID_KEYSTORE_BASE64`
     - `ANDROID_KEYSTORE_PASSWORD`
     - `ANDROID_KEY_ALIAS` = `expenseflow_release_key`
     - `ANDROID_KEY_PASSWORD` (same password as `ANDROID_KEYSTORE_PASSWORD` for PKCS12)
4. Run **Actions > Build ExpenseFlow Android App Bundle (AAB)** (`build_mode: release-aab`).
5. Download the signed & `jarsigner`-verified `expenseflow-signed-release.aab` artifact (`expenseflow-android-bundle`).

### Step 3 — Upload to Google Play Internal Testing & Fill Stage 1 Store Declarations (~5 mins)

1. Open [Google Play Console](https://play.google.com/console) -> **ExpenseFlow** (`com.expenseflow.app`).
2. **Store Settings / Listing Contact Email:** Enter your own real monitored support email (no placeholder addresses exist in code).
3. **Policy and programs > App content** (copy Stage 1 declarations from `PLAY_STORE_RELEASE_PACKAGE.md`):
   - **Privacy Policy URL:** `https://<your-github-username>.github.io/<your-repo-name>/privacy.html`
   - **Account Deletion URL:** `https://<your-github-username>.github.io/<your-repo-name>/delete-account.html`
   - **Ads:** No
   - **Data Safety:** Stage 1 answers (Local financial records on device; optional Firebase Auth Email/UID; optional Firebase Analytics toggle; zero financial ledger/Play tokens uploaded).
   - **Target Audience:** `18+` Finance planner utility.
4. **Testing > Internal testing > Create new release:**
   - Upload `expenseflow-signed-release.aab` (`1.0 (1)`).
   - Add `kastavrathor269@gmail.com` to Testers, roll out to Internal testing, and install from Play Store opt-in URL on an Android device.

---

## Stage 2 — Future Paid Cloud & Monetization Expansion (Do Not Execute for Stage 1)

Execute only when you are ready to launch paid subscriptions (`$14.99/mo`, `$109.99/yr`), Gemini AI Spending Coach, and Google Play RTDN verification:

1. Enable GCP billing as required, verify any existing GCP/App Engine default resource location in `expenseflow-ad899`, create Cloud Firestore (**Standard Native mode**, `us-central1`), and deploy `firestore.rules`.
2. Deploy `Dockerfile` to Cloud Run (`ENTITLEMENT_STORE_BACKEND=firestore`, `USE_GCP_ADC=true`, Secret Manager bindings for `GEMINI_API_KEY`, `PLAY_BILLING_SIGNING_SECRET`, `GOOGLE_PLAY_SERVICE_ACCOUNT_KEY`).
3. Configure Google Play Console Subscriptions (`expenseflow_premium_monthly` / `expenseflow_premium_annual`), Pub/Sub RTDN topic (`play-billing-rtdn`), and set GitHub Variable `VITE_API_BASE_URL` to your Cloud Run HTTPS URL before rebuilding the Stage 2 release AAB.
4. Update Play Console Data Safety & Privacy Policy disclosures before launching Stage 2.
