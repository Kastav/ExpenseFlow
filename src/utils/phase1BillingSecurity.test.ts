/**
 * Phase 1 Critical P0 Security, Connectivity, Lifecycle & Native Bridge Tests.
 *
 * Exercises real Express HTTP endpoints (server.ts), durable FileEntitlementStore,
 * Play Billing verification engine, AI Coach revocation boundary, API URL resolution,
 * Android Capacitor CORS preflight, and client purchase/restore/ack/sync flows.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { createApp } from '../../server';
import { FileEntitlementStore } from '../server/entitlementStore';
import {
  AndroidPublisherLike,
  SubscriptionPurchaseV2Data,
  generateVerifiedEntitlementToken,
  parseVerifiedEntitlementToken,
} from '../server/playBillingVerification';
import { ApiConfigurationError, resolveApiUrl } from './apiConfig';
import { PLAY_PRODUCT_IDS } from '../types/billing';
import {
  initiateSubscriptionPurchase,
  restoreSubscriptionPurchases,
  syncSubscriptionOnAppActive,
  getStoredSubscriptionEntitlement,
  setBillingAuthTokenProvider,
  setNativeBillingBridgeForTests,
  clearLocalSubscriptionEntitlement,
} from '../services/playBillingService';
import { getCurrentUserPlanTier } from './premium';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

interface MockPlayRecord {
  statusCode?: number;
  data?: SubscriptionPurchaseV2Data;
  ackError?: Error;
}

function installLocalStorageShim(): () => void {
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

  return () => {
    if (prevWindow === undefined) {
      delete (globalThis as Record<string, unknown>).window;
    } else {
      (globalThis as Record<string, unknown>).window = prevWindow;
    }
  };
}

async function runPhase1Tests() {
  console.log('--- Starting Phase 1 Billing & Security Integration Tests ---');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'expenseflow-phase1-test-'));
  const storePath = path.join(tmpDir, 'entitlements.json');
  const store = new FileEntitlementStore(storePath);

  const prevSigningSecret = process.env.PLAY_BILLING_SIGNING_SECRET;
  const prevGeminiKey = process.env.GEMINI_API_KEY;
  const prevPubSubAudience = process.env.GOOGLE_PUBSUB_AUDIENCE;

  process.env.PLAY_BILLING_SIGNING_SECRET = 'phase1_test_signing_secret_32_chars!!';
  process.env.GEMINI_API_KEY = 'phase1_dummy_gemini_key_for_route_test';
  process.env.GOOGLE_PUBSUB_AUDIENCE = 'https://api.expenseflow.test/api/billing/rtdn';

  const mockPurchases = new Map<string, MockPlayRecord>();
  const ackCalls: Array<{ packageName: string; subscriptionId: string; token: string }> = [];

  const mockPublisher: AndroidPublisherLike = {
    purchases: {
      subscriptionsv2: {
        async get({ packageName, token }) {
          assert(packageName === 'com.expenseflow.app', `Unexpected packageName: ${packageName}`);
          const entry = mockPurchases.get(token);
          if (!entry) {
            const err = new Error('Purchase token not found') as Error & { code?: number };
            err.code = 404;
            throw err;
          }
          if (entry.statusCode && entry.statusCode >= 400) {
            const err = new Error(`Mock Play API error ${entry.statusCode}`) as Error & { code?: number };
            err.code = entry.statusCode;
            throw err;
          }
          return { data: entry.data ?? null };
        },
      },
      subscriptions: {
        async acknowledge({ packageName, subscriptionId, token }) {
          ackCalls.push({ packageName, subscriptionId, token });
          const entry = mockPurchases.get(token);
          if (entry?.ackError) {
            throw entry.ackError;
          }
          if (entry?.data) {
            entry.data.acknowledgementState = 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED';
          }
          return {};
        },
      },
    },
  };

  let fixedNowMs = Date.now();
  const app = await createApp({
    disableVite: true,
    billingDeps: {
      store,
      getPublisher: () => mockPublisher,
      now: () => fixedNowMs,
      verifyCallerToken: async (bearerToken: string) => {
        if (bearerToken === 'valid_user_a') {
          return { uid: 'user_a', obfuscatedAccountId: 'obf_user_a' };
        }
        if (bearerToken === 'valid_user_b') {
          return { uid: 'user_b', obfuscatedAccountId: 'obf_user_b' };
        }
        return null;
      },
      verifyPubSubOidcToken: async (bearerToken: string, audience: string) => {
        return bearerToken === 'valid_pubsub_oidc' && audience === process.env.GOOGLE_PUBSUB_AUDIENCE;
      },
    },
    coachDeps: {
      store,
      now: () => fixedNowMs,
      generateReply: async () => 'Stay under your daily dining cap today.',
    },
  });

  const server = await new Promise<http.Server>((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
  });

  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const futureIso = () => new Date(fixedNowMs + 30 * 24 * 60 * 60 * 1000).toISOString();
    const pastIso = () => new Date(fixedNowMs - 24 * 60 * 60 * 1000).toISOString();

    // 10. API URL resolution tests (Task 1 & Task 5 #10)
    {
      assert(
        resolveApiUrl('/api/billing/verify', {
          isNative: true,
          origin: 'https://localhost',
          apiBaseUrl: 'https://api.expenseflow.example.com/',
        }) === 'https://api.expenseflow.example.com/api/billing/verify',
        'Android native with HTTPS VITE_API_BASE_URL must resolve full HTTPS endpoint'
      );

      let missingAndroidThrew = false;
      try {
        resolveApiUrl('/api/billing/verify', {
          isNative: true,
          origin: 'https://localhost',
          apiBaseUrl: '',
        });
      } catch (err) {
        missingAndroidThrew = err instanceof ApiConfigurationError;
      }
      assert(missingAndroidThrew, 'Android native without VITE_API_BASE_URL must throw ApiConfigurationError');

      let httpAndroidThrew = false;
      try {
        resolveApiUrl('/api/coach/chat', {
          isNative: true,
          origin: 'https://localhost',
          apiBaseUrl: 'http://api.expenseflow.example.com',
        });
      } catch (err) {
        httpAndroidThrew = err instanceof ApiConfigurationError;
      }
      assert(httpAndroidThrew, 'Android native with http:// VITE_API_BASE_URL must throw ApiConfigurationError');

      let localhostAndroidThrew = false;
      try {
        resolveApiUrl('/api/billing/verify', {
          isNative: true,
          origin: 'https://localhost',
          apiBaseUrl: 'https://localhost:3000',
        });
      } catch (err) {
        localhostAndroidThrew = err instanceof ApiConfigurationError;
      }
      assert(localhostAndroidThrew, 'Android native targeting localhost must throw ApiConfigurationError');

      assert(
        resolveApiUrl('/api/billing/verify', {
          isNative: false,
          origin: 'http://localhost:3000',
          apiBaseUrl: '',
        }) === '/api/billing/verify',
        'Web dev mode without VITE_API_BASE_URL must preserve relative /api/* URL'
      );

      console.log('✔ Case 10 Passed: API URL resolution validated for Android HTTPS & Web dev.');
    }

    // 11. Android CORS preflight tests (Task 1 & Task 5 #11)
    {
      const capacitorPreflight = await fetch(`${baseUrl}/api/billing/verify`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://localhost',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type, Authorization',
        },
      });
      assert(capacitorPreflight.status === 204, `Expected 204 preflight, got ${capacitorPreflight.status}`);
      assert(
        capacitorPreflight.headers.get('access-control-allow-origin') === 'https://localhost',
        'Capacitor Android origin https://localhost must be explicitly echoed in ACAO'
      );
      assert(
        capacitorPreflight.headers.get('access-control-allow-origin') !== '*',
        'CORS must never return wildcard *'
      );

      const evilPreflight = await fetch(`${baseUrl}/api/billing/verify`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://untrusted-attacker.example',
          'Access-Control-Request-Method': 'POST',
        },
      });
      assert(
        evilPreflight.headers.get('access-control-allow-origin') === null,
        'Untrusted origin must not receive Access-Control-Allow-Origin header'
      );

      console.log('✔ Case 11 Passed: Android CORS preflight verified without wildcard CORS.');
    }

    // 9. Unauthorized verification request (Task 2 & Task 5 #9)
    {
      const noAuthRes = await fetch(`${baseUrl}/api/billing/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purchaseToken: 'tok_any',
          productId: PLAY_PRODUCT_IDS.MONTHLY,
          packageName: 'com.expenseflow.app',
        }),
      });
      assert(noAuthRes.status === 401, `Expected 401 for missing Bearer token, got ${noAuthRes.status}`);
      const noAuthJson = (await noAuthRes.json()) as { status: string; success: boolean };
      assert(noAuthJson.success === false && noAuthJson.status === 'unauthorized', 'Expected unauthorized status');

      const badAuthRes = await fetch(`${baseUrl}/api/billing/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer forged_token',
        },
        body: JSON.stringify({
          purchaseToken: 'tok_any',
          productId: PLAY_PRODUCT_IDS.MONTHLY,
          packageName: 'com.expenseflow.app',
        }),
      });
      assert(badAuthRes.status === 401, `Expected 401 for invalid Bearer token, got ${badAuthRes.status}`);

      console.log('✔ Case 9 Passed: Unauthorized purchase verification requests rejected (401).');
    }

    // 1. Product ID mismatch (Task 2 & Task 5 #1)
    {
      mockPurchases.set('tok_mismatch', {
        data: {
          subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
          acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING',
          latestOrderId: 'GPA.MISMATCH-1',
          lineItems: [
            {
              productId: PLAY_PRODUCT_IDS.MONTHLY,
              expiryTime: futureIso(),
              autoRenewingPlan: { autoRenewEnabled: true },
            },
          ],
        },
      });

      const res = await fetch(`${baseUrl}/api/billing/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid_user_a',
        },
        body: JSON.stringify({
          purchaseToken: 'tok_mismatch',
          productId: PLAY_PRODUCT_IDS.ANNUAL,
          packageName: 'com.expenseflow.app',
        }),
      });
      assert(res.status === 400, `Expected 400 on product mismatch, got ${res.status}`);
      const json = (await res.json()) as { success: boolean; status: string };
      assert(json.success === false && json.status === 'invalid', 'Product ID mismatch must return invalid');

      console.log('✔ Case 1 Passed: Google Play lineItems[0].productId mismatch rejected (400).');
    }

    // 2. Invalid purchase token (Task 2 & Task 5 #2)
    {
      const res = await fetch(`${baseUrl}/api/billing/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid_user_a',
        },
        body: JSON.stringify({
          purchaseToken: 'nonexistent_invalid_token_xyz',
          productId: PLAY_PRODUCT_IDS.MONTHLY,
          packageName: 'com.expenseflow.app',
        }),
      });
      assert(res.status === 404, `Expected 404 on nonexistent token, got ${res.status}`);
      const json = (await res.json()) as { success: boolean; status: string };
      assert(json.success === false && json.status === 'invalid', 'Invalid purchase token must return invalid');

      console.log('✔ Case 2 Passed: Invalid purchase token rejected (404 invalid).');
    }

    // 4. Pending purchase (Task 2 & Task 5 #4)
    {
      mockPurchases.set('tok_pending', {
        data: {
          subscriptionState: 'SUBSCRIPTION_STATE_PENDING',
          acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING',
          latestOrderId: 'GPA.PENDING-1',
          lineItems: [
            {
              productId: PLAY_PRODUCT_IDS.MONTHLY,
              expiryTime: futureIso(),
            },
          ],
        },
      });

      const res = await fetch(`${baseUrl}/api/billing/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid_user_a',
        },
        body: JSON.stringify({
          purchaseToken: 'tok_pending',
          productId: PLAY_PRODUCT_IDS.MONTHLY,
          packageName: 'com.expenseflow.app',
        }),
      });
      const json = (await res.json()) as { success: boolean; status: string; verifiedEntitlementToken?: string };
      assert(json.success === false && json.status === 'pending', 'Pending purchase must not unlock Premium');
      assert(!json.verifiedEntitlementToken, 'Pending purchase must never issue verifiedEntitlementToken');

      console.log('✔ Case 4 Passed: Pending purchase rejected without entitlement token.');
    }

    // 5. Active subscription + server-side acknowledgement + 3. Replayed token (Task 2 & Task 5 #3, #5)
    let issuedTokenForActive = '';
    {
      mockPurchases.set('tok_active_1', {
        data: {
          subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
          acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING',
          latestOrderId: 'GPA.ACTIVE-1',
          externalAccountIdentifiers: { obfuscatedExternalAccountId: 'obf_user_a' },
          lineItems: [
            {
              productId: PLAY_PRODUCT_IDS.ANNUAL,
              expiryTime: futureIso(),
              autoRenewingPlan: { autoRenewEnabled: true },
            },
          ],
        },
      });

      const ackCountBefore = ackCalls.length;
      const res = await fetch(`${baseUrl}/api/billing/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid_user_a',
        },
        body: JSON.stringify({
          purchaseToken: 'tok_active_1',
          productId: PLAY_PRODUCT_IDS.ANNUAL,
          packageName: 'com.expenseflow.app',
          orderId: 'GPA.ACTIVE-1',
          mode: 'purchase',
        }),
      });
      assert(res.status === 200, `Expected 200 on active subscription, got ${res.status}`);
      const json = (await res.json()) as {
        success: boolean;
        status: string;
        acknowledged?: boolean;
        autoRenewing?: boolean;
        cancelAtPeriodEnd?: boolean;
        verifiedEntitlementToken?: string;
      };
      assert(json.success === true && json.status === 'active', 'Active subscription must succeed');
      assert(json.acknowledged === true, 'Active subscription must be server-acknowledged');
      assert(json.autoRenewing === true && json.cancelAtPeriodEnd === false, 'Active autoRenewing must be true');
      assert(Boolean(json.verifiedEntitlementToken), 'Must issue verifiedEntitlementToken');
      assert(ackCalls.length === ackCountBefore + 1, 'Server must invoke Play acknowledge API once');
      issuedTokenForActive = json.verifiedEntitlementToken!;

      // Replay check A: Duplicate initial 'purchase' claim by same user -> 409 'replayed'
      const dupRes = await fetch(`${baseUrl}/api/billing/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid_user_a',
        },
        body: JSON.stringify({
          purchaseToken: 'tok_active_1',
          productId: PLAY_PRODUCT_IDS.ANNUAL,
          packageName: 'com.expenseflow.app',
          orderId: 'GPA.ACTIVE-1',
          mode: 'purchase',
        }),
      });
      assert(dupRes.status === 409, `Expected 409 on duplicate purchase replay, got ${dupRes.status}`);
      const dupJson = (await dupRes.json()) as { status: string };
      assert(dupJson.status === 'replayed', 'Duplicate purchase claim must return status=replayed');

      // Replay check B: Different authenticated user (user_b) attempting even mode:'restore' -> 409 'replayed'
      const crossUserRes = await fetch(`${baseUrl}/api/billing/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid_user_b',
        },
        body: JSON.stringify({
          purchaseToken: 'tok_active_1',
          productId: PLAY_PRODUCT_IDS.ANNUAL,
          packageName: 'com.expenseflow.app',
          mode: 'restore',
        }),
      });
      assert(crossUserRes.status === 409, `Expected 409 on cross-user replay, got ${crossUserRes.status}`);
      const crossJson = (await crossUserRes.json()) as { status: string };
      assert(crossJson.status === 'replayed', 'Cross-user token reuse must return status=replayed');

      // Durable record persists across fresh store instance reload (simulating server restart)
      const reloadedStore = new FileEntitlementStore(storePath);
      const parsedActiveToken = parseVerifiedEntitlementToken(issuedTokenForActive);
      assert(Boolean(parsedActiveToken?.tokenId), 'Issued token must parse tokenId cleanly');
      const reloadedRecord = await reloadedStore.getPurchaseRecordByTokenId(
        parsedActiveToken!.tokenId
      );
      assert(reloadedRecord?.userId === 'user_a', 'Entitlement store must durably persist userId binding on disk');

      console.log('✔ Cases 3 & 5 Passed: Active purchase acknowledged server-side; duplicate & cross-user replays blocked (409).');
    }

    // 6. Canceled-but-still-paid subscription (Task 2, 3 & Task 5 #6)
    {
      mockPurchases.set('tok_canceled_paid', {
        data: {
          subscriptionState: 'SUBSCRIPTION_STATE_CANCELED',
          acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
          latestOrderId: 'GPA.CANCEL-PAID-1',
          canceledStateContext: { userInitiatedCancellation: {} },
          lineItems: [
            {
              productId: PLAY_PRODUCT_IDS.MONTHLY,
              expiryTime: futureIso(),
              autoRenewingPlan: { autoRenewEnabled: false },
            },
          ],
        },
      });

      const res = await fetch(`${baseUrl}/api/billing/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid_user_a',
        },
        body: JSON.stringify({
          purchaseToken: 'tok_canceled_paid',
          productId: PLAY_PRODUCT_IDS.MONTHLY,
          packageName: 'com.expenseflow.app',
          mode: 'restore',
        }),
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const json = (await res.json()) as {
        success: boolean;
        status: string;
        autoRenewing?: boolean;
        cancelAtPeriodEnd?: boolean;
        verifiedEntitlementToken?: string;
      };
      assert(json.success === true && json.status === 'active', 'Canceled subscription with future expiry must remain active');
      assert(json.autoRenewing === false && json.cancelAtPeriodEnd === true, 'Must flag autoRenewing=false & cancelAtPeriodEnd=true');
      assert(Boolean(json.verifiedEntitlementToken), 'Must issue valid entitlement token until period end');

      console.log('✔ Case 6 Passed: Canceled subscription retains paid access until expiryTimeMillis.');
    }

    // 7. Expired subscription (Task 2 & Task 5 #7)
    {
      mockPurchases.set('tok_expired', {
        data: {
          subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED',
          acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
          latestOrderId: 'GPA.EXP-1',
          lineItems: [
            {
              productId: PLAY_PRODUCT_IDS.MONTHLY,
              expiryTime: pastIso(),
            },
          ],
        },
      });

      const res = await fetch(`${baseUrl}/api/billing/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid_user_a',
        },
        body: JSON.stringify({
          purchaseToken: 'tok_expired',
          productId: PLAY_PRODUCT_IDS.MONTHLY,
          packageName: 'com.expenseflow.app',
          mode: 'restore',
        }),
      });
      const json = (await res.json()) as { success: boolean; status: string; verifiedEntitlementToken?: string };
      assert(json.success === false && json.status === 'expired', 'Expired subscription must return expired');
      assert(!json.verifiedEntitlementToken, 'Expired subscription must not issue token');

      console.log('✔ Case 7 Passed: Expired subscription rejected.');
    }

    // 8. Revoked purchase + immediate AI Coach denial + RTDN idempotency (Task 2, 3 & Task 5 #8)
    {
      // Confirm active coach works before revocation
      const coachBefore = await fetch(`${baseUrl}/api/coach/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${issuedTokenForActive}`,
        },
        body: JSON.stringify({ message: 'How am I pacing?' }),
      });
      assert(coachBefore.status === 200, `Expected active token to access coach (200), got ${coachBefore.status}`);

      // Revoke via Play state & RTDN
      mockPurchases.set('tok_active_1', {
        data: {
          subscriptionState: 'SUBSCRIPTION_STATE_REVOKED',
          acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
          latestOrderId: 'GPA.ACTIVE-1',
          lineItems: [
            {
              productId: PLAY_PRODUCT_IDS.ANNUAL,
              expiryTime: pastIso(),
            },
          ],
        },
      });

      // Simulate RTDN SUBSCRIPTION_REVOKED (notificationType: 12)
      const rtdnPayload = Buffer.from(
        JSON.stringify({
          packageName: 'com.expenseflow.app',
          subscriptionNotification: {
            notificationType: 12,
            purchaseToken: 'tok_active_1',
            subscriptionId: PLAY_PRODUCT_IDS.ANNUAL,
          },
        })
      ).toString('base64');

      const rtdnRes = await fetch(`${baseUrl}/api/billing/rtdn`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid_pubsub_oidc',
        },
        body: JSON.stringify({
          message: {
            messageId: 'rtdn_msg_revoke_1',
            data: rtdnPayload,
          },
        }),
      });
      assert(rtdnRes.status === 200, `Expected RTDN 200, got ${rtdnRes.status}`);

      // Verify RTDN deduplication on duplicate messageId
      const rtdnDupRes = await fetch(`${baseUrl}/api/billing/rtdn`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid_pubsub_oidc',
        },
        body: JSON.stringify({
          message: {
            messageId: 'rtdn_msg_revoke_1',
            data: rtdnPayload,
          },
        }),
      });
      const rtdnDupJson = (await rtdnDupRes.json()) as { deduplicated?: boolean };
      assert(rtdnDupJson.deduplicated === true, 'Duplicate RTDN messageId must be deduplicated cleanly');

      // Verify /api/billing/verify rejects revoked purchase
      const verifyRevoked = await fetch(`${baseUrl}/api/billing/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid_user_a',
        },
        body: JSON.stringify({
          purchaseToken: 'tok_active_1',
          productId: PLAY_PRODUCT_IDS.ANNUAL,
          packageName: 'com.expenseflow.app',
          mode: 'restore',
        }),
      });
      const verifyRevokedJson = (await verifyRevoked.json()) as { success: boolean; status: string };
      assert(verifyRevokedJson.success === false && verifyRevokedJson.status === 'revoked', 'Revoked token must fail verification');

      // Verify previously issued entitlement token is IMMEDIATELY denied by /api/coach/chat
      const coachAfter = await fetch(`${baseUrl}/api/coach/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${issuedTokenForActive}`,
        },
        body: JSON.stringify({ message: 'Still active?' }),
      });
      assert(coachAfter.status === 403, `Expected 403 on revoked token for coach/chat, got ${coachAfter.status}`);

      console.log('✔ Case 8 Passed: Revoked purchase rejected, RTDN deduplicated, and AI Coach immediately returns 403.');
    }

    // 12. Server & Client acknowledgement failure, restore flow, PENDING client guard & startup/resume sync (Task 3, 4 & Task 5 #12)
    {
      // 12a. Server-side Play acknowledge API failure -> HTTP 502 & no entitlement token
      mockPurchases.set('tok_server_ack_fail', {
        data: {
          subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
          acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING',
          latestOrderId: 'GPA.ACKFAIL-1',
          lineItems: [
            {
              productId: PLAY_PRODUCT_IDS.MONTHLY,
              expiryTime: futureIso(),
              autoRenewingPlan: { autoRenewEnabled: true },
            },
          ],
        },
        ackError: new Error('Play acknowledge transient 503'),
      });

      const serverAckFailRes = await fetch(`${baseUrl}/api/billing/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid_user_a',
        },
        body: JSON.stringify({
          purchaseToken: 'tok_server_ack_fail',
          productId: PLAY_PRODUCT_IDS.MONTHLY,
          packageName: 'com.expenseflow.app',
        }),
      });
      assert(serverAckFailRes.status === 502, `Expected 502 when Play acknowledge fails, got ${serverAckFailRes.status}`);
      const ackFailJson = (await serverAckFailRes.json()) as {
        success: boolean;
        acknowledged?: boolean;
        verifiedEntitlementToken?: string;
      };
      assert(ackFailJson.success === false && ackFailJson.acknowledged === false, 'Ack failure must fail closed');
      assert(!ackFailJson.verifiedEntitlementToken, 'Ack failure must not issue verifiedEntitlementToken');

      // 12b. Client-side purchase / restore / ack error / startup sync tests with localStorage + bridge mocks
      const restoreWindow = installLocalStorageShim();
      try {
        clearLocalSubscriptionEntitlement();
        setBillingAuthTokenProvider(async () => 'valid_user_a');

        // Case i: PENDING native purchase must NEVER unlock Premium
        setNativeBillingBridgeForTests(
          {
            isAvailable: async () => ({ available: true, platform: 'android' }),
            queryProductDetails: async () => ({ products: [] }),
            launchBillingFlow: async () => ({
              success: true,
              purchases: [
                {
                  orderId: 'GPA.CLIENT-PENDING',
                  productId: PLAY_PRODUCT_IDS.MONTHLY,
                  purchaseToken: 'tok_client_pending',
                  purchaseTime: fixedNowMs,
                  purchaseState: 'PENDING',
                  isAcknowledged: false,
                },
              ],
            }),
            queryPurchases: async () => ({
              purchases: [
                {
                  orderId: 'GPA.CLIENT-PENDING',
                  productId: PLAY_PRODUCT_IDS.MONTHLY,
                  purchaseToken: 'tok_client_pending',
                  purchaseTime: fixedNowMs,
                  purchaseState: 'PENDING',
                  isAcknowledged: false,
                },
              ],
            }),
            acknowledgePurchase: async () => ({ success: true, purchaseToken: 'tok_client_pending' }),
          },
          true
        );

        const pendingBuy = await initiateSubscriptionPurchase(PLAY_PRODUCT_IDS.MONTHLY, {
          apiConfigOptions: { isNative: false, origin: baseUrl, apiBaseUrl: baseUrl },
        });
        assert(pendingBuy.success === false && pendingBuy.status === 'pending', 'Client purchase with PENDING must return pending');
        assert(getCurrentUserPlanTier() === 'free', 'PENDING purchase must never unlock Premium tier');

        const pendingRestore = await restoreSubscriptionPurchases({
          apiConfigOptions: { isNative: false, origin: baseUrl, apiBaseUrl: baseUrl },
        });
        assert(pendingRestore.restored === false && pendingRestore.status === 'pending', 'Restore of PENDING purchase must not unlock Premium');
        assert(getCurrentUserPlanTier() === 'free', 'PENDING restore must keep user Free');

        // Case ii: Client acknowledgement error guard — verify restore against mock server where ack is needed & native ack rejects
        const unackValidToken = 'tok_restore_client_ack_fail';
        mockPurchases.set(unackValidToken, {
          data: {
            // Simulate already marked ack on server OR test native ack path cleanly using direct fetch mock?
            //Wait: our real server ack succeeds unless ackError, returning acknowledged:true.
            // To test client-side native ack failure handling specifically when server returns acknowledged:false:
            // Let's test both: first a real restore against server, plus an explicit client-ack-failure mock!
            subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
            acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
            latestOrderId: 'GPA.RESTORE-OK-1',
            lineItems: [
              {
                productId: PLAY_PRODUCT_IDS.MONTHLY,
                expiryTime: futureIso(),
                autoRenewingPlan: { autoRenewEnabled: true },
              },
            ],
          },
        });

        // Test client-side ack failure when server response requires client acknowledgement (acknowledged: false)
        const origFetch = globalThis.fetch;
        const fakeSigned = generateVerifiedEntitlementToken(
          PLAY_PRODUCT_IDS.MONTHLY,
          unackValidToken,
          fixedNowMs + 86_400_000
        );
        globalThis.fetch = (async () =>
          new Response(
            JSON.stringify({
              success: true,
              status: 'active',
              productId: PLAY_PRODUCT_IDS.MONTHLY,
              expiryTimeMillis: fixedNowMs + 86_400_000,
              autoRenewing: true,
              acknowledged: false,
              verifiedEntitlementToken: fakeSigned,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )) as typeof fetch;

        try {
          setNativeBillingBridgeForTests(
            {
              isAvailable: async () => ({ available: true, platform: 'android' }),
              queryProductDetails: async () => ({ products: [] }),
              launchBillingFlow: async () => ({ success: false, purchases: [] }),
              queryPurchases: async () => ({
                purchases: [
                  {
                    orderId: 'GPA.RESTORE-ACK-ERR',
                    productId: PLAY_PRODUCT_IDS.MONTHLY,
                    purchaseToken: unackValidToken,
                    purchaseTime: fixedNowMs,
                    purchaseState: 'PURCHASED',
                    isAcknowledged: false,
                  },
                ],
              }),
              acknowledgePurchase: async () => {
                throw new Error('Billing service disconnected during acknowledge');
              },
            },
            true
          );

          const ackErrRestore = await restoreSubscriptionPurchases({
            apiConfigOptions: { isNative: false, origin: baseUrl, apiBaseUrl: baseUrl },
          });
          assert(ackErrRestore.restored === false, 'Restore must fail if required native acknowledgePurchase throws');
          assert(getCurrentUserPlanTier() === 'free', 'Ack error must NOT unlock Premium tier');
        } finally {
          globalThis.fetch = origFetch;
        }

        // Case iii: Real HTTP restore & startup/resume sync -> active -> revoked clears local Premium
        mockPurchases.set('tok_restore_real_1', {
          data: {
            subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
            acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING',
            latestOrderId: 'GPA.RESTORE-REAL-1',
            lineItems: [
              {
                productId: PLAY_PRODUCT_IDS.ANNUAL,
                expiryTime: futureIso(),
                autoRenewingPlan: { autoRenewEnabled: true },
              },
            ],
          },
        });

        setNativeBillingBridgeForTests(
          {
            isAvailable: async () => ({ available: true, platform: 'android' }),
            queryProductDetails: async () => ({ products: [] }),
            launchBillingFlow: async () => ({ success: false, purchases: [] }),
            queryPurchases: async () => ({
              purchases: [
                {
                  orderId: 'GPA.RESTORE-REAL-1',
                  productId: PLAY_PRODUCT_IDS.ANNUAL,
                  purchaseToken: 'tok_restore_real_1',
                  purchaseTime: fixedNowMs,
                  purchaseState: 'PURCHASED',
                  isAcknowledged: false,
                },
              ],
            }),
            acknowledgePurchase: async () => ({ success: true, purchaseToken: 'tok_restore_real_1' }),
          },
          true
        );

        const realRestore = await restoreSubscriptionPurchases({
          apiConfigOptions: { isNative: false, origin: baseUrl, apiBaseUrl: baseUrl },
        });
        assert(realRestore.restored === true, `Expected real restore to succeed, got: ${realRestore.message}`);
        assert(getCurrentUserPlanTier() === 'premium', 'Restored subscription must unlock Premium');
        assert(
          getStoredSubscriptionEntitlement().productId === PLAY_PRODUCT_IDS.ANNUAL,
          'Stored entitlement must match restored annual SKU'
        );

        // Now mark purchase revoked on Play & run syncSubscriptionOnAppActive() (startup/resume check)
        mockPurchases.set('tok_restore_real_1', {
          data: {
            subscriptionState: 'SUBSCRIPTION_STATE_REVOKED',
            acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
            latestOrderId: 'GPA.RESTORE-REAL-1',
            lineItems: [
              {
                productId: PLAY_PRODUCT_IDS.ANNUAL,
                expiryTime: pastIso(),
              },
            ],
          },
        });

        const syncAfterRevoke = await syncSubscriptionOnAppActive({
          force: true,
          verifyOptions: { apiConfigOptions: { isNative: false, origin: baseUrl, apiBaseUrl: baseUrl } },
        });
        assert(syncAfterRevoke.tier === 'free', 'Startup/resume sync must downgrade revoked subscription to free');
        assert(getCurrentUserPlanTier() === 'free', 'Local entitlement must be cleared after revocation sync');
      } finally {
        setNativeBillingBridgeForTests(null, null);
        setBillingAuthTokenProvider(null);
        restoreWindow();
      }

      console.log('✔ Case 12 Passed: Restore, ack error handling (server 502 + client failure), PENDING guard & startup sync verified.');
    }

    console.log('=== All 12 Phase 1 Security, Billing & Lifecycle Tests Passed ===');
  } finally {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(tmpDir, { recursive: true, force: true });

    if (prevSigningSecret !== undefined) process.env.PLAY_BILLING_SIGNING_SECRET = prevSigningSecret;
    else delete process.env.PLAY_BILLING_SIGNING_SECRET;

    if (prevGeminiKey !== undefined) process.env.GEMINI_API_KEY = prevGeminiKey;
    else delete process.env.GEMINI_API_KEY;

    if (prevPubSubAudience !== undefined) process.env.GOOGLE_PUBSUB_AUDIENCE = prevPubSubAudience;
    else delete process.env.GOOGLE_PUBSUB_AUDIENCE;
  }
}

runPhase1Tests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Phase 1 Test Suite Failed:', err);
    process.exit(1);
  });
