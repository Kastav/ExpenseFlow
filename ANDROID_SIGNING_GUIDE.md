# ExpenseFlow Android Release Signing, CI/CD & Hosting Guide

This document describes how to generate your Android upload keystore, build signed Stage 1 offline-first (and future Stage 2) `.aab` bundles cleanly with `.github/workflows/build-android.yml` (JDK 21), and publish static compliance pages on GitHub Pages.

---

## 1. Zero-Leak Security Rule

- **NEVER** commit `release.keystore`, `*.jks`, `*.aab`, `*.apk`, `keystore.properties`, or Google Service Account JSON files to Git or GitHub.
- Keystore credentials belong strictly in **GitHub Repository Secrets** or an offline password manager.

---

## 2. Generating Your Android Upload Keystore (PKCS12 Recommended)

Run on your local machine with JDK 17/21 `keytool`:

```bash
keytool -genkeypair -v \
  -keystore expenseflow-release.keystore \
  -alias expenseflow_release_key \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -storetype PKCS12
```

Back up `expenseflow-release.keystore` and its password in two secure offline locations.

---

## 3. GitHub Repository Secrets & Stage 1 vs Stage 2 Variables

Open your GitHub repository -> **Settings > Secrets and variables > Actions**:

### Repository Secrets (`Secrets` tab — Required for `release-aab`)
Encode your keystore to single-line Base64:
```bash
# macOS:
base64 -i expenseflow-release.keystore | pbcopy

# Linux:
base64 -w 0 expenseflow-release.keystore

# Windows PowerShell:
[Convert]::ToBase64String([IO.File]::ReadAllBytes("expenseflow-release.keystore")) | Set-Clipboard
```

| Secret Name | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | Single-line Base64 keystore output |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | `expenseflow_release_key` |
| `ANDROID_KEY_PASSWORD` | Key password (same as `ANDROID_KEYSTORE_PASSWORD` for PKCS12) |

### Repository Variables (`Variables` tab)
| Variable Name | Stage 1 Value | Stage 2 Value (Future) |
|---|---|---|
| `VITE_API_BASE_URL` | **Leave unset/empty** for Stage 1 offline-first release | Set to permanent `https://` Cloud Run URL (never `localhost` or `http://`) |
| `ANDROID_VERSION_CODE` *(optional)* | `1` (increment for each Play upload) | Increment per upload |
| `ANDROID_VERSION_NAME` *(optional)* | `1.0` | Next release version |

---

## 4. Triggering `.github/workflows/build-android.yml`

- Runs `bun run lint`, `bun run test`, `bun run build`, and `bunx cap sync android`.
- Verifies locked `applicationId "com.expenseflow.app"`.
- In Stage 1 (`VITE_API_BASE_URL` empty), logs notice and compiles a **Stage 1 offline-first signed AAB** (`Premium` billing, AI Coach, and Cloud Sync disabled in UI).
- If `VITE_API_BASE_URL` is provided, rejects non-HTTPS or `localhost` URLs.
- Fails closed if any `ANDROID_KEYSTORE_*` secret is missing when `build_mode` is `release-aab`.
- Builds under **Temurin JDK 21** and cryptographically verifies `expenseflow-signed-release.aab` using `jarsigner -verify -verbose -certs`.

---

## 5. Free Public Compliance Hosting (GitHub Pages `/docs`)

In Stage 1, no Cloud Run backend is required to host legal pages:
1. Enable **Settings > Pages > Deploy from a branch: `main` -> `/docs`**.
2. Public URLs become:
   - `https://<github-username>.github.io/<repo-name>/privacy.html`
   - `https://<github-username>.github.io/<repo-name>/delete-account.html`
