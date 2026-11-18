import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Firestore, DocumentReference, Transaction } from 'firebase-admin/firestore';
import { getAdminFirestore, isFirebaseAdminConfigured } from './firebaseAdmin.ts';

export interface StoredPurchaseRecord {
  tokenHash: string;
  tokenId: string; // First 16 hex chars of SHA-256(purchaseToken)
  userId: string | null;
  ownershipStatus?: 'bound' | 'unbound';
  obfuscatedAccountId?: string;
  productId: string;
  latestOrderId?: string;
  subscriptionState: string;
  status: 'active' | 'expired' | 'pending' | 'canceled' | 'revoked' | 'on_hold' | 'paused';
  expiryTimeMillis: number;
  autoRenewing: boolean;
  cancelAtPeriodEnd: boolean;
  acknowledged: boolean;
  revoked: boolean;
  revokedAt?: number;
  lastRtdnEventTimeMillis?: number;
  pendingClaim?: boolean;
  pendingClaimAt?: number;
  pendingClaimUserId?: string;
  createdAt: number;
  updatedAt: number;
  lastVerifiedAt: number;
}

export type RtdnProcessingStatus = 'processing' | 'completed' | 'failed';

export interface RtdnNotificationRecord {
  messageId: string;
  eventType?: string | null;
  status: RtdnProcessingStatus;
  leaseExpiresAt?: number;
  attempts: number;
  lastError?: string | null;
  processedAt: number;
  completedAt?: number;
  updatedAt: number;
}

export type AcquireRtdnLeaseResult =
  | {
      acquired: true;
      attempt: number;
    }
  | {
      acquired: false;
      reason: 'already_completed' | 'in_progress';
      record: RtdnNotificationRecord;
    };

export interface QuotaCheckResult {
  allowed: boolean;
  reason?: 'rate_limited' | 'quota_exceeded';
  monthlyRequestsUsed: number;
  monthlyQuota: number;
}

export interface AcquirePurchaseLockParams {
  tokenHash: string;
  tokenId: string;
  userId?: string;
  productId?: string;
  requestedOrderId?: string;
  mode: 'purchase' | 'restore' | 'rtdn';
  nowMs: number;
}

export type AcquirePurchaseLockResult =
  | {
      ok: true;
      existing: StoredPurchaseRecord | null;
      createdReservation: boolean;
    }
  | {
      ok: false;
      reason: 'cross_user_replay' | 'duplicate_purchase' | 'revoked' | 'unauthorized';
      existing: StoredPurchaseRecord | null;
    };

export type CommitVerifiedPurchaseResult =
  | { ok: true }
  | { ok: false; reason: 'cross_user_replay' | 'revoked' | 'stale_notification' };

export interface EntitlementStore {
  readonly backendName: 'firestore' | 'file';
  getPurchaseRecord(tokenHash: string): Promise<StoredPurchaseRecord | null>;
  getPurchaseRecordByTokenId(tokenId: string): Promise<StoredPurchaseRecord | null>;
  getPurchaseRecordByUserId?(userId: string): Promise<StoredPurchaseRecord | null>;
  upsertPurchaseRecord(record: StoredPurchaseRecord): Promise<void>;
  acquirePurchaseVerificationLock(params: AcquirePurchaseLockParams): Promise<AcquirePurchaseLockResult>;
  releasePurchaseVerificationLock(tokenHash: string, deleteIfUncommitted: boolean): Promise<void>;
  commitVerifiedPurchase(
    record: StoredPurchaseRecord,
    mode: 'purchase' | 'restore' | 'rtdn'
  ): Promise<CommitVerifiedPurchaseResult>;
  isNotificationProcessed(messageId: string): Promise<boolean>;
  markNotificationProcessed(messageId: string, eventType?: string): Promise<void>;
  tryAcquireNotificationProcessing(messageId: string, eventType?: string): Promise<boolean>;
  acquireRtdnProcessingLease(
    messageId: string,
    options?: { eventType?: string; nowMs?: number; leaseDurationMs?: number }
  ): Promise<AcquireRtdnLeaseResult>;
  completeRtdnNotification(messageId: string, eventType?: string, nowMs?: number): Promise<void>;
  failRtdnNotification(
    messageId: string,
    errorMessage: string,
    eventType?: string,
    nowMs?: number
  ): Promise<void>;
  getRtdnNotificationRecord(messageId: string): Promise<RtdnNotificationRecord | null>;
  consumeAiQuota(subjectKey: string, maxPerMinute: number, maxPerMonth: number, nowMs?: number): Promise<QuotaCheckResult>;
}

export class EntitlementStoreConfigurationError extends Error {
  public readonly code = 'ENTITLEMENT_STORE_CONFIGURATION_REQUIRED';

  constructor(message: string) {
    super(message);
    this.name = 'EntitlementStoreConfigurationError';
  }
}

export function hashPurchaseToken(purchaseToken: string): string {
  return crypto.createHash('sha256').update(purchaseToken).digest('hex');
}

export function getTokenIdFromHash(tokenHash: string): string {
  return tokenHash.slice(0, 16);
}

const CLAIM_LOCK_TTL_MS = 60_000;
export const DEFAULT_RTDN_LEASE_DURATION_MS = 30_000;

function stripUndefinedFields<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      clean[k] = v;
    }
  }
  return clean;
}

function evaluatePurchaseLock(
  existing: StoredPurchaseRecord | null,
  params: AcquirePurchaseLockParams
): { allowed: true } | { allowed: false; reason: 'cross_user_replay' | 'duplicate_purchase' | 'revoked' | 'unauthorized' } {
  if (params.mode !== 'rtdn') {
    if (!params.userId) {
      return { allowed: false, reason: 'unauthorized' };
    }
    if (existing?.revoked) {
      return { allowed: false, reason: 'revoked' };
    }
    if (existing && existing.userId) {
      if (existing.userId !== params.userId) {
        return { allowed: false, reason: 'cross_user_replay' };
      }
      if (params.mode === 'purchase') {
        const hasActiveLock =
          Boolean(existing.pendingClaim) &&
          params.nowMs - (existing.pendingClaimAt || 0) < CLAIM_LOCK_TTL_MS;
        const isDuplicateOrder =
          Boolean(params.requestedOrderId) && existing.latestOrderId === params.requestedOrderId;
        if (existing.acknowledged || hasActiveLock || isDuplicateOrder) {
          return { allowed: false, reason: 'duplicate_purchase' };
        }
      }
    } else if (existing && !existing.userId) {
      // Unbound RTDN record: enforce concurrent claim lock safety without blocking first legitimate user claim.
      const hasActiveLock =
        Boolean(existing.pendingClaim) &&
        params.nowMs - (existing.pendingClaimAt || 0) < CLAIM_LOCK_TTL_MS;
      if (hasActiveLock) {
        if (existing.pendingClaimUserId && existing.pendingClaimUserId !== params.userId) {
          return { allowed: false, reason: 'cross_user_replay' };
        }
        return { allowed: false, reason: 'duplicate_purchase' };
      }
    }
  }
  return { allowed: true };
}

function isStaleRtdnCommit(existing: StoredPurchaseRecord | null, incoming: StoredPurchaseRecord): boolean {
  if (!existing) return false;
  if (
    typeof incoming.lastRtdnEventTimeMillis === 'number' &&
    typeof existing.lastRtdnEventTimeMillis === 'number' &&
    incoming.lastRtdnEventTimeMillis < existing.lastRtdnEventTimeMillis &&
    !(incoming.revoked && !existing.revoked)
  ) {
    return true;
  }
  if (
    !incoming.revoked &&
    incoming.expiryTimeMillis > 0 &&
    existing.expiryTimeMillis > 0 &&
    incoming.expiryTimeMillis < existing.expiryTimeMillis
  ) {
    return true;
  }
  return false;
}

function mergeMonotonicEventTime(
  existingTs?: number,
  incomingTs?: number
): number | undefined {
  const maxVal = Math.max(existingTs || 0, incomingTs || 0);
  return maxVal > 0 ? maxVal : undefined;
}

function normalizeRtdnRecord(raw: Record<string, unknown> | undefined | null, messageId: string): RtdnNotificationRecord | null {
  if (!raw) return null;
  const legacyOnly = typeof raw.status !== 'string';
  return {
    messageId: typeof raw.messageId === 'string' ? raw.messageId : messageId,
    eventType: typeof raw.eventType === 'string' ? raw.eventType : null,
    status: legacyOnly
      ? 'completed'
      : (raw.status as RtdnProcessingStatus),
    leaseExpiresAt: typeof raw.leaseExpiresAt === 'number' ? raw.leaseExpiresAt : undefined,
    attempts: typeof raw.attempts === 'number' ? raw.attempts : 1,
    lastError: typeof raw.lastError === 'string' ? raw.lastError : null,
    processedAt: typeof raw.processedAt === 'number' ? raw.processedAt : Date.now(),
    completedAt: typeof raw.completedAt === 'number' ? raw.completedAt : undefined,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : (typeof raw.processedAt === 'number' ? raw.processedAt : Date.now()),
  };
}

// ============================================================================
// File-Backed Store (Local Development & Automated Tests)
// ============================================================================

interface PersistedFileSchema {
  purchases: Record<string, StoredPurchaseRecord>;
  tokenIdIndex: Record<string, string>;
  rtdnMessages: Record<string, RtdnNotificationRecord | { processedAt: number; eventType?: string }>;
  aiQuotas: Record<string, { monthKey: string; monthlyCount: number; recentTimestamps: number[] }>;
}

/**
 * Atomic file-backed durable entitlement store.
 * Persists hashed purchase records, RTDN deduplication IDs, and AI quota counters across restarts.
 */
export class FileEntitlementStore implements EntitlementStore {
  public readonly backendName = 'file' as const;
  private readonly filePath: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = path.resolve(filePath);
  }

  private readState(): PersistedFileSchema {
    try {
      if (!fs.existsSync(this.filePath)) {
        return { purchases: {}, tokenIdIndex: {}, rtdnMessages: {}, aiQuotas: {} };
      }
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      if (!raw.trim()) {
        return { purchases: {}, tokenIdIndex: {}, rtdnMessages: {}, aiQuotas: {} };
      }
      const parsed = JSON.parse(raw) as Partial<PersistedFileSchema>;
      return {
        purchases: parsed.purchases || {},
        tokenIdIndex: parsed.tokenIdIndex || {},
        rtdnMessages: parsed.rtdnMessages || {},
        aiQuotas: parsed.aiQuotas || {},
      };
    } catch {
      return { purchases: {}, tokenIdIndex: {}, rtdnMessages: {}, aiQuotas: {} };
    }
  }

  private writeState(state: PersistedFileSchema): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(tmpPath, this.filePath);
  }

  private withLock<T>(fn: () => Promise<T> | T): Promise<T> {
    const next = this.writeChain.then(() => fn());
    this.writeChain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  async getPurchaseRecord(tokenHash: string): Promise<StoredPurchaseRecord | null> {
    return this.withLock(() => {
      const state = this.readState();
      return state.purchases[tokenHash] || null;
    });
  }

  async getPurchaseRecordByTokenId(tokenId: string): Promise<StoredPurchaseRecord | null> {
    return this.withLock(() => {
      const state = this.readState();
      const tokenHash = state.tokenIdIndex[tokenId];
      if (!tokenHash) return null;
      return state.purchases[tokenHash] || null;
    });
  }

  async getPurchaseRecordByUserId(userId: string): Promise<StoredPurchaseRecord | null> {
    return this.withLock(() => {
      const state = this.readState();
      return Object.values(state.purchases)
        .filter((record) => record.userId === userId && record.ownershipStatus !== 'unbound')
        .sort((a, b) => b.updatedAt - a.updatedAt)[0] || null;
    });
  }

  async upsertPurchaseRecord(record: StoredPurchaseRecord): Promise<void> {
    return this.withLock(() => {
      const state = this.readState();
      state.purchases[record.tokenHash] = record;
      state.tokenIdIndex[record.tokenId] = record.tokenHash;
      this.writeState(state);
    });
  }

  async acquirePurchaseVerificationLock(params: AcquirePurchaseLockParams): Promise<AcquirePurchaseLockResult> {
    return this.withLock(() => {
      const state = this.readState();
      const indexedHash = state.tokenIdIndex[params.tokenId];
      const existing = state.purchases[params.tokenHash] || (indexedHash ? state.purchases[indexedHash] : null) || null;
      const evaluation = evaluatePurchaseLock(existing, params);

      if (!evaluation.allowed) {
        return {
          ok: false,
          reason: evaluation.reason,
          existing,
        };
      }

      if (params.mode === 'purchase' && params.userId) {
        if (existing) {
          state.purchases[params.tokenHash] = {
            ...existing,
            pendingClaim: true,
            pendingClaimAt: params.nowMs,
            pendingClaimUserId: params.userId,
            updatedAt: params.nowMs,
          };
          this.writeState(state);
          return { ok: true, existing, createdReservation: false };
        }

        const reservation: StoredPurchaseRecord = {
          tokenHash: params.tokenHash,
          tokenId: params.tokenId,
          userId: params.userId,
          ownershipStatus: 'bound',
          productId: params.productId || '',
          latestOrderId: params.requestedOrderId,
          subscriptionState: 'SUBSCRIPTION_STATE_UNSPECIFIED',
          status: 'pending',
          expiryTimeMillis: 0,
          autoRenewing: false,
          cancelAtPeriodEnd: false,
          acknowledged: false,
          revoked: false,
          pendingClaim: true,
          pendingClaimAt: params.nowMs,
          pendingClaimUserId: params.userId,
          createdAt: params.nowMs,
          updatedAt: params.nowMs,
          lastVerifiedAt: params.nowMs,
        };
        state.purchases[params.tokenHash] = reservation;
        state.tokenIdIndex[params.tokenId] = params.tokenHash;
        this.writeState(state);
        return { ok: true, existing: null, createdReservation: true };
      }

      return { ok: true, existing, createdReservation: false };
    });
  }

  async releasePurchaseVerificationLock(tokenHash: string, deleteIfUncommitted: boolean): Promise<void> {
    return this.withLock(() => {
      const state = this.readState();
      const existing = state.purchases[tokenHash];
      if (!existing) return;

      if (
        deleteIfUncommitted &&
        !existing.acknowledged &&
        existing.expiryTimeMillis === 0 &&
        existing.ownershipStatus !== 'unbound'
      ) {
        delete state.purchases[tokenHash];
        if (state.tokenIdIndex[existing.tokenId] === tokenHash) {
          delete state.tokenIdIndex[existing.tokenId];
        }
      } else {
        state.purchases[tokenHash] = {
          ...existing,
          pendingClaim: false,
          pendingClaimAt: undefined,
          pendingClaimUserId: undefined,
        };
      }
      this.writeState(state);
    });
  }

  async commitVerifiedPurchase(
    record: StoredPurchaseRecord,
    mode: 'purchase' | 'restore' | 'rtdn'
  ): Promise<CommitVerifiedPurchaseResult> {
    return this.withLock(() => {
      const state = this.readState();
      const indexedHash = state.tokenIdIndex[record.tokenId];
      const existing = state.purchases[record.tokenHash] || (indexedHash ? state.purchases[indexedHash] : null) || null;

      if (mode !== 'rtdn' && existing && existing.userId && existing.userId !== record.userId) {
        return { ok: false, reason: 'cross_user_replay' };
      }
      if (existing?.revoked && !record.revoked) {
        return { ok: false, reason: 'revoked' };
      }
      if (mode === 'rtdn' && isStaleRtdnCommit(existing, record)) {
        return { ok: false, reason: 'stale_notification' };
      }

      const resolvedUid = mode === 'rtdn' ? existing?.userId ?? record.userId ?? null : record.userId;
      const resolvedOwnershipStatus: 'bound' | 'unbound' = resolvedUid ? 'bound' : 'unbound';
      const cleanRecord: StoredPurchaseRecord = {
        ...record,
        userId: resolvedUid,
        ownershipStatus: resolvedOwnershipStatus,
        status: !resolvedUid && !record.revoked ? 'pending' : record.status,
        autoRenewing: !resolvedUid ? false : record.autoRenewing,
        lastRtdnEventTimeMillis: mergeMonotonicEventTime(
          existing?.lastRtdnEventTimeMillis,
          record.lastRtdnEventTimeMillis
        ),
        pendingClaim: false,
        pendingClaimAt: undefined,
        pendingClaimUserId: undefined,
      };
      state.purchases[cleanRecord.tokenHash] = cleanRecord;
      state.tokenIdIndex[cleanRecord.tokenId] = cleanRecord.tokenHash;
      this.writeState(state);
      return { ok: true };
    });
  }

  async getRtdnNotificationRecord(messageId: string): Promise<RtdnNotificationRecord | null> {
    return this.withLock(() => {
      const state = this.readState();
      return normalizeRtdnRecord(state.rtdnMessages[messageId] as Record<string, unknown> | undefined, messageId);
    });
  }

  async isNotificationProcessed(messageId: string): Promise<boolean> {
    return this.withLock(() => {
      const state = this.readState();
      const rec = normalizeRtdnRecord(state.rtdnMessages[messageId] as Record<string, unknown> | undefined, messageId);
      return rec?.status === 'completed';
    });
  }

  async markNotificationProcessed(messageId: string, eventType?: string): Promise<void> {
    await this.completeRtdnNotification(messageId, eventType);
  }

  async acquireRtdnProcessingLease(
    messageId: string,
    options: { eventType?: string; nowMs?: number; leaseDurationMs?: number } = {}
  ): Promise<AcquireRtdnLeaseResult> {
    const nowMs = options.nowMs ?? Date.now();
    const leaseDurationMs = options.leaseDurationMs ?? DEFAULT_RTDN_LEASE_DURATION_MS;
    return this.withLock(() => {
      const state = this.readState();
      const existing = normalizeRtdnRecord(
        state.rtdnMessages[messageId] as Record<string, unknown> | undefined,
        messageId
      );

      if (existing) {
        if (existing.status === 'completed') {
          return { acquired: false, reason: 'already_completed', record: existing };
        }
        if (existing.status === 'processing' && (existing.leaseExpiresAt || 0) > nowMs) {
          return { acquired: false, reason: 'in_progress', record: existing };
        }
      }

      const attempt = (existing?.attempts || 0) + 1;
      state.rtdnMessages[messageId] = {
        messageId,
        eventType: options.eventType || existing?.eventType || null,
        status: 'processing',
        leaseExpiresAt: nowMs + leaseDurationMs,
        attempts: attempt,
        lastError: null,
        processedAt: existing?.processedAt || nowMs,
        updatedAt: nowMs,
      };
      this.writeState(state);
      return { acquired: true, attempt };
    });
  }

  async completeRtdnNotification(
    messageId: string,
    eventType?: string,
    nowMs: number = Date.now()
  ): Promise<void> {
    return this.withLock(() => {
      const state = this.readState();
      const existing = normalizeRtdnRecord(
        state.rtdnMessages[messageId] as Record<string, unknown> | undefined,
        messageId
      );
      state.rtdnMessages[messageId] = {
        messageId,
        eventType: eventType || existing?.eventType || null,
        status: 'completed',
        attempts: existing?.attempts || 1,
        lastError: null,
        processedAt: existing?.processedAt || nowMs,
        completedAt: nowMs,
        updatedAt: nowMs,
      };
      this.writeState(state);
    });
  }

  async failRtdnNotification(
    messageId: string,
    errorMessage: string,
    eventType?: string,
    nowMs: number = Date.now()
  ): Promise<void> {
    return this.withLock(() => {
      const state = this.readState();
      const existing = normalizeRtdnRecord(
        state.rtdnMessages[messageId] as Record<string, unknown> | undefined,
        messageId
      );
      if (existing?.status === 'completed') {
        return;
      }
      state.rtdnMessages[messageId] = {
        messageId,
        eventType: eventType || existing?.eventType || null,
        status: 'failed',
        attempts: existing?.attempts || 1,
        lastError: errorMessage.slice(0, 500),
        processedAt: existing?.processedAt || nowMs,
        updatedAt: nowMs,
      };
      this.writeState(state);
    });
  }

  async tryAcquireNotificationProcessing(messageId: string, eventType?: string): Promise<boolean> {
    const res = await this.acquireRtdnProcessingLease(messageId, { eventType });
    return res.acquired;
  }

  async consumeAiQuota(
    subjectKey: string,
    maxPerMinute: number,
    maxPerMonth: number,
    nowMs: number = Date.now()
  ): Promise<QuotaCheckResult> {
    return this.withLock(() => {
      const state = this.readState();
      const currentMonthKey = new Date(nowMs).toISOString().substring(0, 7);
      const existing = state.aiQuotas[subjectKey];

      const tracker =
        existing && existing.monthKey === currentMonthKey
          ? existing
          : { monthKey: currentMonthKey, monthlyCount: 0, recentTimestamps: [] };

      const oneMinuteAgo = nowMs - 60_000;
      tracker.recentTimestamps = tracker.recentTimestamps.filter((ts) => ts > oneMinuteAgo);

      if (tracker.recentTimestamps.length >= maxPerMinute) {
        state.aiQuotas[subjectKey] = tracker;
        this.writeState(state);
        return {
          allowed: false,
          reason: 'rate_limited',
          monthlyRequestsUsed: tracker.monthlyCount,
          monthlyQuota: maxPerMonth,
        };
      }

      if (tracker.monthlyCount >= maxPerMonth) {
        state.aiQuotas[subjectKey] = tracker;
        this.writeState(state);
        return {
          allowed: false,
          reason: 'quota_exceeded',
          monthlyRequestsUsed: tracker.monthlyCount,
          monthlyQuota: maxPerMonth,
        };
      }

      tracker.recentTimestamps.push(nowMs);
      tracker.monthlyCount += 1;
      state.aiQuotas[subjectKey] = tracker;
      this.writeState(state);

      return {
        allowed: true,
        monthlyRequestsUsed: tracker.monthlyCount,
        monthlyQuota: maxPerMonth,
      };
    });
  }
}

// ============================================================================
// Firestore-Backed Production Store (Firebase Admin SDK)
// ============================================================================

export const FIRESTORE_COLLECTIONS = {
  ENTITLEMENTS: 'billing_entitlements',
  TOKEN_INDEX: 'billing_token_index',
  RTDN_NOTIFICATIONS: 'rtdn_notifications',
  AI_QUOTAS: 'ai_usage_quotas',
} as const;

export interface FirestoreDocKey {
  collection: string;
  id: string;
}

export interface FirestoreTxAdapter {
  get(key: FirestoreDocKey): Promise<Record<string, unknown> | null>;
  set(key: FirestoreDocKey, data: Record<string, unknown>): void;
  delete(key: FirestoreDocKey): void;
}

export interface FirestoreDriver {
  getDoc(key: FirestoreDocKey): Promise<Record<string, unknown> | null>;
  setDoc(key: FirestoreDocKey, data: Record<string, unknown>): Promise<void>;
  deleteDoc(key: FirestoreDocKey): Promise<void>;
  runTransaction<T>(fn: (tx: FirestoreTxAdapter) => Promise<T>): Promise<T>;
}

export function createAdminFirestoreDriver(db: Firestore): FirestoreDriver {
  const refFor = (key: FirestoreDocKey): DocumentReference => db.collection(key.collection).doc(key.id);

  return {
    async getDoc(key) {
      const snap = await refFor(key).get();
      return snap.exists ? ((snap.data() as Record<string, unknown>) || null) : null;
    },
    async setDoc(key, data) {
      await refFor(key).set(stripUndefinedFields(data));
    },
    async deleteDoc(key) {
      await refFor(key).delete();
    },
    async runTransaction<T>(fn: (tx: FirestoreTxAdapter) => Promise<T>): Promise<T> {
      return db.runTransaction(async (adminTx: Transaction) => {
        const adapter: FirestoreTxAdapter = {
          async get(key) {
            const snap = await adminTx.get(refFor(key));
            return snap.exists ? ((snap.data() as Record<string, unknown>) || null) : null;
          },
          set(key, data) {
            adminTx.set(refFor(key), stripUndefinedFields(data));
          },
          delete(key) {
            adminTx.delete(refFor(key));
          },
        };
        return fn(adapter);
      });
    },
  };
}

/**
 * Production Firestore EntitlementStore backed by Firebase Admin SDK.
 * Uses Firestore atomic transactions for purchase ownership, replay protection,
 * RTDN deduplication, and multi-instance AI quota enforcement.
 */
export class FirestoreEntitlementStore implements EntitlementStore {
  public readonly backendName = 'firestore' as const;
  private readonly driver: FirestoreDriver;

  constructor(firestoreOrDriver: Firestore | FirestoreDriver) {
    if ('runTransaction' in firestoreOrDriver && 'collection' in firestoreOrDriver) {
      this.driver = createAdminFirestoreDriver(firestoreOrDriver as Firestore);
    } else {
      this.driver = firestoreOrDriver as FirestoreDriver;
    }
  }

  private entitlementKey(tokenHash: string): FirestoreDocKey {
    return { collection: FIRESTORE_COLLECTIONS.ENTITLEMENTS, id: tokenHash };
  }

  private tokenIndexKey(tokenId: string): FirestoreDocKey {
    return { collection: FIRESTORE_COLLECTIONS.TOKEN_INDEX, id: tokenId };
  }

  private rtdnKey(messageId: string): FirestoreDocKey {
    // Sanitize Firestore document ID slashes if any
    const safeId = messageId.replace(/\//g, '_');
    return { collection: FIRESTORE_COLLECTIONS.RTDN_NOTIFICATIONS, id: safeId };
  }

  private quotaKey(subjectKey: string): FirestoreDocKey {
    const safeId = subjectKey.replace(/\//g, '_');
    return { collection: FIRESTORE_COLLECTIONS.AI_QUOTAS, id: safeId };
  }

  async getPurchaseRecord(tokenHash: string): Promise<StoredPurchaseRecord | null> {
    const data = await this.driver.getDoc(this.entitlementKey(tokenHash));
    return data ? (data as unknown as StoredPurchaseRecord) : null;
  }

  async getPurchaseRecordByTokenId(tokenId: string): Promise<StoredPurchaseRecord | null> {
    const indexDoc = await this.driver.getDoc(this.tokenIndexKey(tokenId));
    const tokenHash = typeof indexDoc?.tokenHash === 'string' ? indexDoc.tokenHash : null;
    if (!tokenHash) return null;
    return this.getPurchaseRecord(tokenHash);
  }

  async getPurchaseRecordByUserId(userId: string): Promise<StoredPurchaseRecord | null> {
    const safeUid = crypto.createHash('sha256').update(userId).digest('hex');
    const indexDoc = await this.driver.getDoc({ collection: FIRESTORE_COLLECTIONS.USER_ENTITLEMENTS, id: safeUid });
    const tokenHash = typeof indexDoc?.tokenHash === 'string' ? indexDoc.tokenHash : null;
    if (!tokenHash) return null;
    const record = await this.getPurchaseRecord(tokenHash);
    return record?.userId === userId && record.ownershipStatus !== 'unbound' ? record : null;
  }

  async upsertPurchaseRecord(record: StoredPurchaseRecord): Promise<void> {
    await this.driver.runTransaction(async (tx) => {
      tx.set(this.entitlementKey(record.tokenHash), record as unknown as Record<string, unknown>);
      tx.set(this.tokenIndexKey(record.tokenId), {
        tokenHash: record.tokenHash,
        userId: record.userId ?? null,
        ownershipStatus: record.userId ? 'bound' : 'unbound',
        productId: record.productId,
        updatedAt: record.updatedAt,
      });
      if (record.userId) {
        const safeUid = crypto.createHash('sha256').update(record.userId).digest('hex');
        tx.set({ collection: FIRESTORE_COLLECTIONS.USER_ENTITLEMENTS, id: safeUid }, {
          tokenHash: record.tokenHash, userId: record.userId, updatedAt: record.updatedAt,
        });
      }
    });
  }

  async acquirePurchaseVerificationLock(params: AcquirePurchaseLockParams): Promise<AcquirePurchaseLockResult> {
    return this.driver.runTransaction(async (tx) => {
      let raw = await tx.get(this.entitlementKey(params.tokenHash));
      let indexDoc: Record<string, unknown> | null = null;
      if (!raw || !raw.userId) {
        indexDoc = await tx.get(this.tokenIndexKey(params.tokenId));
        const indexedHash = typeof indexDoc?.tokenHash === 'string' ? indexDoc.tokenHash : null;
        if (!raw && indexedHash) {
          raw = await tx.get(this.entitlementKey(indexedHash));
        }
      }

      let existing = raw ? (raw as unknown as StoredPurchaseRecord) : null;
      if (existing && !existing.userId && typeof indexDoc?.userId === 'string' && indexDoc.userId) {
        existing = { ...existing, userId: indexDoc.userId, ownershipStatus: 'bound' };
      }

      const evaluation = evaluatePurchaseLock(existing, params);

      if (!evaluation.allowed) {
        return {
          ok: false,
          reason: evaluation.reason,
          existing,
        };
      }

      if (params.mode === 'purchase' && params.userId) {
        if (existing) {
          tx.set(this.entitlementKey(params.tokenHash), {
            ...existing,
            pendingClaim: true,
            pendingClaimAt: params.nowMs,
            pendingClaimUserId: params.userId,
            updatedAt: params.nowMs,
          });
          return { ok: true, existing, createdReservation: false };
        }

        const reservation: StoredPurchaseRecord = {
          tokenHash: params.tokenHash,
          tokenId: params.tokenId,
          userId: params.userId,
          ownershipStatus: 'bound',
          productId: params.productId || '',
          latestOrderId: params.requestedOrderId,
          subscriptionState: 'SUBSCRIPTION_STATE_UNSPECIFIED',
          status: 'pending',
          expiryTimeMillis: 0,
          autoRenewing: false,
          cancelAtPeriodEnd: false,
          acknowledged: false,
          revoked: false,
          pendingClaim: true,
          pendingClaimAt: params.nowMs,
          pendingClaimUserId: params.userId,
          createdAt: params.nowMs,
          updatedAt: params.nowMs,
          lastVerifiedAt: params.nowMs,
        };
        tx.set(this.entitlementKey(params.tokenHash), reservation as unknown as Record<string, unknown>);
        tx.set(this.tokenIndexKey(params.tokenId), {
          tokenHash: params.tokenHash,
          userId: params.userId,
          ownershipStatus: 'bound',
          productId: params.productId || '',
          updatedAt: params.nowMs,
        });
        return { ok: true, existing: null, createdReservation: true };
      }

      return { ok: true, existing, createdReservation: false };
    });
  }

  async releasePurchaseVerificationLock(tokenHash: string, deleteIfUncommitted: boolean): Promise<void> {
    await this.driver.runTransaction(async (tx) => {
      const raw = await tx.get(this.entitlementKey(tokenHash));
      const existing = raw ? (raw as unknown as StoredPurchaseRecord) : null;
      if (!existing) return;

      if (
        deleteIfUncommitted &&
        !existing.acknowledged &&
        existing.expiryTimeMillis === 0 &&
        existing.ownershipStatus !== 'unbound'
      ) {
        tx.delete(this.entitlementKey(tokenHash));
        tx.delete(this.tokenIndexKey(existing.tokenId));
      } else {
        const updated: Record<string, unknown> = { ...existing, pendingClaim: false };
        delete updated.pendingClaimAt;
        delete updated.pendingClaimUserId;
        tx.set(this.entitlementKey(tokenHash), updated);
      }
    });
  }

  async commitVerifiedPurchase(
    record: StoredPurchaseRecord,
    mode: 'purchase' | 'restore' | 'rtdn'
  ): Promise<CommitVerifiedPurchaseResult> {
    return this.driver.runTransaction(async (tx) => {
      const raw = await tx.get(this.entitlementKey(record.tokenHash));
      const indexDoc = await tx.get(this.tokenIndexKey(record.tokenId));
      const existing = raw ? (raw as unknown as StoredPurchaseRecord) : null;
      const indexedUid = typeof indexDoc?.userId === 'string' && indexDoc.userId ? indexDoc.userId : null;
      const boundUserId = existing?.userId || indexedUid || null;

      if (mode !== 'rtdn' && boundUserId && boundUserId !== record.userId) {
        return { ok: false, reason: 'cross_user_replay' };
      }
      if (existing?.revoked && !record.revoked) {
        return { ok: false, reason: 'revoked' };
      }
      if (mode === 'rtdn' && isStaleRtdnCommit(existing, record)) {
        return { ok: false, reason: 'stale_notification' };
      }

      const resolvedUid = mode === 'rtdn' ? boundUserId ?? record.userId ?? null : record.userId;
      const resolvedOwnershipStatus: 'bound' | 'unbound' = resolvedUid ? 'bound' : 'unbound';
      const monotonicEventTime = mergeMonotonicEventTime(
        existing?.lastRtdnEventTimeMillis,
        record.lastRtdnEventTimeMillis
      );

      const cleanRecord: Record<string, unknown> = {
        ...record,
        userId: resolvedUid,
        ownershipStatus: resolvedOwnershipStatus,
        status: !resolvedUid && !record.revoked ? 'pending' : record.status,
        autoRenewing: !resolvedUid ? false : record.autoRenewing,
        lastRtdnEventTimeMillis: monotonicEventTime,
        pendingClaim: false,
      };
      delete cleanRecord.pendingClaimAt;
      delete cleanRecord.pendingClaimUserId;

      tx.set(this.entitlementKey(record.tokenHash), cleanRecord);
      tx.set(this.tokenIndexKey(record.tokenId), {
        tokenHash: record.tokenHash,
        userId: resolvedUid,
        ownershipStatus: resolvedOwnershipStatus,
        productId: record.productId,
        updatedAt: record.updatedAt,
      });
      if (resolvedUid) {
        const safeUid = crypto.createHash('sha256').update(resolvedUid).digest('hex');
        tx.set({ collection: FIRESTORE_COLLECTIONS.USER_ENTITLEMENTS, id: safeUid }, {
          tokenHash: record.tokenHash, userId: resolvedUid, updatedAt: record.updatedAt,
        });
      }
      return { ok: true };
    });
  }

  async getRtdnNotificationRecord(messageId: string): Promise<RtdnNotificationRecord | null> {
    const raw = await this.driver.getDoc(this.rtdnKey(messageId));
    return normalizeRtdnRecord(raw, messageId);
  }

  async isNotificationProcessed(messageId: string): Promise<boolean> {
    const rec = await this.getRtdnNotificationRecord(messageId);
    return rec?.status === 'completed';
  }

  async markNotificationProcessed(messageId: string, eventType?: string): Promise<void> {
    await this.completeRtdnNotification(messageId, eventType);
  }

  async acquireRtdnProcessingLease(
    messageId: string,
    options: { eventType?: string; nowMs?: number; leaseDurationMs?: number } = {}
  ): Promise<AcquireRtdnLeaseResult> {
    const nowMs = options.nowMs ?? Date.now();
    const leaseDurationMs = options.leaseDurationMs ?? DEFAULT_RTDN_LEASE_DURATION_MS;
    return this.driver.runTransaction(async (tx) => {
      const key = this.rtdnKey(messageId);
      const existing = normalizeRtdnRecord(await tx.get(key), messageId);

      if (existing) {
        if (existing.status === 'completed') {
          return { acquired: false, reason: 'already_completed', record: existing };
        }
        if (existing.status === 'processing' && (existing.leaseExpiresAt || 0) > nowMs) {
          return { acquired: false, reason: 'in_progress', record: existing };
        }
      }

      const attempt = (existing?.attempts || 0) + 1;
      tx.set(key, {
        messageId,
        eventType: options.eventType || existing?.eventType || null,
        status: 'processing',
        leaseExpiresAt: nowMs + leaseDurationMs,
        attempts: attempt,
        lastError: null,
        processedAt: existing?.processedAt || nowMs,
        updatedAt: nowMs,
      });
      return { acquired: true, attempt };
    });
  }

  async completeRtdnNotification(
    messageId: string,
    eventType?: string,
    nowMs: number = Date.now()
  ): Promise<void> {
    await this.driver.runTransaction(async (tx) => {
      const key = this.rtdnKey(messageId);
      const existing = normalizeRtdnRecord(await tx.get(key), messageId);
      tx.set(key, {
        messageId,
        eventType: eventType || existing?.eventType || null,
        status: 'completed',
        attempts: existing?.attempts || 1,
        lastError: null,
        processedAt: existing?.processedAt || nowMs,
        completedAt: nowMs,
        updatedAt: nowMs,
      });
    });
  }

  async failRtdnNotification(
    messageId: string,
    errorMessage: string,
    eventType?: string,
    nowMs: number = Date.now()
  ): Promise<void> {
    await this.driver.runTransaction(async (tx) => {
      const key = this.rtdnKey(messageId);
      const existing = normalizeRtdnRecord(await tx.get(key), messageId);
      if (existing?.status === 'completed') {
        return;
      }
      tx.set(key, {
        messageId,
        eventType: eventType || existing?.eventType || null,
        status: 'failed',
        attempts: existing?.attempts || 1,
        lastError: errorMessage.slice(0, 500),
        processedAt: existing?.processedAt || nowMs,
        updatedAt: nowMs,
      });
    });
  }

  async tryAcquireNotificationProcessing(messageId: string, eventType?: string): Promise<boolean> {
    const res = await this.acquireRtdnProcessingLease(messageId, { eventType });
    return res.acquired;
  }

  async consumeAiQuota(
    subjectKey: string,
    maxPerMinute: number,
    maxPerMonth: number,
    nowMs: number = Date.now()
  ): Promise<QuotaCheckResult> {
    return this.driver.runTransaction(async (tx) => {
      const key = this.quotaKey(subjectKey);
      const currentMonthKey = new Date(nowMs).toISOString().substring(0, 7);
      const raw = await tx.get(key);

      const existingMonthKey = typeof raw?.monthKey === 'string' ? raw.monthKey : null;
      const tracker =
        raw && existingMonthKey === currentMonthKey
          ? {
              monthKey: currentMonthKey,
              monthlyCount: Number(raw.monthlyCount || 0),
              recentTimestamps: Array.isArray(raw.recentTimestamps)
                ? (raw.recentTimestamps as number[])
                : [],
            }
          : { monthKey: currentMonthKey, monthlyCount: 0, recentTimestamps: [] };

      const oneMinuteAgo = nowMs - 60_000;
      tracker.recentTimestamps = tracker.recentTimestamps.filter((ts) => ts > oneMinuteAgo);

      if (tracker.recentTimestamps.length >= maxPerMinute) {
        tx.set(key, { ...tracker, updatedAt: nowMs });
        return {
          allowed: false,
          reason: 'rate_limited',
          monthlyRequestsUsed: tracker.monthlyCount,
          monthlyQuota: maxPerMonth,
        };
      }

      if (tracker.monthlyCount >= maxPerMonth) {
        tx.set(key, { ...tracker, updatedAt: nowMs });
        return {
          allowed: false,
          reason: 'quota_exceeded',
          monthlyRequestsUsed: tracker.monthlyCount,
          monthlyQuota: maxPerMonth,
        };
      }

      tracker.recentTimestamps.push(nowMs);
      tracker.monthlyCount += 1;
      tx.set(key, { ...tracker, updatedAt: nowMs });

      return {
        allowed: true,
        monthlyRequestsUsed: tracker.monthlyCount,
        monthlyQuota: maxPerMonth,
      };
    });
  }
}

// ============================================================================
// Explicit Environment Store Resolution & Production Fail-Closed Enforcement
// ============================================================================

let defaultStoreSingleton: EntitlementStore | null = null;
let configuredFirestoreSingleton: FirestoreEntitlementStore | null = null;

export interface ResolveEntitlementStoreOptions {
  nodeEnv?: string;
  backend?: string;
  storePath?: string;
  firestoreClient?: Firestore | FirestoreDriver | null;
  firebaseAdminConfigured?: boolean;
}

/**
 * Resolves the entitlement store strictly from explicit server configuration.
 *
 * Production Policy (NODE_ENV === 'production'):
 * - MUST explicitly select ENTITLEMENT_STORE_BACKEND='firestore'.
 * - MUST have Firebase Admin Firestore credentials configured.
 * - NEVER silently falls back to local JSON FileEntitlementStore.
 */
export async function resolveEntitlementStore(
  options: ResolveEntitlementStoreOptions = {}
): Promise<EntitlementStore> {
  const nodeEnv = (options.nodeEnv ?? process.env.NODE_ENV ?? 'development').trim().toLowerCase();
  const rawBackend = (options.backend ?? process.env.ENTITLEMENT_STORE_BACKEND ?? '').trim().toLowerCase();
  const isProd = nodeEnv === 'production';

  if (isProd) {
    if (rawBackend !== 'firestore') {
      throw new EntitlementStoreConfigurationError(
        `FAIL_CLOSED: Production requires ENTITLEMENT_STORE_BACKEND="firestore" (got "${rawBackend || 'unset'}"). Local JSON file fallback is forbidden in production.`
      );
    }

    const driverOrDb = options.firestoreClient ?? (await getAdminFirestore());
    const hasAdmin = options.firestoreClient ? true : (options.firebaseAdminConfigured ?? isFirebaseAdminConfigured());

    if (!hasAdmin || !driverOrDb) {
      throw new EntitlementStoreConfigurationError(
        'FAIL_CLOSED: Production Firestore persistence is missing Firebase Admin credentials (FIREBASE_SERVICE_ACCOUNT_KEY, GOOGLE_APPLICATION_CREDENTIALS, or Cloud Run USE_GCP_ADC=true).'
      );
    }

    return new FirestoreEntitlementStore(driverOrDb);
  }

  if (rawBackend === 'firestore') {
    const driverOrDb = options.firestoreClient ?? (await getAdminFirestore());
    const hasAdmin = options.firestoreClient ? true : (options.firebaseAdminConfigured ?? isFirebaseAdminConfigured());

    if (!hasAdmin || !driverOrDb) {
      throw new EntitlementStoreConfigurationError(
        'FAIL_CLOSED: ENTITLEMENT_STORE_BACKEND="firestore" was configured, but Firebase Admin credentials are missing.'
      );
    }

    return new FirestoreEntitlementStore(driverOrDb);
  }

  const storePath =
    options.storePath || process.env.ENTITLEMENT_STORE_PATH || path.join(process.cwd(), '.data', 'entitlements.json');
  return new FileEntitlementStore(storePath);
}

/**
 * Returns the active configured EntitlementStore synchronously or async.
 * In production, throws EntitlementStoreConfigurationError if Firestore is not configured
 * (never silently falls back to FileEntitlementStore).
 */
export async function getConfiguredEntitlementStore(): Promise<EntitlementStore> {
  if (defaultStoreSingleton) {
    return defaultStoreSingleton;
  }

  const nodeEnv = (process.env.NODE_ENV ?? 'development').trim().toLowerCase();
  const rawBackend = (process.env.ENTITLEMENT_STORE_BACKEND ?? '').trim().toLowerCase();

  if (nodeEnv === 'production' || rawBackend === 'firestore') {
    if (configuredFirestoreSingleton) {
      return configuredFirestoreSingleton;
    }
    const store = await resolveEntitlementStore();
    if (store instanceof FirestoreEntitlementStore) {
      configuredFirestoreSingleton = store;
    }
    return store;
  }

  return getDefaultEntitlementStore();
}

/**
 * Synchronous accessor for local development & tests only.
 * Throws EntitlementStoreConfigurationError if called in production without an injected store.
 */
export function getDefaultEntitlementStore(): EntitlementStore {
  if (defaultStoreSingleton) {
    return defaultStoreSingleton;
  }

  const nodeEnv = (process.env.NODE_ENV ?? 'development').trim().toLowerCase();
  const rawBackend = (process.env.ENTITLEMENT_STORE_BACKEND ?? '').trim().toLowerCase();

  if (nodeEnv === 'production') {
    if (configuredFirestoreSingleton) {
      return configuredFirestoreSingleton;
    }
    throw new EntitlementStoreConfigurationError(
      'FAIL_CLOSED: Production cannot fall back synchronously to local FileEntitlementStore. Initialize Firestore persistence explicitly.'
    );
  }

  if (rawBackend === 'firestore') {
    if (configuredFirestoreSingleton) {
      return configuredFirestoreSingleton;
    }
    throw new EntitlementStoreConfigurationError(
      'FAIL_CLOSED: Firestore EntitlementStore has not been initialized yet.'
    );
  }

  const storePath = process.env.ENTITLEMENT_STORE_PATH || path.join(process.cwd(), '.data', 'entitlements.json');
  defaultStoreSingleton = new FileEntitlementStore(storePath);
  return defaultStoreSingleton;
}

export function setDefaultEntitlementStoreForTests(store: EntitlementStore | null): void {
  defaultStoreSingleton = store;
  configuredFirestoreSingleton = null;
}

/**
 * Reports whether the configured persistence store is ready for the current runtime mode.
 */
export function getEntitlementStoreStatus(): {
  backend: 'firestore' | 'file' | 'unconfigured';
  ready: boolean;
  reason?: string;
} {
  const nodeEnv = (process.env.NODE_ENV ?? 'development').trim().toLowerCase();
  const rawBackend = (process.env.ENTITLEMENT_STORE_BACKEND ?? '').trim().toLowerCase();

  if (nodeEnv === 'production') {
    if (rawBackend !== 'firestore') {
      return {
        backend: 'unconfigured',
        ready: false,
        reason: 'Production requires ENTITLEMENT_STORE_BACKEND=firestore.',
      };
    }
    if (!isFirebaseAdminConfigured()) {
      return {
        backend: 'unconfigured',
        ready: false,
        reason: 'Firebase Admin credentials are not configured for Firestore persistence.',
      };
    }
    return { backend: 'firestore', ready: true };
  }

  if (rawBackend === 'firestore') {
    if (!isFirebaseAdminConfigured()) {
      return {
        backend: 'unconfigured',
        ready: false,
        reason: 'ENTITLEMENT_STORE_BACKEND=firestore requires Firebase Admin credentials.',
      };
    }
    return { backend: 'firestore', ready: true };
  }

  return { backend: 'file', ready: true };
}
