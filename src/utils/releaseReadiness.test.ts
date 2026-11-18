/**
 * Stage 1 & Google Play Release Readiness Automated Tests.
 *
 * Covers:
 * - In-app account deletion preserving local financial records by default
 * - Explicit opt-in local financial data wipe (deleteLocalData: true)
 * - Inline auth/requires-recent-login -> reauthenticate -> retry deletion flow
 * - Stage 1 offline-first feature gating (Play Billing & AI Coach disabled cleanly when unconfigured)
 * - SHA-256 obfuscatedAccountId parity between client authService and server firebaseAdmin
 * - Gemini 4 Hydrogen model reporting on /api/coach/status
 * - Public /privacy.html & /delete-account.html endpoints + /docs parity (no invented emails/preview URLs)
 * - Strict production CORS origin allowlist (isOriginAllowed)
 * - Client billing ownership mismatch clearing (403 / restore 409) & native obfuscatedAccountId forwarding
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createApp, isOriginAllowed } from '../../server';
import {
  AuthBackendAdapter,
  AuthUser,
  deleteCurrentUserAccount,
  formatFirebaseAuthError,
  getObfuscatedAccountIdForUser,
  setAuthBackendForTests,
} from '../services/authService';
import {
  clearLocalSubscriptionEntitlement,
  initiateSubscriptionPurchase,
  NativeGooglePlayBillingPlugin,
  saveSubscriptionEntitlement,
  setNativeBillingBridgeForTests,
  verifyPurchaseWithServer,
} from '../services/playBillingService';
import { PLAY_PRODUCT_IDS } from '../types/billing';
import { getCurrentUserPlanTier, setStoredEntitlementToken } from './premium';
import {
  getInitialStageAvailability,
  resolveStageFeatureAvailability,
} from './stageAvailability';
import {
  BUDGET_KEY,
  CHALLENGES_KEY,
  COUNTRY_KEY,
  CURRENCY_KEY,
  PLAN_KEY,
  TRANSACTIONS_KEY,
} from './storage';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

function installLocalStorageShim(): { store: Map<string, string>; restore: () => void } {
  const storageMap = new Map<string, string>();
  const prevWindow = (globalThis as Record<string, unknown>).window;

  (globalThis as Record<string, unknown>).window = {
    localStorage: {
      getItem: (k: string) => storageMap.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storageMap.set(k, v);
      },
      removeItem: (k: string) => {
        storageMap.delete(k);
      },
      clear: () => {
        storageMap.clear();
      },
    },
  };

  return {
    store: storageMap,
    restore: () => {
      if (prevWindow === undefined) {
        delete (globalThis as Record<string, unknown>).window;
      } else {
        (globalThis as Record<string, unknown>).window = prevWindow;
      }
    },
  };
}

async function runReleaseReadinessTests() {
  console.log('--- Starting ExpenseFlow Stage 1 & Release Readiness Tests ---');

  // 1. Account deletion preserves local data by default, supports re-auth & opt-in wipe
  {
    const { store: localMap, restore } = installLocalStorageShim();
    try {
      let currentUser: AuthUser | null = {
        uid: 'uid_delete_test_1',
        email: 'delete-me@example.com',
        emailVerified: true,
      };
      let deleteCalled = false;
      let reauthenticatedWith: string | null = null;
      let requireReauthFirst = false;

      const adapter: AuthBackendAdapter = {
        getCurrentUser: () => currentUser,
        getIdToken: async () => (currentUser ? 'fb_del_tok' : null),
        signInWithEmail: async () => currentUser!,
        registerWithEmail: async () => currentUser!,
        signOut: async () => {
          currentUser = null;
        },
        reauthenticate: async (pwd: string) => {
          reauthenticatedWith = pwd;
          requireReauthFirst = false;
        },
        deleteAccount: async () => {
          if (requireReauthFirst) {
            const err = new Error('Recent login required') as Error & { code?: string };
            err.code = 'auth/requires-recent-login';
            throw err;
          }
          deleteCalled = true;
          currentUser = null;
        },
        onAuthStateChanged: () => () => {},
      };
      setAuthBackendForTests(adapter);

      const sampleTx = JSON.stringify([{ id: 'tx_1', amount: 18.5, category: 'Dining', date: '2026-11-17' }]);
      const sampleBudget = JSON.stringify({ monthlyBudget: 1800, lastUpdated: 2000 });
      const samplePlan = JSON.stringify({ availableMoney: '450' });
      const sampleChallenges = JSON.stringify([]);

      localMap.set(TRANSACTIONS_KEY, sampleTx);
      localMap.set(BUDGET_KEY, sampleBudget);
      localMap.set(PLAN_KEY, samplePlan);
      localMap.set(CURRENCY_KEY, 'USD');
      localMap.set(COUNTRY_KEY, 'US');
      localMap.set(CHALLENGES_KEY, sampleChallenges);

      saveSubscriptionEntitlement({
        tier: 'premium',
        productId: PLAY_PRODUCT_IDS.ANNUAL,
        purchaseToken: 'tok_before_delete',
        verifiedEntitlementToken: 'play_sub_cached',
        expiryTimeMillis: Date.now() + 86_400_000,
        autoRenewing: true,
        cancelAtPeriodEnd: false,
        lastVerifiedAt: Date.now(),
      });
      setStoredEntitlementToken('play_sub_cached');
      assert(getCurrentUserPlanTier() === 'premium', 'Precondition: premium cached before account delete');

      // 1a. auth/requires-recent-login triggers error when no password supplied, then succeeds cleanly with passwordForReauth
      requireReauthFirst = true;
      const reauthNeededRes = await deleteCurrentUserAccount();
      assert(
        reauthNeededRes.success === false && reauthNeededRes.errorCode === 'auth/requires-recent-login',
        'deleteCurrentUserAccount must surface auth/requires-recent-login without deleting'
      );
      assert(localMap.get(TRANSACTIONS_KEY) === sampleTx, 'Failed delete must preserve local transactions');

      const reauthDelRes = await deleteCurrentUserAccount({ passwordForReauth: 'MySecret123!' });
      assert(
        reauthDelRes.success === true && deleteCalled && reauthenticatedWith === 'MySecret123!',
        'deleteCurrentUserAccount must reauthenticate and retry delete when passwordForReauth is provided'
      );
      assert(getCurrentUserPlanTier() === 'free', 'Account deletion must clear cached Premium entitlement');
      assert(localMap.get(TRANSACTIONS_KEY) === sampleTx, 'Default account deletion must preserve local transactions');
      assert(localMap.get(BUDGET_KEY) === sampleBudget, 'Default account deletion must preserve local budget');
      assert(localMap.get(PLAN_KEY) === samplePlan, 'Default account deletion must preserve local planner');
      assert(localMap.get(CHALLENGES_KEY) === sampleChallenges, 'Default account deletion must preserve local challenges');
      assert(localMap.get(CURRENCY_KEY) === 'USD' && localMap.get(COUNTRY_KEY) === 'US', 'Default account deletion must preserve locale prefs');

      // 1b. Explicit deleteLocalData: true clears canonical keys on user request
      currentUser = { uid: 'uid_delete_test_2', email: 'wipe@example.com', emailVerified: true };
      const wipeRes = await deleteCurrentUserAccount({ deleteLocalData: true });
      assert(wipeRes.success === true, 'Opt-in wipe delete must succeed');
      assert(localMap.get(TRANSACTIONS_KEY) === undefined, 'deleteLocalData: true must remove transactions');
      assert(localMap.get(BUDGET_KEY) === undefined, 'deleteLocalData: true must remove budget');
      assert(localMap.get(PLAN_KEY) === undefined, 'deleteLocalData: true must remove plan');

      // Re-auth error mapping check
      const reauthErr = formatFirebaseAuthError({ code: 'auth/requires-recent-login' });
      assert(
        reauthErr.code === 'auth/requires-recent-login' &&
          reauthErr.message.toLowerCase().includes('current password'),
        'auth/requires-recent-login must surface clear inline password verification instructions'
      );

      console.log('✔ Test 1 Passed: In-app account deletion, inline re-auth retry, default preservation, & opt-in local wipe verified.');
    } finally {
      setAuthBackendForTests(null);
      restore();
    }
  }

  // 2. Stage 1 feature gating (fail-closed without backend / billing / Firestore persistence)
  {
    const prevFetch = globalThis.fetch;
    try {
      let fetchCalls = 0;
      globalThis.fetch = (async () => {
        fetchCalls += 1;
        return new Response('{}', { status: 200 });
      }) as typeof fetch;

      // Native Android with unset VITE_API_BASE_URL fails closed synchronously with zero HTTP calls
      const syncNative = getInitialStageAvailability({ isNative: true, origin: 'https://localhost', apiBaseUrl: '' });
      assert(
        syncNative.purchasesEnabled === false &&
          syncNative.aiCoachEnabled === false &&
          syncNative.isStage1OfflineMode === true,
        'Native Stage 1 without VITE_API_BASE_URL must disable purchases & AI Coach synchronously'
      );

      const asyncNative = await resolveStageFeatureAvailability({
        isNative: true,
        origin: 'https://localhost',
        apiBaseUrl: '',
      });
      assert(
        asyncNative.purchasesEnabled === false && asyncNative.aiCoachEnabled === false && fetchCalls === 0,
        'Stage 1 Android without backend URL must make 0 network requests and stay disabled'
      );

      // Web/server with unconfigured billing/persistence stays disabled even if coach reports available
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/billing/status')) {
          return new Response(JSON.stringify({ configured: false, persistenceReady: false }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ available: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof fetch;

      const stage1Web = await resolveStageFeatureAvailability({
        isNative: false,
        origin: 'https://app.example',
        apiBaseUrl: 'https://api.example',
      });
      assert(
        stage1Web.purchasesEnabled === false && stage1Web.aiCoachEnabled === false,
        'Purchases & AI Coach must stay disabled until both billing & Firestore persistence are ready'
      );

      // Stage 2 fully configured backend enables both cleanly
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/billing/status')) {
          return new Response(JSON.stringify({ configured: true, persistenceReady: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ available: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof fetch;

      const stage2Web = await resolveStageFeatureAvailability({
        isNative: false,
        origin: 'https://app.example',
        apiBaseUrl: 'https://api.example',
      });
      assert(
        stage2Web.purchasesEnabled === true && stage2Web.aiCoachEnabled === true,
        'Configured Stage 2 backend must activate purchases and AI Coach'
      );

      console.log('✔ Test 2 Passed: Stage 1 fail-closed gating & Stage 2 readiness detection verified.');
    } finally {
      globalThis.fetch = prevFetch;
    }
  }

  // 3. Client obfuscatedAccountId parity with server firebaseAdmin SHA-256 hash
  {
    const uid = 'firebase_uid_parity_check_123';
    const clientHash = await getObfuscatedAccountIdForUser(uid);
    const serverHash = crypto.createHash('sha256').update(uid).digest('hex').slice(0, 32);

    assert(clientHash === serverHash, `Expected client hash ${clientHash} to equal server hash ${serverHash}`);
    assert(clientHash?.length === 32, 'obfuscatedAccountId must be 32 lowercase hex chars');
    assert((await getObfuscatedAccountIdForUser(null)) === undefined, 'Empty/null uid returns undefined');

    console.log('✔ Test 3 Passed: Client/server SHA-256 obfuscatedAccountId parity verified.');
  }

  // 4. Server endpoints (/privacy.html, /delete-account.html, /api/health, /api/coach/status), /docs parity, & strict production CORS
  {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevAllowed = process.env.ALLOWED_ORIGINS;
    const prevAppUrl = process.env.APP_URL;
    const prevGeminiKey = process.env.GEMINI_API_KEY;
    const prevPlaySecret = process.env.PLAY_BILLING_SIGNING_SECRET;

    try {
      process.env.NODE_ENV = 'production';
      process.env.ALLOWED_ORIGINS = 'https://api.expenseflow-prod.example';
      process.env.APP_URL = 'https://app.expenseflow-prod.example';

      assert(isOriginAllowed('https://localhost') === true, 'Capacitor Android https://localhost must be allowed in prod');
      assert(isOriginAllowed('https://expenseflow-2984.ai.studio') === true, 'Official web domain must be allowed in prod');
      assert(isOriginAllowed('https://api.expenseflow-prod.example') === true, 'Configured ALLOWED_ORIGINS must be allowed in prod');
      assert(isOriginAllowed('https://app.expenseflow-prod.example') === true, 'Configured APP_URL must be allowed in prod');
      assert(
        isOriginAllowed('https://random-preview-123.asia-southeast1.run.app') === false,
        'Arbitrary *.run.app wildcard origins MUST be blocked in production'
      );
      assert(
        isOriginAllowed('https://evil-app.ai.studio') === false,
        'Arbitrary *.ai.studio wildcard origins MUST be blocked in production'
      );
      assert(
        isOriginAllowed('http://localhost:3000') === false,
        'Plain http://localhost MUST be blocked in strict production CORS'
      );

      process.env.NODE_ENV = 'test';
      process.env.GEMINI_API_KEY = 'AIza_SUPER_SECRET_DO_NOT_LEAK_IN_HEALTH';
      process.env.PLAY_BILLING_SIGNING_SECRET = 'SUPER_SECRET_BILLING_SIGNING_KEY_12345';

      const app = await createApp({ disableVite: true });
      const srv = await new Promise<http.Server>((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
      });
      const baseUrl = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;

      try {
        const privacyRes = await fetch(`${baseUrl}/privacy.html`);
        const privacyHtml = await privacyRes.text();
        assert(privacyRes.status === 200, `GET /privacy.html expected 200, got ${privacyRes.status}`);
        assert(
          privacyHtml.includes('ExpenseFlow') &&
            privacyHtml.includes('delete-account.html') &&
            privacyHtml.includes('Delete ExpenseFlow Account') &&
            !privacyHtml.includes('support@expenseflow.app') &&
            !privacyHtml.includes('ais-dev'),
          '/privacy.html must accurately document Stage 1 disclosures & deletion without fabricated emails or preview URLs'
        );

        const delPageRes = await fetch(`${baseUrl}/delete-account.html`);
        const delPageHtml = await delPageRes.text();
        assert(delPageRes.status === 200, `GET /delete-account.html expected 200, got ${delPageRes.status}`);
        assert(
          delPageHtml.includes('expenseflow-ad899') &&
            delPageHtml.includes('identitytoolkit.googleapis.com/v1/accounts:delete') &&
            !delPageHtml.includes('support@expenseflow.app'),
          '/delete-account.html must implement Firebase Identity Toolkit deletion cleanly'
        );

        // Verify /docs static mirror for GitHub Pages matches /public files identically
        const docsPrivacy = fs.readFileSync(path.resolve('docs/privacy.html'), 'utf-8');
        const docsDelete = fs.readFileSync(path.resolve('docs/delete-account.html'), 'utf-8');
        assert(docsPrivacy === privacyHtml, 'docs/privacy.html must stay synced with public/privacy.html');
        assert(docsDelete === delPageHtml, 'docs/delete-account.html must stay synced with public/delete-account.html');

        const healthRes = await fetch(`${baseUrl}/api/health`);
        const healthRaw = await healthRes.text();
        const healthJson = JSON.parse(healthRaw) as {
          status?: string;
          readiness?: { coachAvailable?: boolean; persistenceBackend?: string };
        };
        assert(healthRes.status === 200 && healthJson.status === 'healthy', 'GET /api/health must return healthy');
        assert(healthJson.readiness?.coachAvailable === true, 'Health readiness must report non-secret boolean coachAvailable');
        assert(!healthRaw.includes('AIza_SUPER_SECRET'), 'Health response must NEVER leak GEMINI_API_KEY');
        assert(!healthRaw.includes('SUPER_SECRET_BILLING'), 'Health response must NEVER leak signing secrets');

        const coachStatusRes = await fetch(`${baseUrl}/api/coach/status`);
        const coachStatusJson = (await coachStatusRes.json()) as { model?: string; available?: boolean };
        assert(coachStatusRes.status === 200 && coachStatusJson.available === true, 'Coach status must return 200 available');
        assert(
          coachStatusJson.model === 'gemini-4-hydrogen',
          `Coach status model must be gemini-4-hydrogen, got ${coachStatusJson.model}`
        );
      } finally {
        srv.closeAllConnections?.();
        await new Promise<void>((resolve) => srv.close(() => resolve()));
      }

      console.log('✔ Test 4 Passed: CORS, /privacy.html, /delete-account.html, /docs sync, /api/health, and gemini-4-hydrogen verified.');
    } finally {
      if (prevNodeEnv !== undefined) process.env.NODE_ENV = prevNodeEnv;
      else delete process.env.NODE_ENV;
      if (prevAllowed !== undefined) process.env.ALLOWED_ORIGINS = prevAllowed;
      else delete process.env.ALLOWED_ORIGINS;
      if (prevAppUrl !== undefined) process.env.APP_URL = prevAppUrl;
      else delete process.env.APP_URL;
      if (prevGeminiKey !== undefined) process.env.GEMINI_API_KEY = prevGeminiKey;
      else delete process.env.GEMINI_API_KEY;
      if (prevPlaySecret !== undefined) process.env.PLAY_BILLING_SIGNING_SECRET = prevPlaySecret;
      else delete process.env.PLAY_BILLING_SIGNING_SECRET;
    }
  }

  // 5. Client billing clears mismatched entitlement on 403/restore-409 & forwards obfuscatedAccountId
  {
    const { restore } = installLocalStorageShim();
    const prevFetch = globalThis.fetch;

    try {
      saveSubscriptionEntitlement({
        tier: 'premium',
        productId: PLAY_PRODUCT_IDS.MONTHLY,
        purchaseToken: 'tok_owned_by_other_user',
        verifiedEntitlementToken: 'play_sub_stale',
        expiryTimeMillis: Date.now() + 86_400_000,
        autoRenewing: true,
        cancelAtPeriodEnd: false,
        lastVerifiedAt: Date.now(),
      });
      setStoredEntitlementToken('play_sub_stale');

      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            success: false,
            status: 'ownership_mismatch',
            message: 'Bound to another user.',
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } }
        )) as typeof fetch;

      const mismatchRes = await verifyPurchaseWithServer(
        'tok_owned_by_other_user',
        PLAY_PRODUCT_IDS.MONTHLY,
        {
          mode: 'restore',
          authToken: 'fb_user_b',
          apiConfigOptions: { isNative: false, origin: 'https://app.test', apiBaseUrl: 'https://api.test' },
        }
      );
      assert(mismatchRes.success === false, 'Mismatched restore must fail');
      assert(getCurrentUserPlanTier() === 'free', '409 restore mismatch must clear cached local Premium entitlement');

      const captured: { launchOptions: { productId: string; obfuscatedAccountId?: string } | null } = {
        launchOptions: null,
      };
      const mockBridge: NativeGooglePlayBillingPlugin = {
        isAvailable: async () => ({ available: true, platform: 'android' }),
        queryProductDetails: async () => ({ products: [] }),
        launchBillingFlow: async (opts) => {
          captured.launchOptions = opts;
          throw new Error('USER_CANCELED');
        },
        queryPurchases: async () => ({ purchases: [] }),
        acknowledgePurchase: async ({ purchaseToken }) => ({ success: true, purchaseToken }),
      };

      setNativeBillingBridgeForTests(mockBridge, true);
      const cancelRes = await initiateSubscriptionPurchase(PLAY_PRODUCT_IDS.MONTHLY, {
        obfuscatedAccountId: 'abc123obfuscated999',
      });
      assert(cancelRes.status === 'canceled', 'Canceled purchase must map cleanly');
      assert(
        captured.launchOptions?.obfuscatedAccountId === 'abc123obfuscated999',
        'launchBillingFlow must receive obfuscatedAccountId'
      );

      clearLocalSubscriptionEntitlement();
      console.log('✔ Test 5 Passed: Billing mismatch cleanup & native obfuscatedAccountId forwarding verified.');
    } finally {
      globalThis.fetch = prevFetch;
      setNativeBillingBridgeForTests(null, null);
      restore();
    }
  }

  console.log('🎉 All Stage 1 & Release Readiness Tests Passed Successfully!');
}

runReleaseReadinessTests().catch((err) => {
  console.error('❌ Release Readiness Test Failure:', err);
  process.exit(1);
});
