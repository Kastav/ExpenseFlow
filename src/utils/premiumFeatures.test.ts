/**
 * Comprehensive Automated Tests for ExpenseFlow Migrated Premium Features:
 * - Hardened subscription expiry validation in getCurrentUserPlanTier()
 * - Server-verified entitlement lookup (/api/entitlements/me)
 * - Premium-only Cloud Sync & Backup (/api/cloud-sync/* + client conflict merge & recovery)
 * - AI-Generated Financial Recommendations (/api/coach/recommendations)
 * - Advanced AI Insights & Cash-Flow Forecasts (/api/coach/insights)
 * - Stage availability & removal of misleading "Coming Later" copy
 *
 * Scenarios verified across Free, Active Premium, Expired Premium, Revoked,
 * Cross-User, and Unavailable-Backend states.
 */

import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { createApp } from '../../server';
import {
  EntitlementStore,
  StoredPurchaseRecord,
  QuotaCheckResult,
} from '../server/entitlementStore';
import {
  CloudSyncPersistence,
  CloudSyncRouteDeps,
  StoredCloudSyncSnapshot,
} from '../server/cloudSyncRoute';
import { generateVerifiedEntitlementToken } from '../server/playBillingVerification';
import { PLAY_PRODUCT_IDS } from '../types/billing';
import {
  checkFeatureEntitlement,
  getCurrentUserPlanTier,
  setStoredEntitlementToken,
} from './premium';
import {
  clearLocalSubscriptionEntitlement,
  saveSubscriptionEntitlement,
} from '../services/playBillingService';
import {
  setBillingAuthTokenProvider,
  syncWithServerEntitlement,
} from '../services/playBillingService';
import {
  buildSafeAdvancedAnalyticsContext,
  requestAiRecommendations,
  requestAdvancedAiInsights,
  setCoachAuthTokenProvider,
} from '../services/aiCoachService';
import {
  BUDGET_KEY,
  CHALLENGES_KEY,
  COUNTRY_KEY,
  CURRENCY_KEY,
  PLAN_KEY,
  TRANSACTIONS_KEY,
  saveStoredTransactions,
} from './storage';
import {
  CloudSyncSnapshotV1,
  getPreSyncRecoveryBackup,
  performSmartCloudSync,
  pullAndApplyCloudBackup,
  readLocalCloudSyncSnapshot,
  restorePreSyncRecoveryBackup,
  restorePreviousCloudRevision,
} from './cloudSyncClient';
import { resolveStageFeatureAvailability } from './stageAvailability';
import { setAuthBackendForTests } from '../services/authService';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

function installLocalStorageShim(): { store: Map<string, string>; restore: () => void } {
  const storageMap = new Map<string, string>();
  const prevWindow = (globalThis as Record<string, unknown>).window;
  const prevLocalStorage = (globalThis as Record<string, unknown>).localStorage;

  const localStorageObj = {
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
  };

  (globalThis as Record<string, unknown>).localStorage = localStorageObj;
  (globalThis as Record<string, unknown>).window = {
    localStorage: localStorageObj,
  };

  return {
    store: storageMap,
    restore: () => {
      if (prevWindow === undefined) {
        delete (globalThis as Record<string, unknown>).window;
      } else {
        (globalThis as Record<string, unknown>).window = prevWindow;
      }
      if (prevLocalStorage === undefined) {
        delete (globalThis as Record<string, unknown>).localStorage;
      } else {
        (globalThis as Record<string, unknown>).localStorage = prevLocalStorage;
      }
    },
  };
}

class MemoryEntitlementStore implements EntitlementStore {
  public readonly backendName = 'firestore' as const;
  private recordsByHash = new Map<string, StoredPurchaseRecord>();
  private tokenIndex = new Map<string, string>();
  private quotas = new Map<string, { count: number; timestamps: number[] }>();

  seed(record: StoredPurchaseRecord) {
    this.recordsByHash.set(record.tokenHash, record);
    this.tokenIndex.set(record.tokenId, record.tokenHash);
  }

  async getPurchaseRecord(tokenHash: string) {
    return this.recordsByHash.get(tokenHash) || null;
  }
  async getPurchaseRecordByTokenId(tokenId: string) {
    const hash = this.tokenIndex.get(tokenId);
    return hash ? this.recordsByHash.get(hash) || null : null;
  }
  async getPurchaseRecordByUserId(userId: string) {
    const matching = Array.from(this.recordsByHash.values()).filter(
      (r) => r.userId === userId && r.ownershipStatus !== 'unbound'
    );
    matching.sort((a, b) => b.expiryTimeMillis - a.expiryTimeMillis);
    return matching[0] || null;
  }
  async upsertPurchaseRecord(record: StoredPurchaseRecord) {
    this.seed(record);
  }
  async acquirePurchaseVerificationLock() {
    return { ok: true as const, existing: null, createdReservation: false };
  }
  async releasePurchaseVerificationLock() {}
  async commitVerifiedPurchase(record: StoredPurchaseRecord) {
    this.seed(record);
    return { ok: true as const };
  }
  async isNotificationProcessed() {
    return false;
  }
  async markNotificationProcessed() {}
  async tryAcquireNotificationProcessing() {
    return true;
  }
  async acquireRtdnProcessingLease() {
    return { acquired: true as const, attempt: 1 };
  }
  async completeRtdnNotification() {}
  async failRtdnNotification() {}
  async getRtdnNotificationRecord() {
    return null;
  }
  async consumeAiQuota(
    subjectKey: string,
    maxPerMinute: number,
    maxPerMonth: number,
    nowMs: number = Date.now()
  ): Promise<QuotaCheckResult> {
    const entry = this.quotas.get(subjectKey) || { count: 0, timestamps: [] };
    entry.timestamps = entry.timestamps.filter((t) => t > nowMs - 60_000);
    if (entry.timestamps.length >= maxPerMinute) {
      return {
        allowed: false,
        reason: 'rate_limited',
        monthlyRequestsUsed: entry.count,
        monthlyQuota: maxPerMonth,
      };
    }
    if (entry.count >= maxPerMonth) {
      return {
        allowed: false,
        reason: 'quota_exceeded',
        monthlyRequestsUsed: entry.count,
        monthlyQuota: maxPerMonth,
      };
    }
    entry.timestamps.push(nowMs);
    entry.count += 1;
    this.quotas.set(subjectKey, entry);
    return {
      allowed: true,
      monthlyRequestsUsed: entry.count,
      monthlyQuota: maxPerMonth,
    };
  }
}

class MemoryCloudSyncPersistence implements CloudSyncPersistence {
  private current = new Map<string, StoredCloudSyncSnapshot>();
  private previous = new Map<string, StoredCloudSyncSnapshot>();
  private rates = new Map<string, number[]>();

  async consumeRateLimit(uid: string, nowMs: number, maxPerMinute: number) {
    const list = (this.rates.get(uid) || []).filter((ts) => ts > nowMs - 60_000);
    if (list.length >= maxPerMinute) return false;
    list.push(nowMs);
    this.rates.set(uid, list);
    return true;
  }
  async get(uid: string) {
    return this.current.get(uid) || null;
  }
  async getWithBackup(uid: string) {
    return {
      current: this.current.get(uid) || null,
      previous: this.previous.get(uid) || null,
    };
  }
  async compareAndSet(uid: string, expectedRevision: number, next: StoredCloudSyncSnapshot) {
    const curr = this.current.get(uid) || null;
    const rev = curr?.revision ?? 0;
    if (curr?.idempotencyKey === next.idempotencyKey) {
      if (curr.payloadHash === next.payloadHash) return { ok: true as const };
      return { ok: false as const, currentRevision: rev };
    }
    if (rev !== expectedRevision) {
      return { ok: false as const, currentRevision: rev };
    }
    if (curr) this.previous.set(uid, curr);
    this.current.set(uid, next);
    return { ok: true as const };
  }
  async restorePreviousBackup(uid: string, nowMs: number) {
    const prev = this.previous.get(uid);
    if (!prev) return { ok: false as const, reason: 'no_previous_backup' as const };
    const curr = this.current.get(uid) || null;
    const nextRev = (curr?.revision ?? 0) + 1;
    const restored: StoredCloudSyncSnapshot = {
      schemaVersion: 1,
      revision: nextRev,
      snapshot: prev.snapshot,
      updatedAt: nowMs,
      idempotencyKey: `restore-${nowMs}-${nextRev}`,
      payloadHash: `restored-${nextRev}`,
    };
    if (curr) this.previous.set(uid, curr);
    this.current.set(uid, restored);
    return { ok: true as const, restored };
  }
}

async function runTests() {
  console.log('--- Starting ExpenseFlow Premium Features & Migration Verification Tests ---');
  const prevSecret = process.env.PLAY_BILLING_SIGNING_SECRET;
  const prevNodeEnv = process.env.NODE_ENV;
  const prevGeminiKey = process.env.GEMINI_API_KEY;
  process.env.PLAY_BILLING_SIGNING_SECRET = 'test_signing_secret_minimum_32_characters_long';

  // 1. Hardened getCurrentUserPlanTier() expiry & spoof resistance
  {
    const { store: localMap, restore } = installLocalStorageShim();
    try {
      assert(getCurrentUserPlanTier() === 'free', 'Default empty state must be free');

      // Bare 'premium' or 'gplay_' must never unlock Premium
      setStoredEntitlementToken('premium');
      assert(getCurrentUserPlanTier() === 'free', 'Bare "premium" string must be rejected');
      setStoredEntitlementToken('gplay_fake_token');
      assert(getCurrentUserPlanTier() === 'free', 'Unsigned "gplay_" prefix must be rejected');

      // Structured expired Play token must return free and purge cache
      const pastMs = Date.now() - 60_000;
      const expiredToken = generateVerifiedEntitlementToken(
        PLAY_PRODUCT_IDS.MONTHLY,
        'raw_play_tok_expired',
        pastMs
      );
      setStoredEntitlementToken(expiredToken);
      assert(
        getCurrentUserPlanTier() === 'free',
        'Expired structured Play token must return free'
      );
      assert(
        localMap.get('expenseflow_entitlement_token_v1') === undefined,
        'Expired Play token must be purged from localStorage'
      );

      // Expired SUBSCRIPTION_ENTITLEMENT_KEY record must return free even if token string is set
      const futureMs = Date.now() + 86_400_000;
      const futureToken = generateVerifiedEntitlementToken(
        PLAY_PRODUCT_IDS.ANNUAL,
        'raw_play_tok_active',
        futureMs
      );
      saveSubscriptionEntitlement({
        tier: 'premium',
        productId: PLAY_PRODUCT_IDS.ANNUAL,
        purchaseToken: 'raw_play_tok_active',
        verifiedEntitlementToken: futureToken,
        expiryTimeMillis: pastMs,
        autoRenewing: false,
        cancelAtPeriodEnd: false,
        lastVerifiedAt: pastMs - 1000,
      });
      setStoredEntitlementToken(futureToken);
      assert(
        getCurrentUserPlanTier() === 'free',
        'Expired subscription entitlement record must return free'
      );

      // Active unexpired entitlement grants premium & activates all 3 approved Premium features
      saveSubscriptionEntitlement({
        tier: 'premium',
        productId: PLAY_PRODUCT_IDS.ANNUAL,
        purchaseToken: 'raw_play_tok_active',
        verifiedEntitlementToken: futureToken,
        expiryTimeMillis: futureMs,
        autoRenewing: true,
        cancelAtPeriodEnd: false,
        lastVerifiedAt: Date.now(),
      });
      setStoredEntitlementToken(futureToken);
      assert(getCurrentUserPlanTier() === 'premium', 'Active unexpired entitlement must return premium');
      assert(
        checkFeatureEntitlement('cloud_sync_backup').hasAccess &&
          checkFeatureEntitlement('cloud_sync_backup').feature.status === 'active',
        'cloud_sync_backup must be active & granted to active Premium'
      );
      assert(
        checkFeatureEntitlement('ai_recommendations').hasAccess &&
          checkFeatureEntitlement('ai_recommendations').feature.status === 'active',
        'ai_recommendations must be active & granted to active Premium'
      );
      assert(
        checkFeatureEntitlement('advanced_ai_insights').hasAccess &&
          checkFeatureEntitlement('advanced_ai_insights').feature.status === 'active',
        'advanced_ai_insights must be active & granted to active Premium'
      );

      console.log('✔ Test 1 Passed: getCurrentUserPlanTier() expiry & spoof hardening verified.');
    } finally {
      clearLocalSubscriptionEntitlement();
      restore();
    }
  }

  // 2. End-to-End Server + Client Integration: Free, Active Premium, Expired, Revoked, Cross-User, Unavailable
  {
    const nowMs = Date.now();
    const futureMs = nowMs + 7 * 86_400_000;
    const pastMs = nowMs - 10_000;

    const entStore = new MemoryEntitlementStore();
    const activeToken = generateVerifiedEntitlementToken(
      PLAY_PRODUCT_IDS.MONTHLY,
      'raw_tok_active_u1',
      futureMs
    );
    const expiredToken = generateVerifiedEntitlementToken(
      PLAY_PRODUCT_IDS.MONTHLY,
      'raw_tok_expired_u3',
      pastMs
    );
    const revokedToken = generateVerifiedEntitlementToken(
      PLAY_PRODUCT_IDS.MONTHLY,
      'raw_tok_revoked_u4',
      futureMs
    );

    const hashOf = (tok: string) =>
      crypto.createHash('sha256').update(tok).digest('hex');

    entStore.seed({
      tokenHash: hashOf('raw_tok_active_u1'),
      tokenId: hashOf('raw_tok_active_u1').slice(0, 16),
      userId: 'uid_active',
      ownershipStatus: 'bound',
      productId: PLAY_PRODUCT_IDS.MONTHLY,
      subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
      status: 'active',
      expiryTimeMillis: futureMs,
      autoRenewing: true,
      cancelAtPeriodEnd: false,
      acknowledged: true,
      revoked: false,
      createdAt: nowMs - 1000,
      updatedAt: nowMs - 1000,
      lastVerifiedAt: nowMs - 1000,
    });
    entStore.seed({
      tokenHash: hashOf('raw_tok_active_u2'),
      tokenId: hashOf('raw_tok_active_u2').slice(0, 16),
      userId: 'uid_other_active',
      ownershipStatus: 'bound',
      productId: PLAY_PRODUCT_IDS.ANNUAL,
      subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
      status: 'active',
      expiryTimeMillis: futureMs,
      autoRenewing: true,
      cancelAtPeriodEnd: false,
      acknowledged: true,
      revoked: false,
      createdAt: nowMs - 1000,
      updatedAt: nowMs - 1000,
      lastVerifiedAt: nowMs - 1000,
    });
    entStore.seed({
      tokenHash: hashOf('raw_tok_expired_u3'),
      tokenId: hashOf('raw_tok_expired_u3').slice(0, 16),
      userId: 'uid_expired',
      ownershipStatus: 'bound',
      productId: PLAY_PRODUCT_IDS.MONTHLY,
      subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED',
      status: 'expired',
      expiryTimeMillis: pastMs,
      autoRenewing: false,
      cancelAtPeriodEnd: false,
      acknowledged: true,
      revoked: false,
      createdAt: nowMs - 5000,
      updatedAt: nowMs - 5000,
      lastVerifiedAt: nowMs - 5000,
    });
    entStore.seed({
      tokenHash: hashOf('raw_tok_revoked_u4'),
      tokenId: hashOf('raw_tok_revoked_u4').slice(0, 16),
      userId: 'uid_revoked',
      ownershipStatus: 'bound',
      productId: PLAY_PRODUCT_IDS.MONTHLY,
      subscriptionState: 'SUBSCRIPTION_STATE_CANCELED',
      status: 'revoked',
      expiryTimeMillis: futureMs,
      autoRenewing: false,
      cancelAtPeriodEnd: false,
      acknowledged: true,
      revoked: true,
      revokedAt: nowMs - 500,
      createdAt: nowMs - 5000,
      updatedAt: nowMs - 500,
      lastVerifiedAt: nowMs - 500,
    });

    const syncPersistence = new MemoryCloudSyncPersistence();
    const verifyToken = async (tok: string) => {
      if (tok === 'fb_active') return { uid: 'uid_active', obfuscatedAccountId: 'obf_active' };
      if (tok === 'fb_other') return { uid: 'uid_other_active', obfuscatedAccountId: 'obf_other' };
      if (tok === 'fb_free') return { uid: 'uid_free', obfuscatedAccountId: 'obf_free' };
      if (tok === 'fb_expired') return { uid: 'uid_expired', obfuscatedAccountId: 'obf_expired' };
      if (tok === 'fb_revoked') return { uid: 'uid_revoked', obfuscatedAccountId: 'obf_revoked' };
      return null;
    };

    const app = await createApp({
      disableVite: true,
      billingDeps: { store: entStore, verifyCallerToken: verifyToken, now: () => nowMs },
      cloudSyncDeps: { store: entStore, persistence: syncPersistence, verifyCallerToken: verifyToken, now: () => nowMs },
      coachDeps: {
        store: entStore,
        verifyCallerToken: verifyToken,
        now: () => nowMs,
        generateReply: async ({ finalPrompt }) => {
          if (finalPrompt.includes('recurring leak')) {
            return JSON.stringify({
              summary: 'Month-end spend projected near $1,150 with $350 remaining budget.',
              forecast: {
                projectedMonthEndSpend: 1150,
                projectedNextMonthSpend: 1120,
                projectedBudgetVariance: 350,
                cashFlowRiskLevel: 'low',
                confidenceNote: 'Based on aggregated pacing.',
              },
              recurringLeaks: [
                {
                  category: 'Entertainment',
                  estimatedMonthlyCost: 45,
                  annualizedCost: 540,
                  observation: 'Consistent monthly recurring charges.',
                },
              ],
              strategicGuidance: ['Keep discretionary dining below $25/day.'],
            });
          }
          return JSON.stringify({
            summary: 'Groceries and Dining represent your largest monthly share.',
            anomalyAlerts: [
              { category: 'Dining Out', severity: 'warning', detail: 'Dining is 22% higher than prior month.' },
            ],
            recommendations: [
              {
                id: 'rec_1',
                title: 'Cap Weekend Dining',
                category: 'Dining Out',
                priority: 'high',
                potentialMonthlySavings: 85,
                actionStep: 'Shift two weekend restaurant meals to home prep.',
                rationale: 'Dining Out accounts for 35% of current spend.',
              },
            ],
          });
        },
      },
    });

    const server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

    const { store: localMap, restore } = installLocalStorageShim();
    try {
      // Seed sensitive local transactions to verify data minimization AND cloud sync
      const localSnapshotSeed: CloudSyncSnapshotV1 = {
        schemaVersion: 1,
        transactions: [
          {
            id: 'tx_local_1',
            amount: 120.5,
            category: 'Dining Out',
            date: '2026-11-18',
            paymentMethod: 'Secret Visa ****9999',
            notes: 'Private confidential client lunch',
            createdAt: 1000,
            updatedAt: 2000,
          },
          {
            id: 'tx_local_2',
            amount: 45,
            category: 'Entertainment',
            date: '2026-11-05',
            notes: 'Streaming bundle',
            createdAt: 900,
            updatedAt: 900,
          },
        ],
        budget: { monthlyBudget: 1500, lastUpdated: 1000 },
        plan: {
          availableMoney: '600',
          upcomingBills: '200',
          otherExpenses: '100',
          proposedPurchase: '80',
          categoryBudgets: {},
          lastSaved: 1000,
        },
        currency: 'USD',
        country: 'US',
        challenges: [],
      };
      localMap.set(TRANSACTIONS_KEY, JSON.stringify(localSnapshotSeed.transactions));
      localMap.set(BUDGET_KEY, JSON.stringify(localSnapshotSeed.budget));
      localMap.set(PLAN_KEY, JSON.stringify(localSnapshotSeed.plan));
      localMap.set(CURRENCY_KEY, 'USD');
      localMap.set(COUNTRY_KEY, 'US');
      localMap.set(CHALLENGES_KEY, JSON.stringify([]));

      // 2a. Data Minimization check for AI Recommendations & Advanced Insights
      const analyticsCtx = buildSafeAdvancedAnalyticsContext(
        [
          ...localSnapshotSeed.transactions,
          {
            id: 'tx_prev_sub',
            amount: 45,
            category: 'Entertainment',
            date: '2026-10-05',
            notes: 'Streaming bundle secret note',
            createdAt: 500,
            updatedAt: 500,
          },
        ],
        localSnapshotSeed.budget,
        'USD',
        0,
        '2026-11-19'
      );
      const serializedCtx = JSON.stringify(analyticsCtx);
      assert(!serializedCtx.includes('tx_local_1'), 'AI context must never leak transaction IDs');
      assert(!serializedCtx.includes('confidential'), 'AI context must never leak transaction notes');
      assert(!serializedCtx.includes('Secret Visa'), 'AI context must never leak payment methods');
      assert(analyticsCtx.historicalMonths.length === 1, 'Prior month historical aggregate must be included');
      assert(analyticsCtx.recurringPatterns.length >= 1, 'Recurring pattern aggregate must be detected');

      // 2b. Free, Expired, Revoked, Cross-User must ALL be blocked on Cloud Sync & AI endpoints
      for (const [label, bearer, extraBody] of [
        ['Unauthenticated', '', {}],
        ['Free user', 'fb_free', {}],
        ['Expired user', 'fb_expired', { entitlementToken: expiredToken }],
        ['Revoked user', 'fb_revoked', { entitlementToken: revokedToken }],
        ['Cross-user token reuse', 'fb_free', { entitlementToken: activeToken }],
      ] as const) {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-ExpenseFlow-Entitlement-Tier': 'premium', // spoofed client header
        };
        if (bearer) headers.Authorization = `Bearer ${bearer}`;

        const syncRes = await fetch(`${baseUrl}/api/cloud-sync/snapshot`, { headers });
        const expectedSyncStatus = bearer ? 403 : 401;
        assert(
          syncRes.status === expectedSyncStatus,
          `${label}: Cloud Sync expected ${expectedSyncStatus}, got ${syncRes.status}`
        );

        const recRes = await fetch(`${baseUrl}/api/coach/recommendations`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ analyticsContext: analyticsCtx, ...extraBody }),
        });
        assert(
          recRes.status === expectedSyncStatus,
          `${label}: AI Recommendations expected ${expectedSyncStatus}, got ${recRes.status}`
        );

        const advRes = await fetch(`${baseUrl}/api/coach/insights`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ analyticsContext: analyticsCtx, ...extraBody }),
        });
        assert(
          advRes.status === expectedSyncStatus,
          `${label}: Advanced AI Insights expected ${expectedSyncStatus}, got ${advRes.status}`
        );
      }

      // 2c. /api/entitlements/me syncs Active Premium & clears revoked/free
      const meActive = await syncWithServerEntitlement({
        authToken: 'fb_active',
        apiConfigOptions: { isNative: false, origin: baseUrl, apiBaseUrl: baseUrl },
      });
      assert(meActive.checked && meActive.tier === 'premium', '/api/entitlements/me must grant active user premium');
      assert(getCurrentUserPlanTier() === 'premium', 'syncWithServerEntitlement must update local entitlement');

      // 2d. Active Premium user succeeds on AI Recommendations & Advanced Insights
      const recSuccess = await requestAiRecommendations(analyticsCtx, {
        authToken: 'fb_active',
        apiConfigOptions: { isNative: false, origin: baseUrl, apiBaseUrl: baseUrl },
      });
      assert(
        Boolean(recSuccess.success && recSuccess.recommendations && recSuccess.recommendations.length > 0),
        'Active Premium must receive structured AI recommendations'
      );

      const advSuccess = await requestAdvancedAiInsights(analyticsCtx, {
        authToken: 'fb_active',
        apiConfigOptions: { isNative: false, origin: baseUrl, apiBaseUrl: baseUrl },
      });
      assert(
        Boolean(
          advSuccess.success &&
            advSuccess.forecast?.projectedMonthEndSpend === 1150 &&
            (advSuccess.recurringLeaks?.length || 0) > 0
        ),
        'Active Premium must receive structured cash-flow forecast & recurring leaks'
      );

      // 2e. Cloud Sync upload, multi-device conflict merge, tombstones & recovery
      const firstSync = await performSmartCloudSync('merge_newest', {
        authToken: 'fb_active',
        apiConfigOptions: { isNative: false, origin: baseUrl, apiBaseUrl: baseUrl },
      });
      assert(firstSync.revision === 1, `Expected first sync revision 1, got ${firstSync.revision}`);

      // Other active user MUST have zero access to uid_active's cloud backup
      const otherFetch = await fetch(`${baseUrl}/api/cloud-sync/snapshot`, {
        headers: { Authorization: 'Bearer fb_other' },
      });
      const otherJson = (await otherFetch.json()) as { exists?: boolean; revision?: number };
      assert(
        otherFetch.status === 200 && otherJson.exists === false && otherJson.revision === 0,
        'Different Premium user must NEVER see another UID cloud backup'
      );

      // Simulate local delete + edit before second sync -> creates rev 2 + preserves rev 1 as previous_snapshot
      saveStoredTransactions(
        localSnapshotSeed.transactions.filter((t) => t.id !== 'tx_local_2'),
        { deletedIds: ['tx_local_2'] }
      );
      const secondSync = await performSmartCloudSync('merge_newest', {
        authToken: 'fb_active',
        apiConfigOptions: { isNative: false, origin: baseUrl, apiBaseUrl: baseUrl },
      });
      assert(secondSync.revision === 2, `Expected rev 2, got ${secondSync.revision}`);
      assert(
        secondSync.snapshot.transactions.length === 1 &&
          secondSync.snapshot.transactions[0].id === 'tx_local_1',
        'Delete tombstone must prevent deleted transaction from resurrecting'
      );

      // Simulate local overwrite & local pre-sync recovery rollback
      const rolledBackCloud = await restorePreviousCloudRevision({
        authToken: 'fb_active',
        apiConfigOptions: { isNative: false, origin: baseUrl, apiBaseUrl: baseUrl },
      });
      assert(
        rolledBackCloud.revision === 3 && rolledBackCloud.snapshot.transactions.length === 2,
        'Server previous backup restore must recover revision 1 data as revision 3'
      );
      assert(getPreSyncRecoveryBackup() !== null, 'Pre-sync local recovery backup must be saved before overwrite');
      const localUndone = restorePreSyncRecoveryBackup();
      assert(
        localUndone.snapshot.transactions.length === 1 &&
          readLocalCloudSyncSnapshot().transactions.length === 1,
        'restorePreSyncRecoveryBackup() must restore pre-sync local device state'
      );

      const pulled = await pullAndApplyCloudBackup({
        authToken: 'fb_active',
        apiConfigOptions: { isNative: false, origin: baseUrl, apiBaseUrl: baseUrl },
      });
      assert(
        pulled.revision === 3 && readLocalCloudSyncSnapshot().transactions.length === 2,
        'pullAndApplyCloudBackup must apply latest cloud revision cleanly'
      );

      // Revoked user syncWithServerEntitlement must clear local cache & reject Cloud Sync
      const meRevoked = await syncWithServerEntitlement({
        authToken: 'fb_revoked',
        apiConfigOptions: { isNative: false, origin: baseUrl, apiBaseUrl: baseUrl },
      });
      assert(meRevoked.tier === 'free' && getCurrentUserPlanTier() === 'free', 'Revoked user must clear local premium');

      // 2f. Client unavailable-backend & stageAvailability handling
      const prevFetch = globalThis.fetch;
      try {
        globalThis.fetch = (async () => {
          throw new Error('ECONNREFUSED');
        }) as typeof fetch;
        const offlineRec = await requestAiRecommendations(analyticsCtx, {
          authToken: 'fb_active',
          apiConfigOptions: { isNative: false, origin: 'https://app.test', apiBaseUrl: 'https://offline.test' },
        });
        assert(offlineRec.success === false && offlineRec.error === 'server_error', 'Offline recommendations must fail cleanly');

        const offlineStage = await resolveStageFeatureAvailability({
          isNative: false,
          origin: 'https://app.test',
          apiBaseUrl: 'https://offline.test',
        });
        assert(
          offlineStage.purchasesEnabled === false &&
            offlineStage.aiCoachEnabled === false &&
            offlineStage.aiRecommendationsEnabled === false &&
            offlineStage.advancedAiInsightsEnabled === false &&
            offlineStage.cloudSyncEnabled === false,
          'Offline backend must fail closed across all Premium features'
        );
      } finally {
        globalThis.fetch = prevFetch;
      }

      // 2g. /api/ready in production returns 503 when Firestore persistence is unconfigured
      process.env.NODE_ENV = 'production';
      delete process.env.ENTITLEMENT_STORE_BACKEND;
      const prodApp = await createApp({ disableVite: true });
      const prodServer = await new Promise<http.Server>((resolve) => {
        const s = prodApp.listen(0, '127.0.0.1', () => resolve(s));
      });
      const prodUrl = `http://127.0.0.1:${(prodServer.address() as { port: number }).port}`;
      try {
        const readyRes = await fetch(`${prodUrl}/api/ready`);
        assert(readyRes.status === 503, `Production /api/ready without Firestore must return 503, got ${readyRes.status}`);
        // Also verify production AI endpoints do NOT bypass Firebase Auth when Firebase Admin is missing (503 fail-closed)
        const prodRecRes = await fetch(`${prodUrl}/api/coach/recommendations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ analyticsContext: analyticsCtx }),
        });
        assert(
          prodRecRes.status === 503,
          `Production AI route without GEMINI_API_KEY/Firebase Admin must return 503, got ${prodRecRes.status}`
        );
      } finally {
        prodServer.closeAllConnections?.();
        await new Promise<void>((resolve) => prodServer.close(() => resolve()));
      }

      // 2h. Verify no misleading "Coming Later" UI placeholders remain in active UI components
      const uiFiles = [
        'src/components/InsightsView.tsx',
        'src/components/PurchasePlanner.tsx',
        'src/components/MoreView.tsx',
        'src/components/PremiumUpgradeModal.tsx',
        'src/components/AiSpendingCoachModal.tsx',
      ];
      for (const rel of uiFiles) {
        const content = fs.readFileSync(path.resolve(rel), 'utf8');
        assert(
          !/Coming Later/i.test(content),
          `${rel} must not contain misleading "Coming Later" placeholder text`
        );
      }

      console.log('✔ Test 2 Passed: Auth, Premium gating, Cloud Sync, AI Recommendations, Advanced AI Insights, /api/ready & UI checks passed.');
    } finally {
      clearLocalSubscriptionEntitlement();
      setAuthBackendForTests(null);
      setBillingAuthTokenProvider(null);
      setCoachAuthTokenProvider(null);
      restore();
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  if (prevSecret !== undefined) process.env.PLAY_BILLING_SIGNING_SECRET = prevSecret;
  else delete process.env.PLAY_BILLING_SIGNING_SECRET;
  if (prevNodeEnv !== undefined) process.env.NODE_ENV = prevNodeEnv;
  else delete process.env.NODE_ENV;
  if (prevGeminiKey !== undefined) process.env.GEMINI_API_KEY = prevGeminiKey;
  else delete process.env.GEMINI_API_KEY;

  console.log('\n🎉 All ExpenseFlow Premium Features & Migration Tests Passed Successfully!');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
