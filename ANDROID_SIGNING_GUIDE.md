# ExpenseFlow Android Release Signing & Play Store Guide

This document describes how to securely generate your release keystore, configure GitHub Actions secrets for automated AAB signing, and prepare the artifact for the Google Play Console.

---

## 1. Zero-Leak Security Rule

- **NEVER** commit `release.keystore`, `*.jks`, or `keystore.properties` to Git or GitHub.
- Keystore credentials must be stored strictly in **GitHub Repository Secrets** or local offline storage.

---

## 2. Generating Your Android Release Keystore

Run the following command on your local machine (macOS/Linux terminal or Windows PowerShell with JDK installed):

```bash
keytool -genkeypair -v \
  -keystore expenseflow-release.keystore \
  -alias expenseflow_release_key \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -storetype JKS
```

When prompted:
1. Enter and remember a strong keystore password (e.g. 24+ characters).
2. Enter your Organization / Name details.
3. Confirm with `yes`.

**Safely backup** `expenseflow-release.keystore` in an offline password manager (1Password, Bitwarden, KeePass). If lost, Google Play will not allow updates unless you reset upload keys via Google Play App Signing.

---

## 3. Configuring GitHub Actions Secrets for Automated Builds

To allow `.github/workflows/build-android.yml` to produce a signed `expenseflow-signed-release.aab`:

1. Convert your keystore file to Base64:
   ```bash
   # On macOS:
   base64 -i expenseflow-release.keystore | pbcopy

   # On Linux:
   base64 -w 0 expenseflow-release.keystore

   # On Windows (PowerShell):
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("expenseflow-release.keystore"))
   ```

2. Go to your GitHub repository:
   - Navigate to **Settings > Secrets and variables > Actions**.
   - Click **New repository secret** and add the following 4 secrets:

| Secret Name | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | The complete Base64 string generated above |
| `ANDROID_KEYSTORE_PASSWORD` | The keystore password you specified in keytool |
| `ANDROID_KEY_ALIAS` | `expenseflow_release_key` |
| `ANDROID_KEY_PASSWORD` | The key password you specified in keytool |

3. Trigger the workflow:
   - Go to **Actions > Build ExpenseFlow Android App Bundle (AAB)** > **Run workflow**.
   - The workflow will build and sign `expenseflow-signed-release.aab`.
   - Download the artifact from the workflow run summary.

---

## 4. Manual Signing via Command Line (Alternative)

If you prefer to sign locally after building an unsigned AAB:

```bash
# In the android directory:
./gradlew bundleRelease

# Sign the AAB:
jarsigner -verbose -sigalg SHA256withRSA -digestalg SHA-256 \
  -keystore /path/to/expenseflow-release.keystore \
  -storepass YOUR_KEYSTORE_PASSWORD \
  -keypass YOUR_KEY_PASSWORD \
  app/build/outputs/bundle/release/app-release.aab expenseflow_release_key
```

---

## 5. Uploading to Google Play Console

1. Log in to [Google Play Console](https://play.google.com/console).
2. Select **ExpenseFlow** (`com.expenseflow.app`).
3. Navigate to **Testing > Internal testing** (or **Production**).
4. Click **Create new release**.
5. Upload `expenseflow-signed-release.aab`.
6. Enter release notes:
   ```
   ExpenseFlow 1.0.0 Initial Release
   - Fast, local-first zero-latency expense tracking
   - Monthly burn rate and recommended daily allowance pacing
   - AI Personal Spending Coach with Google Play subscription integration
   ```
7. Review and save release.
