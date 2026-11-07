# EXPENSEFLOW — FINAL GOOGLE PLAY OWNER ACTIONS

**Document Version:** 1.0 (Release Execution)  
**Application:** ExpenseFlow (`com.expenseflow.app`)  
**Target Platform:** Google Play Store (Android)  
**Developer/Tester Account:** `kastavrathor269@gmail.com`  
**Financial Cost:** ₹0 (Zero Paid Services Required)

---

## 1. Zero-Leak Security Rule
- **NEVER** share private keystores (`.keystore` or `.jks`), keystore passwords, or Google Service Account JSON files in public forums, Git commits, or chat sessions.
- Credentials must be entered directly into your private GitHub repository secrets and Google Play Console.

---

## 2. Generate Release Keystore (5 Minutes)
A release keystore is cryptographically unique to you and signs the binary uploaded to Google Play.

### Option A: Via Command Line (macOS / Linux / Windows PowerShell with JDK installed)
Run the following single command in your terminal:

```bash
keytool -genkeypair -v \
  -keystore expenseflow-release.keystore \
  -alias expenseflow_release_key \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -storetype JKS
```

1. Enter a secure password (e.g. 20+ characters) when prompted for `keystore password`.
2. Fill in your name/organization details.
3. Type `yes` to confirm.
4. **Save the password in your personal password manager.**
5. Store `expenseflow-release.keystore` in a safe, backed-up location.

### Option B: Via Android Studio (GUI)
1. Open the `/android` folder in Android Studio.
2. Navigate to **Build > Generate Signed Bundle / APK**.
3. Select **Android App Bundle** and click **Next**.
4. Under **Key store path**, click **Create new...**.
5. Save as `expenseflow-release.keystore`, set alias to `expenseflow_release_key`, enter passwords, and click **OK**.

---

## 3. Configure GitHub Secrets for Automated AAB Signing (3 Minutes)
This allows your GitHub Actions workflow to build and sign `expenseflow-signed-release.aab` automatically on every release.

### Step 1: Convert Keystore to Base64
Run this command in the folder containing `expenseflow-release.keystore`:

- **On macOS:**
  ```bash
  base64 -i expenseflow-release.keystore | pbcopy
  ```
  *(The base64 text is now in your clipboard).*
- **On Linux:**
  ```bash
  base64 -w 0 expenseflow-release.keystore
  ```
- **On Windows (PowerShell):**
  ```powershell
  [Convert]::ToBase64String([IO.File]::ReadAllBytes("expenseflow-release.keystore")) | Set-Clipboard
  ```

### Step 2: Add Secrets to GitHub
1. Open your GitHub Repository in your browser (mobile or desktop).
2. Go to **Settings > Secrets and variables > Actions**.
3. Click **New repository secret** and add the following 4 secrets:

| Secret Name | Value | Description |
| :--- | :--- | :--- |
| `ANDROID_KEYSTORE_BASE64` | *(Paste the Base64 string)* | The encoded keystore binary |
| `ANDROID_KEYSTORE_PASSWORD` | *(Your Keystore Password)* | Password chosen in step 2 |
| `ANDROID_KEY_ALIAS` | `expenseflow_release_key` | Key alias name |
| `ANDROID_KEY_PASSWORD` | *(Your Key Password)* | Password chosen in step 2 |

### Step 3: Trigger the Build Workflow
1. Go to **Actions** tab in GitHub.
2. Select **Build ExpenseFlow Android App Bundle (AAB)**.
3. Click **Run workflow** > **Run workflow**.
4. Once completed (approx. 3-4 minutes), click on the run and download the artifact: `expenseflow-signed-release.aab`.

---

## 4. Google Play Console: Create Subscription Products (5 Minutes)
Google Play requires subscription products to exist before testers can purchase them.

1. Log in to [Google Play Console](https://play.google.com/console).
2. Select **ExpenseFlow** (`com.expenseflow.app`).
3. In the left navigation menu, scroll to **Monetize > Products > Subscriptions**.

### Product 1: Monthly Subscription
- Click **Create subscription**.
- **Product ID:** `expenseflow_premium_monthly`
- **Name:** `ExpenseFlow Premium (Monthly)`
- Under **Base plans**, click **Add base plan**:
  - **Base plan ID:** `monthly-standard`
  - **Type:** Auto-renewing
  - **Billing period:** `1 month`
  - **Price:** Set default to `$14.99 USD` (Play Console will automatically compute localized prices for all worldwide currencies).
- Click **Save** and **Activate**.

### Product 2: Annual Subscription
- Click **Create subscription**.
- **Product ID:** `expenseflow_premium_annual`
- **Name:** `ExpenseFlow Premium (Annual)`
- Under **Base plans**, click **Add base plan**:
  - **Base plan ID:** `annual-standard`
  - **Type:** Auto-renewing
  - **Billing period:** `1 year`
  - **Price:** Set default to `$109.99 USD` (reflects 38% annual savings).
- Click **Save** and **Activate**.

---

## 5. Google Play Console: Setup Internal & Closed Testing (5 Minutes)

1. Navigate to **Testing > Internal testing**.
2. Click **Create new release**.
3. Upload `expenseflow-signed-release.aab`.
4. Enter Release Name: `1.0.0 (1)`.
5. Enter Release Notes:
   ```text
   ExpenseFlow 1.0.0 Initial Release
   - Private, offline-ready local expense tracking
   - Daily spending burn rate & recommended daily allowance pacing
   - AI Personal Spending Coach powered by Gemini 3.8 Flash
   - Google Play In-App Subscriptions
   ```
6. Click **Next** > **Save and publish to internal testing**.
7. Go to **Testers** tab under Internal testing:
   - Create an email list named `Core Testers`.
   - Add your email: `kastavrathor269@gmail.com`.
   - Copy the **Join on Android** invitation link to your mobile device to test purchases using Google Play license testing (free test cards).

---

## 6. Google Play Console: App Content & Declarations (5 Minutes)
Navigate to **Policy and programs > App content** in Google Play Console:

1. **Privacy Policy:**
   - URL: `https://ais-dev-chgt5vqou74rnkh2rdkedk-975734991727.asia-southeast1.run.app/privacy.html` (or your verified domain).
2. **Ads:**
   - Select: `No, my app does not contain ads`.
3. **App Access:**
   - Select: `All functionality is available without restrictions`.
4. **Target Audience:**
   - Target age: `18 and above`. Not directed to children.
5. **Content Rating (IARC Questionnaire):**
   - Category: Utility / Productivity / Finance.
   - Result: PEGI 3 / ESRB Everyone / General.
6. **Data Safety Form:**
   - Financial Info (Other Financial Info): `Collected (Aggregated Only)` for AI Coach; not linked to personal identity.
   - Audio: `Not collected` (microphone dictation is transcribed locally on-device and never stored or uploaded).
   - Data Encryption: `Encrypted in transit (HTTPS/TLS)`.
   - Deletion Request: Users can delete data anytime directly inside the app or via device settings.
