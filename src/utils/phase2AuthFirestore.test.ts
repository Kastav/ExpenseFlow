/**
 * Phase 2 Firebase Authentication & Firestore Persistence Automated Tests.
 *
 * Uses mock/simulated Firebase Auth adapters and an in-memory transactional
 * FakeFirestore driver implementing FirestoreDriver — does NOT connect to live
 * Firebase or Google Play production services.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { createApp } from '../../server';
import {
  FirestoreEntitlementStore,
  FIRESTORE_COLLECTIONS,
  FirestoreDriver,
  FirestoreDocKey,
  FirestoreTxAdapter,
  EntitlementStoreConfigurationError,
  resolveEntitlementStore,
  setDefaultEntitlementStoreForTests,
  hashPurchaseToken,
  getTokenIdFromHash,
} from '../server/entitlementStore';
import {
  AndroidPublisherLike,
  SubscriptionPurchaseV2Data,
  generateVerifiedEntitlementToken,
} from '../server/playBillingVerification';
import { PLAY_PRODUCT_IDS } from '../types/billing';
import {
  AuthBackendAdapter,
  AuthUser,
  connectAuthProviders,
  formatFirebaseAuthError,
  getFirebaseWebConfig,
  registerWithEmail,
  setAuthBackendForTests,
  signInWithEmail,
  signOutUser,
  subscribeToAuthState,
} from '../services/authService';
import {
  saveSubscriptionEntitlement,
  verifyPurchaseWithServer,
} from '../services/playBillingService';
import { buildSafeFinancialSummary, sendCoachChatMessage } from '../services/aiCoachService';
import { getCurrentUserPlanTier, setStoredEntitlementToken } from './premium';
import { TRANSACTIONS_KEY, BUDGET_KEY, PLAN_KEY, CURRENCY_KEY, COUNTRY_KEY } from './storage';

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

/**
 * In-memory transactional Firestore driver simulating serialized Firestore transactions
 * with snapshot cloning and multi-instance shared state.
 */
class FakeFirestoreDatabase {
  public readonly collections = new Map<string, Map<string, Record<string, unknown>>>();
  private txChain: Promise<unknown> = Promise.resolve();

  private getCol(name: string): Map<string, Record<string, unknown>> {
    let col = this.collections.get(name);
    if (!col) {
      col = new Map<string, Record<string, unknown>>();
      this.collections.set(name, col);
    }
    return col;
  }

  public createDriver(): FirestoreDriver {
    const db = this;
    return {
      async getDoc(key: FirestoreDocKey): Promise<Record<string, unknown> | null> {
        const val = db.getCol(key.collection).get(key.id);
        return val ? JSON.parse(JSON.stringify(val)) : null;
      },
      async queryDocsByField(collection: string, field: string, value: string): Promise<Array<Record<string, unknown>>> {
        return Array.from(db.getCol(collection).values())
          .filter((doc) => doc[field] === value)
          .map((doc) => JSON.parse(JSON.stringify(doc)));
      },
      async setDoc(key: FirestoreDocKey, data: Record<string, unknown>): Promise<void> {
        db.getCol(key.collection).set(key.id, JSON.parse(JSON.stringify(data)));
      },
      async deleteDoc(key: FirestoreDocKey): Promise<void> {
        db.getCol(key.collection).delete(key.id);
      },
      async runTransaction<T>(fn: (tx: FirestoreTxAdapter) => Promise<T>): Promise<T> {
        const next = db.txChain.then(async () => {
          const stagedSets = new Map<string, { key: FirestoreDocKey; data: Record<string, unknown> }>();
          const stagedDeletes = new Set<string>();
          const pathKey = (k: FirestoreDocKey) => `${k.collection}::${k.id}`;

          const tx: FirestoreTxAdapter = {
            async get(k: FirestoreDocKey) {
              const pk = pathKey(k);
              if (stagedDeletes.has(pk)) return null;
              if (stagedSets.has(pk)) {
                return JSON.parse(JSON.stringify(stagedSets.get(pk)!.data));
              }
              const val = db.getCol(k.collection).get(k.id);
              return val ? JSON.parse(JSON.stringify(val)) : null;
            },
            set(k: FirestoreDocKey, data: Record<string, unknown>) {
              const pk = pathKey(k);
              stagedDeletes.delete(pk);
              stagedSets.set(pk, { key: k, data: JSON.parse(JSON.stringify(data)) });
            },
            delete(k: FirestoreDocKey) {
              const pk = pathKey(k);
              stagedSets.delete(pk);
              stagedDeletes.add(pk);
            },
          };

          const result = await fn(tx);
          for (const [, entry] of stagedSets) {
            db.getCol(entry.key.collection).set(entry.key.id, entry.data);
          }
          for (const pk of stagedDeletes) {
            const [col, id] = pk.split('::');
            db.getCol(col).delete(id);
          }
          return result;
        });

        db.txChain = next.then(
          () => undefined,
          () => undefined
        );
        return next;
      },
    };
  }
}

async function runPhase2Tests() {
  console.log('--- Starting Phase 2 Firebase Auth & Firestore Persistence Tests ---');

  // =========================================================================
  // 1. Client Auth Flows: Registration, Sign-In, Error Handling, Restoration & Local Data Preservation
  // =========================================================================
  {
    const { store: localMap, restore } = installLocalStorageShim();
    try {
      const registeredUsers = new Map<string, { uid: string; password: string }>();
      let currentUser: AuthUser | null = null;
      let currentIdToken: string | null = null;
      let authListeners: Array<(u: AuthUser | null) => void> = [];
      let simulateNetworkFailure = false;

      const emitAuth = () => {
        for (const fn of authListeners) {
          fn(currentUser);
        }
      };

      const mockAuthAdapter: AuthBackendAdapter = {
        getCurrentUser: () => currentUser,
        getIdToken: async () => currentIdToken,
        async registerWithEmail(email: string, password: string) {
          if (simulateNetworkFailure) {
            const err = new Error('Network unavailable') as Error & { code?: string };
            err.code = 'auth/network-request-failed';
            throw err;
          }
          if (registeredUsers.has(email)) {
            const err = new Error('Email in use') as Error & { code?: string };
            err.code = 'auth/email-already-in-use';
            throw err;
          }
          const uid = `uid_${registeredUsers.size + 1}`;
          registeredUsers.set(email, { uid, password });
          currentUser = { uid, email, emailVerified: false };
          currentIdToken = `fb_id_${uid}`;
          emitAuth();
          return currentUser;
        },
        async signInWithEmail(email: string, password: string) {
          if (simulateNetworkFailure) {
            const err = new Error('Network unavailable') as Error & { code?: string };
            err.code = 'auth/network-request-failed';
            throw err;
          }
          const rec = registeredUsers.get(email);
          if (!rec || rec.password !== password) {
            const err = new Error('Invalid credential') as Error & { code?: string };
            err.code = 'auth/invalid-credential';
            throw err;
          }
          currentUser = { uid: rec.uid, email, emailVerified: true };
          currentIdToken = `fb_id_${rec.uid}`;
          emitAuth();
          return currentUser;
        },
        async signOut() {
          currentUser = null;
          currentIdToken = null;
          emitAuth();
        },
        onAuthStateChanged(cb) {
          authListeners.push(cb);
          cb(currentUser);
          return () => {
            authListeners = authListeners.filter((l) => l !== cb);
          };
        },
      };

      const fbCfg = getFirebaseWebConfig();
      assert(fbCfg.projectId === 'expenseflow-ad899', 'Firebase projectId must be expenseflow-ad899');
      assert(fbCfg.authDomain === 'expenseflow-ad899.firebaseapp.com', 'Firebase authDomain must match expenseflow-ad899.firebaseapp.com');
      assert(Boolean(fbCfg.apiKey && fbCfg.appId), 'Firebase Web apiKey and appId must be configured');
      assert(
        formatFirebaseAuthError({ code: 'auth/operation-not-allowed' }).message.includes('Email/Password'),
        'auth/operation-not-allowed must surface clear guidance'
      );

      setAuthBackendForTests(mockAuthAdapter);

      // Seed local offline-first financial records BEFORE signing in / signing out
      const sampleTxJson = JSON.stringify([{ id: 'tx_local_1', amount: 42.5, category: 'Groceries', date: '2026-11-16' }]);
      const sampleBudgetJson = JSON.stringify({ monthlyBudget: 2500, lastUpdated: 1000 });
      const samplePlanJson = JSON.stringify({ targetAmount: 600 });
      localMap.set(TRANSACTIONS_KEY, sampleTxJson);
      localMap.set(BUDGET_KEY, sampleBudgetJson);
      localMap.set(PLAN_KEY, samplePlanJson);
      localMap.set(CURRENCY_KEY, 'USD');
      localMap.set(COUNTRY_KEY, 'US');

      // Weak password rejected locally
      const weakReg = await registerWithEmail('alice@example.com', '123');
      assert(weakReg.success === false && weakReg.errorCode === 'auth/weak-password', 'Weak password must be rejected');

      // Successful registration
      const regOk = await registerWithEmail('alice@example.com', 'SuperSecret99!');
      assert(regOk.success === true && regOk.user?.email === 'alice@example.com', 'Valid registration must succeed');

      // Duplicate registration rejected cleanly
      const dupReg = await registerWithEmail('alice@example.com', 'SuperSecret99!');
      assert(dupReg.success === false && dupReg.errorCode === 'auth/email-already-in-use', 'Duplicate email registration must return clear error');

      // Network error handled gracefully
      simulateNetworkFailure = true;
      const netErr = await signInWithEmail('alice@example.com', 'SuperSecret99!');
      assert(netErr.success === false && netErr.errorCode === 'auth/network-request-failed', 'Network error must be mapped safely');
      simulateNetworkFailure = false;

      // Wrong password rejected
      const badPass = await signInWithEmail('alice@example.com', 'WrongPassword');
      assert(badPass.success === false && badPass.errorCode === 'auth/invalid-credential', 'Invalid password must return safe error');

      // Sign-out clears cached Premium entitlement WITHOUT touching local financial data
      saveSubscriptionEntitlement({
        tier: 'premium',
        productId: PLAY_PRODUCT_IDS.MONTHLY,
        purchaseToken: 'tok_local_cached',
        verifiedEntitlementToken: 'play_sub_fake',
        expiryTimeMillis: Date.now() + 86_400_000,
        autoRenewing: true,
        cancelAtPeriodEnd: false,
        lastVerifiedAt: Date.now(),
      });
      setStoredEntitlementToken('play_sub_fake');
      assert(getCurrentUserPlanTier() === 'premium', 'Precondition: cached entitlement active before sign-out');

      const outRes = await signOutUser();
      assert(outRes.success === true, 'Sign out must succeed');
      assert(getCurrentUserPlanTier() === 'free', 'Sign out must clear cached subscription entitlement');
      assert(localMap.get(TRANSACTIONS_KEY) === sampleTxJson, 'Sign out MUST preserve local transactions');
      assert(localMap.get(BUDGET_KEY) === sampleBudgetJson, 'Sign out MUST preserve local budget');
      assert(localMap.get(PLAN_KEY) === samplePlanJson, 'Sign out MUST preserve local planner data');
      assert(localMap.get(CURRENCY_KEY) === 'USD' && localMap.get(COUNTRY_KEY) === 'US', 'Sign out MUST preserve locale prefs');

      // No password or private credential ever persisted into localStorage
      for (const [, val] of localMap.entries()) {
        assert(!val.includes('SuperSecret99!'), 'Passwords must NEVER be stored in localStorage');
      }

      // Sign back in & verify auth state restoration listener fires with restored user
      const signInOk = await signInWithEmail('alice@example.com', 'SuperSecret99!');
      assert(signInOk.success === true && signInOk.user?.uid === 'uid_1', 'Valid sign in must succeed');

      let restoredUid: string | null = null;
      const unsub = subscribeToAuthState((snap) => {
        if (snap.initialized && snap.user) {
          restoredUid = snap.user.uid;
        }
      });
      unsub();
      assert(restoredUid === 'uid_1', 'subscribeToAuthState must restore active Firebase user session');

      console.log('✔ Test 1 Passed: Auth registration, sign-in, errors, session restoration & local data preservation verified.');
    } finally {
      setAuthBackendForTests(null);
      restore();
    }
  }

  // =========================================================================
  // 2. Production Fail-Closed Store Policy
  // =========================================================================
  {
    let threwUnset = false;
    try {
      await resolveEntitlementStore({ nodeEnv: 'production', backend: '' });
    } catch (e) {
      threwUnset = e instanceof EntitlementStoreConfigurationError;
    }
    assert(threwUnset, 'Production without ENTITLEMENT_STORE_BACKEND must throw EntitlementStoreConfigurationError');

    let threwFile = false;
    try {
      await resolveEntitlementStore({ nodeEnv: 'production', backend: 'file' });
    } catch (e) {
      threwFile = e instanceof EntitlementStoreConfigurationError;
    }
    assert(threwFile, 'Production with ENTITLEMENT_STORE_BACKEND=file must fail closed');

    let threwMissingAdmin = false;
    try {
      await resolveEntitlementStore({
        nodeEnv: 'production',
        backend: 'firestore',
        firebaseAdminConfigured: false,
        firestoreClient: null,
      });
    } catch (e) {
      threwMissingAdmin = e instanceof EntitlementStoreConfigurationError;
    }
    assert(threwMissingAdmin, 'Production with Firestore selected but missing Admin credentials must fail closed');

    const fakeDb = new FakeFirestoreDatabase();
    const prodResolved = await resolveEntitlementStore({
      nodeEnv: 'production',
      backend: 'firestore',
      firestoreClient: fakeDb.createDriver(),
    });
    assert(prodResolved.backendName === 'firestore', 'Production with Firestore + credentials resolves FirestoreEntitlementStore');

    // HTTP endpoints must also return 503 fail-closed in production without Firestore
    const prevNodeEnv = process.env.NODE_ENV;
    const prevBackend = process.env.ENTITLEMENT_STORE_BACKEND;
    process.env.NODE_ENV = 'production';
    process.env.ENTITLEMENT_STORE_BACKEND = 'file';
    setDefaultEntitlementStoreForTests(null);

    const failClosedApp = await createApp({
      disableVite: true,
      billingDeps: {
        verifyCallerToken: async (b) => (b === 'valid_fb' ? { uid: 'u1' } : null),
      },
      coachDeps: {
        requireFirebaseAuth: true,
        verifyCallerToken: async (b) => (b === 'valid_fb' ? { uid: 'u1' } : null),
        generateReply: async () => 'unused',
      },
    });
    const failSrv = await new Promise<http.Server>((resolve) => {
      const s = failClosedApp.listen(0, '127.0.0.1', () => resolve(s));
    });
    const failUrl = `http://127.0.0.1:${(failSrv.address() as { port: number }).port}`;
    try {
      const bRes = await fetch(`${failUrl}/api/billing/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_fb' },
        body: JSON.stringify({ purchaseToken: 't', productId: PLAY_PRODUCT_IDS.MONTHLY }),
      });
      assert(bRes.status === 503, `Expected 503 on production billing/verify without Firestore, got ${bRes.status}`);

      const cRes = await fetch(`${failUrl}/api/coach/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_fb' },
        body: JSON.stringify({ message: 'hi', entitlementToken: 'play_sub_x' }),
      });
      assert(cRes.status === 503, `Expected 503 on production coach/chat without Firestore, got ${cRes.status}`);

      const sRes = await fetch(`${failUrl}/api/billing/status`);
      const sJson = (await sRes.json()) as { persistenceReady?: boolean; persistenceBackend?: string };
      assert(sJson.persistenceReady === false && sJson.persistenceBackend === 'unconfigured', 'Status endpoint must report unconfigured fail-closed persistence');
    } finally {
      failSrv.closeAllConnections?.();
      await new Promise<void>((r) => failSrv.close(() => r()));
      if (prevNodeEnv !== undefined) process.env.NODE_ENV = prevNodeEnv;
      else delete process.env.NODE_ENV;
      if (prevBackend !== undefined) process.env.ENTITLEMENT_STORE_BACKEND = prevBackend;
      else delete process.env.ENTITLEMENT_STORE_BACKEND;
      setDefaultEntitlementStoreForTests(null);
    }

    console.log('✔ Test 2 Passed: Production persistence strictly fails closed (resolve + HTTP 503) without Firestore + Firebase Admin.');
  }

  // =========================================================================
  // 3. End-to-End Backend Security, Firestore Transactions, Atomicity & Quotas
  // =========================================================================
  {
    const prevSigningSecret = process.env.PLAY_BILLING_SIGNING_SECRET;
    const prevGeminiKey = process.env.GEMINI_API_KEY;
    const prevPubSubAudience = process.env.GOOGLE_PUBSUB_AUDIENCE;

    process.env.PLAY_BILLING_SIGNING_SECRET = 'phase2_firestore_test_secret_32ch!';
    process.env.GEMINI_API_KEY = 'phase2_dummy_gemini_key';
    process.env.GOOGLE_PUBSUB_AUDIENCE = 'https://api.expenseflow.test/api/billing/rtdn';

    const fakeDb = new FakeFirestoreDatabase();
    // Simulate Instance 1 and Instance 2 connecting to shared Firestore database
    const storeInstanceA = new FirestoreEntitlementStore(fakeDb.createDriver());
    const storeInstanceB = new FirestoreEntitlementStore(fakeDb.createDriver());

    const mockPurchases = new Map<string, { data: SubscriptionPurchaseV2Data }>();
    let fixedNowMs = Date.now();
    const futureIso = new Date(fixedNowMs + 30 * 86_400_000).toISOString();

    mockPurchases.set('raw_secret_play_tok_user_a', {
      data: {
        subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
        acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING',
        latestOrderId: 'GPA.PHASE2-001',
        externalAccountIdentifiers: { obfuscatedExternalAccountId: 'obf_user_a' },
        lineItems: [
          {
            productId: PLAY_PRODUCT_IDS.MONTHLY,
            expiryTime: futureIso,
            autoRenewingPlan: { autoRenewEnabled: true },
          },
        ],
      },
    });

    const mockPublisher: AndroidPublisherLike = {
      purchases: {
        subscriptionsv2: {
          async get({ token }) {
            // Brief async yield to exercise concurrent purchase locking
            await new Promise((r) => setTimeout(r, 15));
            const entry = mockPurchases.get(token);
            if (!entry) {
              const err = new Error('Not found') as Error & { code?: number };
              err.code = 404;
              throw err;
            }
            return { data: entry.data };
          },
        },
        subscriptions: {
          async acknowledge({ token }) {
            const entry = mockPurchases.get(token);
            if (entry) {
              entry.data.acknowledgementState = 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED';
            }
            return {};
          },
        },
      },
    };

    const verifyTestFirebaseToken = async (bearer: string) => {
      if (bearer === 'valid_fb_user_a') return { uid: 'uid_user_a', obfuscatedAccountId: 'obf_user_a' };
      if (bearer === 'valid_fb_user_b') return { uid: 'uid_user_b', obfuscatedAccountId: 'obf_user_b' };
      if (bearer === 'valid_fb_free_user') return { uid: 'uid_free_user', obfuscatedAccountId: 'obf_free_user' };
      if (bearer === 'expired_fb_token' || bearer === 'invalid_fb_token') return null;
      return null;
    };

    const app = await createApp({
      disableVite: true,
      billingDeps: {
        store: storeInstanceA,
        getPublisher: () => mockPublisher,
        now: () => fixedNowMs,
        verifyCallerToken: verifyTestFirebaseToken,
        verifyPubSubOidcToken: async (bearer, audience) =>
          bearer === 'valid_pubsub_oidc' && audience === process.env.GOOGLE_PUBSUB_AUDIENCE,
      },
      coachDeps: {
        store: storeInstanceA,
        now: () => fixedNowMs,
        requireFirebaseAuth: true,
        verifyCallerToken: verifyTestFirebaseToken,
        generateReply: async () => 'You have $40/day remaining.',
      },
    });

    const server = await new Promise<http.Server>((resolve) => {
      const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
    });
    const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

    try {
      // 3a. Invalid / expired Firebase ID tokens return 401 on billing/verify AND coach/chat
      for (const badToken of ['invalid_fb_token', 'expired_fb_token']) {
        const billRes = await fetch(`${baseUrl}/api/billing/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${badToken}` },
          body: JSON.stringify({
            purchaseToken: 'raw_secret_play_tok_user_a',
            productId: PLAY_PRODUCT_IDS.MONTHLY,
          }),
        });
        assert(billRes.status === 401, `Billing verify must return 401 for ${badToken}, got ${billRes.status}`);

        const coachRes = await fetch(`${baseUrl}/api/coach/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${badToken}` },
          body: JSON.stringify({ message: 'Hello?' }),
        });
        assert(coachRes.status === 401, `Coach chat must return 401 for ${badToken}, got ${coachRes.status}`);
      }

      // Free authenticated user calling AI Coach without valid entitlement -> 403
      const freeCoachRes = await fetch(`${baseUrl}/api/coach/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid_fb_free_user',
          'X-ExpenseFlow-Entitlement-Tier': 'premium', // spoofed client header
        },
        body: JSON.stringify({ message: 'Bypass test', entitlementToken: 'play_sub_forged_token' }),
      });
      assert(freeCoachRes.status === 403, `Free account must get 403 on Premium endpoint, got ${freeCoachRes.status}`);

      // 3b. Atomic concurrent duplicate purchase claim -> strictly 1 grants (200) and 1 gets rejected (409)
      const [r1, r2] = await Promise.all([
        fetch(`${baseUrl}/api/billing/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_fb_user_a' },
          body: JSON.stringify({
            purchaseToken: 'raw_secret_play_tok_user_a',
            productId: PLAY_PRODUCT_IDS.MONTHLY,
            orderId: 'GPA.PHASE2-001',
            mode: 'purchase',
          }),
        }),
        fetch(`${baseUrl}/api/billing/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_fb_user_a' },
          body: JSON.stringify({
            purchaseToken: 'raw_secret_play_tok_user_a',
            productId: PLAY_PRODUCT_IDS.MONTHLY,
            orderId: 'GPA.PHASE2-001',
            mode: 'purchase',
          }),
        }),
      ]);

      const statuses = [r1.status, r2.status].sort();
      assert(
        statuses[0] === 200 && statuses[1] === 409,
        `Concurrent duplicate purchase must yield [200, 409], got [${statuses.join(', ')}]`
      );

      const okJson = (r1.status === 200 ? await r1.json() : await r2.json()) as {
        verifiedEntitlementToken?: string;
      };
      const userAToken = okJson.verifiedEntitlementToken!;
      assert(Boolean(userAToken), 'Successful purchase must yield verifiedEntitlementToken');

      // 3c. Verify Firestore persistence NEVER contains raw purchaseToken anywhere
      const rawDbSerialized = JSON.stringify(Array.from(fakeDb.collections.entries()).map(([k, m]) => [k, Array.from(m.entries())]));
      assert(!rawDbSerialized.includes('raw_secret_play_tok_user_a'), 'Raw purchaseToken MUST NEVER be stored in Firestore');
      const tokenHash = hashPurchaseToken('raw_secret_play_tok_user_a');
      const persistedAcrossRestart = await storeInstanceB.getPurchaseRecord(tokenHash);
      assert(persistedAcrossRestart?.userId === 'uid_user_a', 'Firestore must durably persist userId binding across instances');

      // Legacy entitlement migration: remove the new UID index to simulate a pre-index subscriber.
      const legacyUidIndexId = createHash('sha256').update('uid_user_a').digest('hex');
      fakeDb.collections.get(FIRESTORE_COLLECTIONS.USER_ENTITLEMENTS)?.delete(legacyUidIndexId);
      const reconciledLegacyRecord = await storeInstanceB.getPurchaseRecordByUserId('uid_user_a');
      assert(reconciledLegacyRecord?.tokenHash === tokenHash,
        'Legacy subscriber must still resolve from billing_entitlements when user_entitlements index is absent');
      const repairedUidIndex = fakeDb.collections.get(FIRESTORE_COLLECTIONS.USER_ENTITLEMENTS)?.get(legacyUidIndexId);
      assert(repairedUidIndex?.tokenHash === tokenHash,
        'Legacy entitlement lookup must idempotently backfill user_entitlements index');

      // 3c-1. Authenticated entitlement endpoint resolves by Firebase UID, not client tier flags.
      const myEntitlement = await fetch(`${baseUrl}/api/entitlements/me`, {
        headers: { Authorization: 'Bearer valid_fb_user_a', 'X-ExpenseFlow-Entitlement-Tier': 'free' },
      });
      const myEntitlementJson = (await myEntitlement.json()) as { premium?: boolean; tier?: string };
      assert(myEntitlement.status === 200 && myEntitlementJson.premium === true && myEntitlementJson.tier === 'premium',
        'Verified active Play purchase must resolve as Premium for its bound Firebase UID');

      const freeEntitlement = await fetch(`${baseUrl}/api/entitlements/me`, {
        headers: { Authorization: 'Bearer valid_fb_free_user', 'X-ExpenseFlow-Entitlement-Tier': 'premium' },
      });
      const freeEntitlementJson = (await freeEntitlement.json()) as { premium?: boolean; tier?: string };
      assert(freeEntitlement.status === 200 && freeEntitlementJson.premium === false && freeEntitlementJson.tier === 'free',
        'Free Firebase UID must remain Free even when client sends a spoofed Premium header');

      const unauthEntitlement = await fetch(`${baseUrl}/api/entitlements/me`);
      assert(unauthEntitlement.status === 401, 'Entitlement endpoint must reject requests without Firebase ID token');

      // 3d. Cross-user purchase-token rejection (User B cannot verify OR use User A's token on Coach)
      const crossVerify = await fetch(`${baseUrl}/api/billing/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_fb_user_b' },
        body: JSON.stringify({
          purchaseToken: 'raw_secret_play_tok_user_a',
          productId: PLAY_PRODUCT_IDS.MONTHLY,
          mode: 'restore',
        }),
      });
      assert(crossVerify.status === 409, `User B using User A purchaseToken must return 409, got ${crossVerify.status}`);

      const crossCoach = await fetch(`${baseUrl}/api/coach/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_fb_user_b' },
        body: JSON.stringify({ message: 'Use stolen entitlement', entitlementToken: userAToken }),
      });
      assert(crossCoach.status === 403, `User B using User A entitlementToken on AI Coach must return 403, got ${crossCoach.status}`);

      // 3e. Client services attach Firebase ID token automatically via connectAuthProviders()
      const { restore } = installLocalStorageShim();
      try {
        setAuthBackendForTests({
          getCurrentUser: () => ({ uid: 'uid_user_a', email: 'a@example.com', emailVerified: true }),
          getIdToken: async () => 'valid_fb_user_a',
          registerWithEmail: async () => ({ uid: 'uid_user_a', email: 'a@example.com', emailVerified: true }),
          signInWithEmail: async () => ({ uid: 'uid_user_a', email: 'a@example.com', emailVerified: true }),
          signOut: async () => {},
          onAuthStateChanged: () => () => {},
        });
        connectAuthProviders();
        setStoredEntitlementToken(userAToken);

        // Client restore through verifyPurchaseWithServer must auto-attach Bearer valid_fb_user_a
        const clientVerifyRes = await verifyPurchaseWithServer(
          'raw_secret_play_tok_user_a',
          PLAY_PRODUCT_IDS.MONTHLY,
          { mode: 'restore', apiConfigOptions: { isNative: false, origin: baseUrl, apiBaseUrl: baseUrl } }
        );
        assert(clientVerifyRes.success === true, `Client verifyPurchaseWithServer with auth provider must succeed, got ${clientVerifyRes.message}`);

        // Client AI Coach call must auto-attach Firebase ID token and get 200 reply
        const summary = buildSafeFinancialSummary([], { monthlyBudget: 1000, lastUpdated: fixedNowMs }, 'USD');
        const coachClientRes = await sendCoachChatMessage('How am I doing?', [], summary, {
          apiConfigOptions: { isNative: false, origin: baseUrl, apiBaseUrl: baseUrl },
        });
        assert(coachClientRes.success === true, `Client sendCoachChatMessage with auth provider must succeed, got ${coachClientRes.message}`);
      } finally {
        setAuthBackendForTests(null);
        restore();
      }

      // 3f. Durable quota enforcement across separate FirestoreEntitlementStore instances
      // Earlier step consumed 1 request on quotaKey; remaining per-minute limit is 4.
      for (let i = 0; i < 4; i++) {
        const res = await fetch(`${baseUrl}/api/coach/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_fb_user_a' },
          body: JSON.stringify({ message: `Query ${i}`, entitlementToken: userAToken }),
        });
        assert(res.status === 200, `Expected quota call ${i} to succeed (200), got ${res.status}`);
      }
      // 6th call within minute must be rate-limited even via a restarted store check
      const rateLimitedRes = await storeInstanceB.consumeAiQuota(
        `play_tok_${persistedAcrossRestart!.tokenId}`,
        5,
        100,
        fixedNowMs
      );
      assert(rateLimitedRes.allowed === false && rateLimitedRes.reason === 'rate_limited', 'Rate limit must persist across instances');

      // Advance >1 minute & exhaust remaining monthly quota across instances until 100
      let usedCount = rateLimitedRes.monthlyRequestsUsed;
      let t = fixedNowMs + 120_000;
      while (usedCount < 100) {
        t += 65_000;
        const step = await storeInstanceB.consumeAiQuota(`play_tok_${persistedAcrossRestart!.tokenId}`, 5, 100, t);
        assert(step.allowed === true, `Expected monthly quota step ${usedCount + 1} to be allowed`);
        usedCount = step.monthlyRequestsUsed;
      }
      const monthlyExceeded = await storeInstanceA.consumeAiQuota(
        `play_tok_${persistedAcrossRestart!.tokenId}`,
        5,
        100,
        t + 65_000
      );
      assert(
        monthlyExceeded.allowed === false && monthlyExceeded.reason === 'quota_exceeded',
        'Monthly quota must persist and reject >100 requests across restarts'
      );

      // 3g. RTDN deduplication & immediate revocation blocking AI Coach
      const rtdnBody = {
        message: {
          messageId: 'rtdn_phase2_revoke_1',
          data: Buffer.from(
            JSON.stringify({
              packageName: 'com.expenseflow.app',
              subscriptionNotification: {
                notificationType: 12,
                purchaseToken: 'raw_secret_play_tok_user_a',
                subscriptionId: PLAY_PRODUCT_IDS.MONTHLY,
              },
            })
          ).toString('base64'),
        },
      };

      const revokeRes = await fetch(`${baseUrl}/api/billing/rtdn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_pubsub_oidc' },
        body: JSON.stringify(rtdnBody),
      });
      assert(revokeRes.status === 200, 'RTDN revocation must return 200');

      const dedupRes = await fetch(`${baseUrl}/api/billing/rtdn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_pubsub_oidc' },
        body: JSON.stringify(rtdnBody),
      });
      const dedupJson = (await dedupRes.json()) as { deduplicated?: boolean };
      assert(dedupJson.deduplicated === true, 'RTDN duplicate messageId must deduplicate cleanly in Firestore');

      const coachAfterRevoke = await fetch(`${baseUrl}/api/coach/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_fb_user_a' },
        body: JSON.stringify({ message: 'After revoke', entitlementToken: userAToken }),
      });
      assert(coachAfterRevoke.status === 403, `Revoked subscription must immediately return 403 on AI Coach, got ${coachAfterRevoke.status}`);

      console.log('✔ Test 3 Passed: 401 auth, 403 free/cross-user/revoked boundaries, atomic Firestore concurrency & durable quotas verified.');
    } finally {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));

      if (prevSigningSecret !== undefined) process.env.PLAY_BILLING_SIGNING_SECRET = prevSigningSecret;
      else delete process.env.PLAY_BILLING_SIGNING_SECRET;
      if (prevGeminiKey !== undefined) process.env.GEMINI_API_KEY = prevGeminiKey;
      else delete process.env.GEMINI_API_KEY;
      if (prevPubSubAudience !== undefined) process.env.GOOGLE_PUBSUB_AUDIENCE = prevPubSubAudience;
      else delete process.env.GOOGLE_PUBSUB_AUDIENCE;
    }
  }

  // =========================================================================
  // 4. Client Code Secret Hygiene Check (No server secrets in Android/client bundle)
  // =========================================================================
  {
    const clientDirs = ['src/components', 'src/services', 'src/utils'];
    const forbiddenTokens = [
      'PLAY_BILLING_SIGNING_SECRET',
      'FIREBASE_SERVICE_ACCOUNT_KEY',
      'GOOGLE_PLAY_SERVICE_ACCOUNT_KEY',
      'process.env.GEMINI_API_KEY',
      'VITE_GEMINI_API_KEY',
      'firebase-admin',
      'BEGIN PRIVATE KEY',
    ];

    for (const dir of clientDirs) {
      const fullDir = path.join(process.cwd(), dir);
      for (const file of fs.readdirSync(fullDir)) {
        if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue;
        if (file.endsWith('.test.ts')) continue;
        const content = fs.readFileSync(path.join(fullDir, file), 'utf-8');
        for (const secretName of forbiddenTokens) {
          assert(
            !content.includes(secretName),
            `Client file ${dir}/${file} must NEVER reference server secret/module "${secretName}"`
          );
        }
      }
    }

    console.log('✔ Test 4 Passed: Zero server secrets or firebase-admin imports in client source files.');
  }

  // =========================================================================
  // 5. Phase 4.1 — RTDN Unbound Ownership, Lease Deduplication, Retries & Ordering
  // =========================================================================
  {
    const prevSigningSecret = process.env.PLAY_BILLING_SIGNING_SECRET;
    const prevGeminiKey = process.env.GEMINI_API_KEY;
    const prevPubSubAudience = process.env.GOOGLE_PUBSUB_AUDIENCE;

    process.env.PLAY_BILLING_SIGNING_SECRET = 'phase41_firestore_rtdn_secret_32!';
    process.env.GEMINI_API_KEY = 'phase41_dummy_gemini_key';
    process.env.GOOGLE_PUBSUB_AUDIENCE = 'https://api.expenseflow.test/api/billing/rtdn';

    const fakeDb = new FakeFirestoreDatabase();
    const store = new FirestoreEntitlementStore(fakeDb.createDriver());

    const mockPurchases = new Map<string, { data?: SubscriptionPurchaseV2Data; transientError?: number }>();
    let playGetCalls = 0;
    let playAckCalls = 0;
    let fixedNowMs = 1_700_000_000_000;

    const future30dMs = fixedNowMs + 30 * 86_400_000;
    const future60dMs = fixedNowMs + 60 * 86_400_000;

    const mockPublisher: AndroidPublisherLike = {
      purchases: {
        subscriptionsv2: {
          async get({ token }) {
            playGetCalls += 1;
            await new Promise((r) => setTimeout(r, 20));
            const entry = mockPurchases.get(token);
            if (!entry) {
              const err = new Error('Not found') as Error & { code?: number };
              err.code = 404;
              throw err;
            }
            if (entry.transientError) {
              const err = new Error(`Transient Play error ${entry.transientError}`) as Error & { code?: number };
              err.code = entry.transientError;
              throw err;
            }
            return { data: entry.data! };
          },
        },
        subscriptions: {
          async acknowledge({ token }) {
            playAckCalls += 1;
            const entry = mockPurchases.get(token);
            if (entry?.data) {
              entry.data.acknowledgementState = 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED';
            }
            return {};
          },
        },
      },
    };

    const verifyTestFirebaseToken = async (bearer: string) => {
      if (bearer === 'valid_fb_user_a') return { uid: 'uid_user_a', obfuscatedAccountId: 'obf_user_a' };
      if (bearer === 'valid_fb_user_b') return { uid: 'uid_user_b', obfuscatedAccountId: 'obf_user_b' };
      return null;
    };

    const encodeRtdn = (payload: Record<string, unknown>) =>
      Buffer.from(JSON.stringify(payload)).toString('base64');

    const app = await createApp({
      disableVite: true,
      billingDeps: {
        store,
        getPublisher: () => mockPublisher,
        now: () => fixedNowMs,
        rtdnLeaseDurationMs: 5_000,
        verifyCallerToken: verifyTestFirebaseToken,
        verifyPubSubOidcToken: async (bearer, audience) =>
          bearer === 'valid_pubsub_oidc' && audience === process.env.GOOGLE_PUBSUB_AUDIENCE,
      },
      coachDeps: {
        store,
        now: () => fixedNowMs,
        requireFirebaseAuth: true,
        verifyCallerToken: verifyTestFirebaseToken,
        generateReply: async () => 'Coach guidance ok.',
      },
    });

    const server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

    try {
      // 5a. RTDN before initial client verification -> recorded as pending/unbound, NEVER rtdn_unbound, no Premium
      const tokEarly = 'tok_rtdn_before_verify';
      const tokEarlyHash = hashPurchaseToken(tokEarly);
      const tokEarlyId = getTokenIdFromHash(tokEarlyHash);

      mockPurchases.set(tokEarly, {
        data: {
          subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
          acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING',
          latestOrderId: 'GPA.EARLY-001',
          lineItems: [
            {
              productId: PLAY_PRODUCT_IDS.MONTHLY,
              expiryTime: new Date(future30dMs).toISOString(),
              autoRenewingPlan: { autoRenewEnabled: true },
            },
          ],
        },
      });

      const earlyRtdnRes = await fetch(`${baseUrl}/api/billing/rtdn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_pubsub_oidc' },
        body: JSON.stringify({
          message: {
            messageId: 'msg_early_unbound_1',
            data: encodeRtdn({
              packageName: 'com.expenseflow.app',
              eventTimeMillis: String(fixedNowMs + 100),
              subscriptionNotification: {
                notificationType: 4, // SUBSCRIPTION_PURCHASED
                purchaseToken: tokEarly,
                subscriptionId: PLAY_PRODUCT_IDS.MONTHLY,
              },
            }),
          },
        }),
      });
      assert(earlyRtdnRes.status === 200, `Expected 200 for early RTDN, got ${earlyRtdnRes.status}`);
      const earlyRtdnJson = (await earlyRtdnRes.json()) as { status?: string; ownershipStatus?: string };
      assert(earlyRtdnJson.status === 'pending', `Early unbound RTDN must stay pending, got ${earlyRtdnJson.status}`);
      assert(earlyRtdnJson.ownershipStatus === 'unbound', 'Early RTDN must report ownershipStatus=unbound');

      const unboundRec = await store.getPurchaseRecord(tokEarlyHash);
      assert(Boolean(unboundRec), 'Unbound RTDN record must be saved');
      assert(unboundRec!.userId === null, `Unbound record must have userId=null, got ${unboundRec!.userId}`);
      assert(unboundRec!.userId !== 'rtdn_unbound', 'Must NEVER bind userId to rtdn_unbound');
      assert(unboundRec!.status === 'pending', 'Unbound RTDN record must NOT have active status');
      assert(playAckCalls === 0, 'Unbound RTDN must NOT acknowledge purchase before user verification');

      const indexDocBefore = fakeDb.collections.get('billing_token_index')?.get(tokEarlyId);
      assert(indexDocBefore?.userId === null, 'Token index must reflect userId=null while unbound');

      // Even if a client holds a signed token matching tokEarlyId, AI Coach must deny unbound entitlement
      const forgedOrPreToken = generateVerifiedEntitlementToken(PLAY_PRODUCT_IDS.MONTHLY, tokEarly, future30dMs);
      const coachOnUnbound = await fetch(`${baseUrl}/api/coach/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_fb_user_a' },
        body: JSON.stringify({ message: 'Should fail', entitlementToken: forgedOrPreToken }),
      });
      assert(coachOnUnbound.status === 403, `Coach must reject unbound entitlement (403), got ${coachOnUnbound.status}`);

      // 5b. Client verification AFTER unbound RTDN -> establishes real Firebase UID ownership
      const verifyAfterRtdn = await fetch(`${baseUrl}/api/billing/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_fb_user_a' },
        body: JSON.stringify({
          purchaseToken: tokEarly,
          productId: PLAY_PRODUCT_IDS.MONTHLY,
          orderId: 'GPA.EARLY-001',
          mode: 'purchase',
        }),
      });
      assert(verifyAfterRtdn.status === 200, `Authenticated client verify after unbound RTDN must succeed (200), got ${verifyAfterRtdn.status}`);
      const verifyJson = (await verifyAfterRtdn.json()) as {
        success: boolean;
        status: string;
        verifiedEntitlementToken?: string;
      };
      assert(verifyJson.success && verifyJson.status === 'active' && Boolean(verifyJson.verifiedEntitlementToken), 'Verify must activate and issue entitlement token');
      assert(playAckCalls === 1, 'Authenticated client verify must acknowledge purchase with Play');

      const boundRec = await store.getPurchaseRecordByTokenId(tokEarlyId);
      assert(boundRec?.userId === 'uid_user_a' && boundRec?.ownershipStatus === 'bound', 'Token index must resolve bound uid_user_a');

      // Cross-user purchase replay after ownership established -> 409
      const crossUserClaim = await fetch(`${baseUrl}/api/billing/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_fb_user_b' },
        body: JSON.stringify({
          purchaseToken: tokEarly,
          productId: PLAY_PRODUCT_IDS.MONTHLY,
          mode: 'restore',
        }),
      });
      assert(crossUserClaim.status === 409, `Cross-user claim on bound token must return 409, got ${crossUserClaim.status}`);

      // 5c. Subsequent RTDN after ownership established resolves ownership through token index
      mockPurchases.set(tokEarly, {
        data: {
          subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
          acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
          latestOrderId: 'GPA.EARLY-002',
          lineItems: [
            {
              productId: PLAY_PRODUCT_IDS.MONTHLY,
              expiryTime: new Date(future60dMs).toISOString(),
              autoRenewingPlan: { autoRenewEnabled: true },
            },
          ],
        },
      });

      const renewalRtdn = await fetch(`${baseUrl}/api/billing/rtdn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_pubsub_oidc' },
        body: JSON.stringify({
          message: {
            messageId: 'msg_renew_bound_1',
            data: encodeRtdn({
              packageName: 'com.expenseflow.app',
              eventTimeMillis: String(fixedNowMs + 2000),
              subscriptionNotification: {
                notificationType: 2, // SUBSCRIPTION_RENEWED
                purchaseToken: tokEarly,
                subscriptionId: PLAY_PRODUCT_IDS.MONTHLY,
              },
            }),
          },
        }),
      });
      assert(renewalRtdn.status === 200, 'Bound renewal RTDN must return 200');
      const renewedRec = await store.getPurchaseRecordByTokenId(tokEarlyId);
      assert(
        renewedRec?.userId === 'uid_user_a' && renewedRec?.expiryTimeMillis === future60dMs,
        'Subsequent RTDN must preserve uid_user_a and update expiryTimeMillis'
      );

      // 5d. Concurrent duplicate RTDN deliveries -> only 1 Play API call & lease blocks duplicate
      const playCallsBeforeConcurrent = playGetCalls;
      const concurrentMsg = {
        message: {
          messageId: 'msg_concurrent_dup_1',
          data: encodeRtdn({
            packageName: 'com.expenseflow.app',
            eventTimeMillis: String(fixedNowMs + 2500),
            subscriptionNotification: {
              notificationType: 2,
              purchaseToken: tokEarly,
              subscriptionId: PLAY_PRODUCT_IDS.MONTHLY,
            },
          }),
        },
      };

      const [c1, c2] = await Promise.all([
        fetch(`${baseUrl}/api/billing/rtdn`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_pubsub_oidc' },
          body: JSON.stringify(concurrentMsg),
        }),
        fetch(`${baseUrl}/api/billing/rtdn`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_pubsub_oidc' },
          body: JSON.stringify(concurrentMsg),
        }),
      ]);
      const concurrentStatuses = [c1.status, c2.status].sort();
      assert(
        concurrentStatuses[0] === 200 && concurrentStatuses[1] === 409,
        `Concurrent duplicate RTDNs must return [200, 409], got [${concurrentStatuses.join(', ')}]`
      );
      assert(
        playGetCalls === playCallsBeforeConcurrent + 1,
        `Concurrent duplicate RTDNs must trigger exactly 1 Play API lookup, got ${playGetCalls - playCallsBeforeConcurrent}`
      );

      // Post-completion duplicate delivery returns 200 deduplicated without calling Play API
      const postCompleteDup = await fetch(`${baseUrl}/api/billing/rtdn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_pubsub_oidc' },
        body: JSON.stringify(concurrentMsg),
      });
      const postCompleteJson = (await postCompleteDup.json()) as { deduplicated?: boolean };
      assert(postCompleteDup.status === 200 && postCompleteJson.deduplicated === true, 'Completed duplicate must return 200 deduplicated');
      assert(playGetCalls === playCallsBeforeConcurrent + 1, 'Completed duplicate must not invoke Play API');

      // 5e. Retry after transient Play API failure (failed state never permanently completes)
      mockPurchases.set(tokEarly, { transientError: 503 });
      const failMsg = {
        message: {
          messageId: 'msg_transient_fail_1',
          data: encodeRtdn({
            packageName: 'com.expenseflow.app',
            eventTimeMillis: String(fixedNowMs + 3000),
            subscriptionNotification: {
              notificationType: 3, // SUBSCRIPTION_CANCELED
              purchaseToken: tokEarly,
              subscriptionId: PLAY_PRODUCT_IDS.MONTHLY,
            },
          }),
        },
      };
      const failRes = await fetch(`${baseUrl}/api/billing/rtdn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_pubsub_oidc' },
        body: JSON.stringify(failMsg),
      });
      assert(failRes.status === 502, `Transient Play error must return 502, got ${failRes.status}`);
      assert((await store.isNotificationProcessed('msg_transient_fail_1')) === false, 'Failed RTDN must NEVER be marked processed');
      const failedRecord = await store.getRtdnNotificationRecord('msg_transient_fail_1');
      assert(failedRecord?.status === 'failed' && failedRecord?.attempts === 1, 'RTDN record must reflect retryable failed status');

      // Recover Play API & retry same messageId -> succeeds with canceled status retaining paid period
      mockPurchases.set(tokEarly, {
        data: {
          subscriptionState: 'SUBSCRIPTION_STATE_CANCELED',
          acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
          latestOrderId: 'GPA.EARLY-002',
          canceledStateContext: { userInitiatedCancellation: {} },
          lineItems: [
            {
              productId: PLAY_PRODUCT_IDS.MONTHLY,
              expiryTime: new Date(future60dMs).toISOString(),
              autoRenewingPlan: { autoRenewEnabled: false },
            },
          ],
        },
      });

      const retryRes = await fetch(`${baseUrl}/api/billing/rtdn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_pubsub_oidc' },
        body: JSON.stringify(failMsg),
      });
      assert(retryRes.status === 200, `Retry after transient failure must succeed (200), got ${retryRes.status}`);
      assert((await store.isNotificationProcessed('msg_transient_fail_1')) === true, 'Successful retry must mark RTDN completed');
      const completedAfterRetry = await store.getRtdnNotificationRecord('msg_transient_fail_1');
      assert(completedAfterRetry?.status === 'completed' && completedAfterRetry?.attempts === 2, 'Retry must increment attempts and reach completed');

      const canceledRec = await store.getPurchaseRecord(tokEarlyHash);
      assert(
        canceledRec?.status === 'canceled' && canceledRec?.cancelAtPeriodEnd === true && canceledRec?.autoRenewing === false,
        'Canceled subscription must record cancelAtPeriodEnd=true and autoRenewing=false'
      );

      // 5f. Retry allowed after lease expiry (simulating worker crash mid-flight)
      const leaseExpiredAcquire = await store.acquireRtdnProcessingLease('msg_lease_expired_1', {
        eventType: 'SUBSCRIPTION_2',
        nowMs: fixedNowMs,
        leaseDurationMs: 5_000,
      });
      assert(leaseExpiredAcquire.acquired === true, 'Initial lease must succeed');
      const blockedWhileActive = await store.acquireRtdnProcessingLease('msg_lease_expired_1', {
        eventType: 'SUBSCRIPTION_2',
        nowMs: fixedNowMs + 2_000,
        leaseDurationMs: 5_000,
      });
      assert(blockedWhileActive.acquired === false && blockedWhileActive.reason === 'in_progress', 'Active lease must block concurrent claim');

      fixedNowMs += 10_000; // Advance past 5_000ms lease expiry
      const leaseReclaimed = await fetch(`${baseUrl}/api/billing/rtdn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_pubsub_oidc' },
        body: JSON.stringify({
          message: {
            messageId: 'msg_lease_expired_1',
            data: encodeRtdn({
              packageName: 'com.expenseflow.app',
              eventTimeMillis: String(fixedNowMs + 500),
              subscriptionNotification: {
                notificationType: 3,
                purchaseToken: tokEarly,
                subscriptionId: PLAY_PRODUCT_IDS.MONTHLY,
              },
            }),
          },
        }),
      });
      assert(leaseReclaimed.status === 200, `Expired lease must be reclaimable by retry (200), got ${leaseReclaimed.status}`);

      // 5g. Out-of-order stale RTDN must NOT overwrite newer subscription state
      mockPurchases.set(tokEarly, {
        data: {
          subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
          acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
          latestOrderId: 'GPA.EARLY-001',
          lineItems: [
            {
              productId: PLAY_PRODUCT_IDS.MONTHLY,
              expiryTime: new Date(future30dMs).toISOString(),
              autoRenewingPlan: { autoRenewEnabled: true },
            },
          ],
        },
      });
      const staleRtdnRes = await fetch(`${baseUrl}/api/billing/rtdn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_pubsub_oidc' },
        body: JSON.stringify({
          message: {
            messageId: 'msg_stale_old_1',
            data: encodeRtdn({
              packageName: 'com.expenseflow.app',
              eventTimeMillis: String(fixedNowMs - 50_000), // Older than existing lastRtdnEventTimeMillis
              subscriptionNotification: {
                notificationType: 4, // Older delayed PURCHASED notification
                purchaseToken: tokEarly,
                subscriptionId: PLAY_PRODUCT_IDS.MONTHLY,
              },
            }),
          },
        }),
      });
      assert(staleRtdnRes.status === 200, 'Stale notification must ACK cleanly without failing');
      const staleJson = (await staleRtdnRes.json()) as { ignored?: boolean; reason?: string };
      assert(staleJson.ignored === true && staleJson.reason === 'stale_notification', 'Stale notification must be ignored');
      const afterStaleRec = await store.getPurchaseRecord(tokEarlyHash);
      assert(
        afterStaleRec?.status === 'canceled' &&
          afterStaleRec?.expiryTimeMillis === future60dMs &&
          afterStaleRec?.autoRenewing === false,
        'Stale out-of-order RTDN MUST NOT overwrite newer canceled/expiry state'
      );

      // 5h. Revocation via RTDN blocks bound token on AI Coach AND revocation on unbound token blocks future verify
      const revokeBoundRes = await fetch(`${baseUrl}/api/billing/rtdn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_pubsub_oidc' },
        body: JSON.stringify({
          message: {
            messageId: 'msg_revoke_bound_1',
            data: encodeRtdn({
              packageName: 'com.expenseflow.app',
              eventTimeMillis: String(fixedNowMs + 20_000),
              subscriptionNotification: {
                notificationType: 12,
                purchaseToken: tokEarly,
                subscriptionId: PLAY_PRODUCT_IDS.MONTHLY,
              },
            }),
          },
        }),
      });
      assert(revokeBoundRes.status === 200, 'Bound revocation RTDN must succeed');
      const coachDeniedAfterRevoke = await fetch(`${baseUrl}/api/coach/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_fb_user_a' },
        body: JSON.stringify({ message: 'Blocked?', entitlementToken: verifyJson.verifiedEntitlementToken }),
      });
      assert(coachDeniedAfterRevoke.status === 403, `Coach must immediately return 403 after bound revocation, got ${coachDeniedAfterRevoke.status}`);

      // Unbound token revoked via RTDN before client verify -> future verify rejected (403)
      const tokUnboundRevoked = 'tok_unbound_revoked_1';
      mockPurchases.set(tokUnboundRevoked, {
        data: {
          subscriptionState: 'SUBSCRIPTION_STATE_REVOKED',
          acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
          latestOrderId: 'GPA.REV-UNBOUND-1',
          lineItems: [
            {
              productId: PLAY_PRODUCT_IDS.MONTHLY,
              expiryTime: new Date(fixedNowMs - 1000).toISOString(),
            },
          ],
        },
      });
      const revokeUnboundRtdn = await fetch(`${baseUrl}/api/billing/rtdn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_pubsub_oidc' },
        body: JSON.stringify({
          message: {
            messageId: 'msg_revoke_unbound_1',
            data: encodeRtdn({
              packageName: 'com.expenseflow.app',
              eventTimeMillis: String(fixedNowMs + 25_000),
              subscriptionNotification: {
                notificationType: 12,
                purchaseToken: tokUnboundRevoked,
                subscriptionId: PLAY_PRODUCT_IDS.MONTHLY,
              },
            }),
          },
        }),
      });
      assert(revokeUnboundRtdn.status === 200, 'Unbound revocation RTDN must return 200');
      const claimRevokedUnbound = await fetch(`${baseUrl}/api/billing/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_fb_user_a' },
        body: JSON.stringify({
          purchaseToken: tokUnboundRevoked,
          productId: PLAY_PRODUCT_IDS.MONTHLY,
          mode: 'purchase',
        }),
      });
      assert(claimRevokedUnbound.status === 403, `Client claim on revoked unbound token must return 403, got ${claimRevokedUnbound.status}`);

      console.log('✔ Test 5 Passed: Phase 4.1 RTDN unbound ownership, token-index binding, lease deduplication, retries & out-of-order safety verified.');
    } finally {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));

      if (prevSigningSecret !== undefined) process.env.PLAY_BILLING_SIGNING_SECRET = prevSigningSecret;
      else delete process.env.PLAY_BILLING_SIGNING_SECRET;
      if (prevGeminiKey !== undefined) process.env.GEMINI_API_KEY = prevGeminiKey;
      else delete process.env.GEMINI_API_KEY;
      if (prevPubSubAudience !== undefined) process.env.GOOGLE_PUBSUB_AUDIENCE = prevPubSubAudience;
      else delete process.env.GOOGLE_PUBSUB_AUDIENCE;
    }
  }

  console.log('=== All Phase 2 Firebase Auth & Firestore Persistence Tests Passed ===');
}

runPhase2Tests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Phase 2 Test Suite Failed:', err);
    process.exit(1);
  });
