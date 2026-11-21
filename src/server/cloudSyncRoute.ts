/**
 * Premium-Only User-Scoped Cloud Sync & Backup Server Endpoints.
 *
 * Security & Integrity Guarantees:
 * - Requires verified Firebase ID token on every request (401 unauthorized otherwise).
 * - Requires verified server-side active Play Billing Premium entitlement (403 premium_required).
 * - Never trusts client-supplied tier headers, UIDs in body/query, or unsigned local flags.
 * - Isolates all snapshots strictly under users/{verifiedUid}/cloud_sync/{doc}.
 * - Enforces atomic compare-and-set revision checks + idempotency keys (409 revision_conflict).
 * - Preserves previous cloud snapshot automatically for 1-click cloud backup recovery.
 * - Fails closed (503) in production if Firebase Admin / Firestore persistence is unavailable.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Firestore } from 'firebase-admin/firestore';
import type { Request, Response } from 'express';
import {
  EntitlementStore,
  getConfiguredEntitlementStore,
  getEntitlementStoreStatus,
} from './entitlementStore.ts';
import {
  getAdminFirestore,
  isFirebaseAdminConfigured,
  verifyFirebaseIdToken,
} from './firebaseAdmin.ts';
import { isPurchaseRecordActivePremium } from './playBillingVerification.ts';
import {
  BudgetSettings,
  CurrencyCode,
  Expense,
  PlanData,
  SavingsChallenge,
} from '../types/expense';
import { VALID_CURRENCIES, isValidExpenseItem } from '../utils/storage';

export interface CloudSyncDeletedTombstone {
  id: string;
  deletedAt: number;
}

export interface CloudSyncSnapshotV1 {
  schemaVersion: 1;
  transactions: Expense[];
  deletedTombstones?: CloudSyncDeletedTombstone[];
  budget: BudgetSettings;
  plan: PlanData;
  currency: CurrencyCode;
  currencyUpdatedAt?: number;
  country: string | null;
  countryUpdatedAt?: number;
  challenges: SavingsChallenge[];
  challengesUpdatedAt?: number;
}

export interface StoredCloudSyncSnapshot {
  schemaVersion: 1;
  revision: number;
  snapshot: CloudSyncSnapshotV1;
  updatedAt: number;
  idempotencyKey: string;
  payloadHash: string;
}

export interface CloudSyncRecordBundle {
  current: StoredCloudSyncSnapshot | null;
  previous: StoredCloudSyncSnapshot | null;
}

export interface CloudSyncPersistence {
  consumeRateLimit(uid: string, nowMs: number, maxPerMinute: number): Promise<boolean>;
  get(uid: string): Promise<StoredCloudSyncSnapshot | null>;
  getWithBackup?(uid: string): Promise<CloudSyncRecordBundle>;
  compareAndSet(
    uid: string,
    expectedRevision: number,
    next: StoredCloudSyncSnapshot
  ): Promise<{ ok: true } | { ok: false; currentRevision: number }>;
  restorePreviousBackup?(
    uid: string,
    nowMs: number
  ): Promise<
    | { ok: true; restored: StoredCloudSyncSnapshot }
    | { ok: false; reason: 'no_previous_backup' | 'conflict'; currentRevision?: number }
  >;
}

export interface CloudSyncRouteDeps {
  store?: EntitlementStore;
  persistence?: CloudSyncPersistence;
  verifyCallerToken?: (bearer: string) => Promise<{ uid: string } | null>;
  now?: () => number;
}

const MAX_SNAPSHOT_BYTES = 192 * 1024;
const MAX_REQUESTS_PER_MINUTE = 30;

function getUidDocumentId(uid: string): string {
  if (!uid || uid.length > 128 || uid.includes('/') || uid === '.' || uid === '..') {
    throw new Error('Invalid verified Firebase UID.');
  }
  return uid;
}

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        out[k] = stripUndefinedDeep(v);
      }
    }
    return out as T;
  }
  return value;
}

export function createAdminCloudSyncPersistence(db: Firestore): CloudSyncPersistence {
  const refFor = (uid: string) =>
    db.collection('users').doc(getUidDocumentId(uid)).collection('cloud_sync').doc('snapshot');
  const prevRefFor = (uid: string) =>
    db.collection('users').doc(getUidDocumentId(uid)).collection('cloud_sync').doc('previous_snapshot');

  return {
    async consumeRateLimit(uid, nowMs, maxPerMinute) {
      const ref = db
        .collection('users')
        .doc(getUidDocumentId(uid))
        .collection('cloud_sync')
        .doc('rate_limit');
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const raw = snap.exists ? snap.data() : undefined;
        const cutoff = nowMs - 60_000;
        const recent = Array.isArray(raw?.recentTimestamps)
          ? (raw!.recentTimestamps as unknown[]).filter(
              (value): value is number =>
                typeof value === 'number' && Number.isFinite(value) && value > cutoff
            )
          : [];
        if (recent.length >= maxPerMinute) return false;
        recent.push(nowMs);
        tx.set(ref, { recentTimestamps: recent, updatedAt: nowMs });
        return true;
      });
    },

    async get(uid) {
      const snap = await refFor(uid).get();
      if (!snap.exists) return null;
      return snap.data() as StoredCloudSyncSnapshot;
    },

    async getWithBackup(uid) {
      const [currSnap, prevSnap] = await Promise.all([refFor(uid).get(), prevRefFor(uid).get()]);
      return {
        current: currSnap.exists ? (currSnap.data() as StoredCloudSyncSnapshot) : null,
        previous: prevSnap.exists ? (prevSnap.data() as StoredCloudSyncSnapshot) : null,
      };
    },

    async compareAndSet(uid, expectedRevision, next) {
      const ref = refFor(uid);
      const prevRef = prevRefFor(uid);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const current = snap.exists ? (snap.data() as StoredCloudSyncSnapshot) : null;
        const currentRevision = current?.revision ?? 0;
        if (current?.idempotencyKey === next.idempotencyKey) {
          if (current.payloadHash === next.payloadHash) return { ok: true as const };
          return { ok: false as const, currentRevision };
        }
        if (currentRevision !== expectedRevision) {
          return { ok: false as const, currentRevision };
        }
        if (current) {
          tx.set(prevRef, stripUndefinedDeep(current));
        }
        tx.set(ref, stripUndefinedDeep(next));
        return { ok: true as const };
      });
    },

    async restorePreviousBackup(uid, nowMs) {
      const ref = refFor(uid);
      const prevRef = prevRefFor(uid);
      return db.runTransaction(async (tx) => {
        const [currSnap, prevSnap] = await Promise.all([tx.get(ref), tx.get(prevRef)]);
        if (!prevSnap.exists) {
          return { ok: false as const, reason: 'no_previous_backup' as const };
        }
        const current = currSnap.exists ? (currSnap.data() as StoredCloudSyncSnapshot) : null;
        const previous = prevSnap.data() as StoredCloudSyncSnapshot;
        const nextRevision = (current?.revision ?? 0) + 1;
        const restored: StoredCloudSyncSnapshot = {
          schemaVersion: 1,
          revision: nextRevision,
          snapshot: previous.snapshot,
          updatedAt: nowMs,
          idempotencyKey: `restore-${nowMs}-${nextRevision}`,
          payloadHash: crypto
            .createHash('sha256')
            .update(`restore:${nextRevision}:${JSON.stringify(previous.snapshot)}`)
            .digest('hex'),
        };
        if (current) {
          tx.set(prevRef, stripUndefinedDeep(current));
        }
        tx.set(ref, stripUndefinedDeep(restored));
        return { ok: true as const, restored };
      });
    },
  };
}

interface LocalCloudSyncFileState {
  users: Record<
    string,
    {
      snapshot?: StoredCloudSyncSnapshot;
      previousSnapshot?: StoredCloudSyncSnapshot;
      rateLimit?: number[];
    }
  >;
}

/**
 * Local file persistence strictly for development / automated testing.
 * Never used when NODE_ENV === 'production' or ENTITLEMENT_STORE_BACKEND === 'firestore'.
 */
export class FileCloudSyncPersistence implements CloudSyncPersistence {
  private readonly filePath: string;

  constructor(
    filePath: string = process.env.CLOUD_SYNC_STORE_PATH ||
      path.join(process.cwd(), '.data', 'cloud_sync.json')
  ) {
    this.filePath = filePath;
  }

  private readState(): LocalCloudSyncFileState {
    try {
      if (!fs.existsSync(this.filePath)) {
        return { users: {} };
      }
      const raw = fs.readFileSync(this.filePath, 'utf8');
      if (!raw.trim()) return { users: {} };
      const parsed = JSON.parse(raw) as LocalCloudSyncFileState;
      return parsed && typeof parsed === 'object' && parsed.users ? parsed : { users: {} };
    } catch {
      return { users: {} };
    }
  }

  private writeState(state: LocalCloudSyncFileState): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.filePath, JSON.stringify(state, null, 2), 'utf8');
  }

  async consumeRateLimit(uid: string, nowMs: number, maxPerMinute: number): Promise<boolean> {
    const safeUid = getUidDocumentId(uid);
    const state = this.readState();
    const userEntry = state.users[safeUid] || {};
    const cutoff = nowMs - 60_000;
    const recent = (userEntry.rateLimit || []).filter((ts) => ts > cutoff);
    if (recent.length >= maxPerMinute) {
      userEntry.rateLimit = recent;
      state.users[safeUid] = userEntry;
      this.writeState(state);
      return false;
    }
    recent.push(nowMs);
    userEntry.rateLimit = recent;
    state.users[safeUid] = userEntry;
    this.writeState(state);
    return true;
  }

  async get(uid: string): Promise<StoredCloudSyncSnapshot | null> {
    const safeUid = getUidDocumentId(uid);
    const state = this.readState();
    return state.users[safeUid]?.snapshot || null;
  }

  async getWithBackup(uid: string): Promise<CloudSyncRecordBundle> {
    const safeUid = getUidDocumentId(uid);
    const state = this.readState();
    return {
      current: state.users[safeUid]?.snapshot || null,
      previous: state.users[safeUid]?.previousSnapshot || null,
    };
  }

  async compareAndSet(
    uid: string,
    expectedRevision: number,
    next: StoredCloudSyncSnapshot
  ): Promise<{ ok: true } | { ok: false; currentRevision: number }> {
    const safeUid = getUidDocumentId(uid);
    const state = this.readState();
    const userEntry = state.users[safeUid] || {};
    const current = userEntry.snapshot || null;
    const currentRevision = current?.revision ?? 0;

    if (current?.idempotencyKey === next.idempotencyKey) {
      if (current.payloadHash === next.payloadHash) return { ok: true };
      return { ok: false, currentRevision };
    }
    if (currentRevision !== expectedRevision) {
      return { ok: false, currentRevision };
    }

    if (current) {
      userEntry.previousSnapshot = current;
    }
    userEntry.snapshot = stripUndefinedDeep(next);
    state.users[safeUid] = userEntry;
    this.writeState(state);
    return { ok: true };
  }

  async restorePreviousBackup(uid: string, nowMs: number) {
    const safeUid = getUidDocumentId(uid);
    const state = this.readState();
    const userEntry = state.users[safeUid];
    if (!userEntry?.previousSnapshot) {
      return { ok: false as const, reason: 'no_previous_backup' as const };
    }
    const current = userEntry.snapshot || null;
    const previous = userEntry.previousSnapshot;
    const nextRevision = (current?.revision ?? 0) + 1;
    const restored: StoredCloudSyncSnapshot = {
      schemaVersion: 1,
      revision: nextRevision,
      snapshot: previous.snapshot,
      updatedAt: nowMs,
      idempotencyKey: `restore-${nowMs}-${nextRevision}`,
      payloadHash: crypto
        .createHash('sha256')
        .update(`restore:${nextRevision}:${JSON.stringify(previous.snapshot)}`)
        .digest('hex'),
    };
    if (current) {
      userEntry.previousSnapshot = current;
    }
    userEntry.snapshot = restored;
    state.users[safeUid] = userEntry;
    this.writeState(state);
    return { ok: true as const, restored };
  }
}

let defaultFilePersistenceSingleton: FileCloudSyncPersistence | null = null;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function validateCloudSyncSnapshot(input: unknown): CloudSyncSnapshotV1 | null {
  if (!isPlainObject(input) || input.schemaVersion !== 1) return null;
  if (!Array.isArray(input.transactions) || input.transactions.length > 5000) return null;
  if (
    !input.transactions.every((item) => {
      if (!isValidExpenseItem(item)) return false;
      const tx = item as Expense;
      return (
        tx.id.length <= 128 &&
        tx.category.length <= 80 &&
        tx.date.length === 10 &&
        (!tx.paymentMethod ||
          (typeof tx.paymentMethod === 'string' && tx.paymentMethod.length <= 80)) &&
        (!tx.notes || (typeof tx.notes === 'string' && tx.notes.length <= 2000)) &&
        (!tx.description ||
          (typeof tx.description === 'string' && tx.description.length <= 2000)) &&
        isFiniteNumber(tx.createdAt) &&
        isFiniteNumber(tx.updatedAt)
      );
    })
  ) {
    return null;
  }

  let deletedTombstones: CloudSyncDeletedTombstone[] | undefined;
  if (input.deletedTombstones !== undefined) {
    if (!Array.isArray(input.deletedTombstones) || input.deletedTombstones.length > 1000) {
      return null;
    }
    const validTombstones = input.deletedTombstones.every(
      (item) =>
        isPlainObject(item) &&
        typeof item.id === 'string' &&
        item.id.length > 0 &&
        item.id.length <= 128 &&
        isFiniteNumber(item.deletedAt)
    );
    if (!validTombstones) return null;
    deletedTombstones = input.deletedTombstones as CloudSyncDeletedTombstone[];
  }

  if (
    !isPlainObject(input.budget) ||
    !isFiniteNumber(input.budget.monthlyBudget) ||
    input.budget.monthlyBudget <= 0 ||
    !isFiniteNumber(input.budget.lastUpdated)
  ) {
    return null;
  }

  const plan = input.plan;
  if (!isPlainObject(plan)) return null;
  const planFields = ['availableMoney', 'upcomingBills', 'otherExpenses', 'proposedPurchase'];
  if (
    !planFields.every(
      (field) => typeof plan[field] === 'string' && (plan[field] as string).length <= 80
    )
  ) {
    return null;
  }
  if (plan.categoryBudgets !== undefined) {
    if (!isPlainObject(plan.categoryBudgets) || Object.keys(plan.categoryBudgets).length > 40) {
      return null;
    }
    if (
      !Object.values(plan.categoryBudgets).every(
        (value) => typeof value === 'string' && value.length <= 80
      )
    ) {
      return null;
    }
  }
  if (plan.lastSaved !== undefined && !isFiniteNumber(plan.lastSaved)) return null;

  if (
    typeof input.currency !== 'string' ||
    !VALID_CURRENCIES.includes(input.currency as CurrencyCode)
  ) {
    return null;
  }
  if (
    input.country !== null &&
    (typeof input.country !== 'string' || !/^[A-Z]{2}$/.test(input.country))
  ) {
    return null;
  }

  if (!Array.isArray(input.challenges) || input.challenges.length > 100) return null;
  if (
    !input.challenges.every(
      (item) =>
        isPlainObject(item) &&
        typeof item.id === 'string' &&
        item.id.length <= 128 &&
        typeof item.title === 'string' &&
        item.title.length <= 160 &&
        typeof item.description === 'string' &&
        item.description.length <= 1000 &&
        typeof item.type === 'string' &&
        isFiniteNumber(item.targetValue) &&
        isFiniteNumber(item.currentProgress) &&
        typeof item.unit === 'string' &&
        item.unit.length <= 40 &&
        typeof item.startDate === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(item.startDate) &&
        typeof item.endDate === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(item.endDate) &&
        typeof item.status === 'string'
    )
  ) {
    return null;
  }

  const normalized: CloudSyncSnapshotV1 = {
    schemaVersion: 1,
    transactions: input.transactions as Expense[],
    budget: input.budget as unknown as BudgetSettings,
    plan: input.plan as unknown as PlanData,
    currency: input.currency as CurrencyCode,
    country: input.country as string | null,
    challenges: input.challenges as SavingsChallenge[],
  };
  if (deletedTombstones) normalized.deletedTombstones = deletedTombstones;
  if (isFiniteNumber(input.currencyUpdatedAt)) normalized.currencyUpdatedAt = input.currencyUpdatedAt;
  if (isFiniteNumber(input.countryUpdatedAt)) normalized.countryUpdatedAt = input.countryUpdatedAt;
  if (isFiniteNumber(input.challengesUpdatedAt)) {
    normalized.challengesUpdatedAt = input.challengesUpdatedAt;
  }

  return normalized;
}

async function resolveCaller(
  req: Request,
  deps: CloudSyncRouteDeps
): Promise<{ uid: string } | 'auth_unconfigured' | null> {
  if (
    process.env.NODE_ENV === 'production' &&
    !deps.verifyCallerToken &&
    !isFirebaseAdminConfigured()
  ) {
    return 'auth_unconfigured';
  }
  const header = req.headers.authorization;
  const match = typeof header === 'string' ? /^Bearer\s+(.+)$/i.exec(header) : null;
  const bearer = match?.[1]?.trim();
  if (!bearer) return null;
  const verify =
    deps.verifyCallerToken ||
    (async (token: string) => {
      const caller = await verifyFirebaseIdToken(token);
      return caller ? { uid: caller.uid } : null;
    });
  const caller = await verify(bearer);
  return caller?.uid ? { uid: caller.uid } : null;
}

async function resolvePremiumStore(deps: CloudSyncRouteDeps): Promise<EntitlementStore | null> {
  try {
    return deps.store || (await getConfiguredEntitlementStore());
  } catch {
    return null;
  }
}

async function hasActivePremium(
  store: EntitlementStore,
  uid: string,
  nowMs: number
): Promise<boolean> {
  if (!store.getPurchaseRecordByUserId) return false;
  const record = await store.getPurchaseRecordByUserId(uid);
  return isPurchaseRecordActivePremium(record, uid, nowMs);
}

async function resolvePersistence(deps: CloudSyncRouteDeps): Promise<CloudSyncPersistence | null> {
  if (deps.persistence) return deps.persistence;
  const nodeEnv = (process.env.NODE_ENV ?? 'development').trim().toLowerCase();
  const rawBackend = (process.env.ENTITLEMENT_STORE_BACKEND ?? '').trim().toLowerCase();

  if (nodeEnv === 'production' || rawBackend === 'firestore') {
    try {
      const db = await getAdminFirestore();
      return db ? createAdminCloudSyncPersistence(db) : null;
    } catch {
      return null;
    }
  }

  if (!defaultFilePersistenceSingleton) {
    defaultFilePersistenceSingleton = new FileCloudSyncPersistence();
  }
  return defaultFilePersistenceSingleton;
}

/**
 * GET /api/cloud-sync/status
 * Reports truthful non-secret availability for Multi-Device Cloud Sync.
 */
export function createCloudSyncStatusHandler(deps: CloudSyncRouteDeps = {}) {
  return async function handleCloudSyncStatus(_req: Request, res: Response): Promise<void> {
    const storeStatus = getEntitlementStoreStatus();
    const hasCustomDeps = Boolean(deps.persistence && deps.store);
    const available = hasCustomDeps || storeStatus.ready;
    res.status(200).json({
      available,
      persistenceBackend: deps.persistence ? 'custom' : storeStatus.backend,
      requiresAuth: true,
      requiresPremium: true,
    });
  };
}

export const handleCloudSyncStatus = createCloudSyncStatusHandler();

/**
 * GET /api/cloud-sync/snapshot
 */
export function createCloudSyncGetHandler(deps: CloudSyncRouteDeps = {}) {
  return async function handleCloudSyncGet(req: Request, res: Response): Promise<void> {
    const caller = await resolveCaller(req, deps);
    if (caller === 'auth_unconfigured') {
      res.status(503).json({ success: false, status: 'unavailable' });
      return;
    }
    if (!caller) {
      res.status(401).json({ success: false, status: 'unauthorized' });
      return;
    }

    const store = await resolvePremiumStore(deps);
    if (!store) {
      res.status(503).json({ success: false, status: 'unavailable' });
      return;
    }

    const nowMs = deps.now ? deps.now() : Date.now();
    try {
      if (!(await hasActivePremium(store, caller.uid, nowMs))) {
        res.status(403).json({ success: false, status: 'premium_required' });
        return;
      }

      const persistence = await resolvePersistence(deps);
      if (!persistence) {
        res.status(503).json({ success: false, status: 'unavailable' });
        return;
      }

      if (!(await persistence.consumeRateLimit(caller.uid, nowMs, MAX_REQUESTS_PER_MINUTE))) {
        res.status(429).json({ success: false, status: 'rate_limited' });
        return;
      }

      const bundle = persistence.getWithBackup
        ? await persistence.getWithBackup(caller.uid)
        : { current: await persistence.get(caller.uid), previous: null };

      res.status(200).json({
        success: true,
        exists: Boolean(bundle.current),
        revision: bundle.current?.revision ?? 0,
        snapshot: bundle.current?.snapshot ?? null,
        updatedAt: bundle.current?.updatedAt ?? null,
        hasPreviousBackup: Boolean(bundle.previous),
        previousRevision: bundle.previous?.revision ?? null,
        previousUpdatedAt: bundle.previous?.updatedAt ?? null,
      });
    } catch {
      res.status(503).json({ success: false, status: 'unavailable' });
    }
  };
}

/**
 * PUT /api/cloud-sync/snapshot
 */
export function createCloudSyncPutHandler(deps: CloudSyncRouteDeps = {}) {
  return async function handleCloudSyncPut(req: Request, res: Response): Promise<void> {
    const caller = await resolveCaller(req, deps);
    if (caller === 'auth_unconfigured') {
      res.status(503).json({ success: false, status: 'unavailable' });
      return;
    }
    if (!caller) {
      res.status(401).json({ success: false, status: 'unauthorized' });
      return;
    }

    const store = await resolvePremiumStore(deps);
    if (!store) {
      res.status(503).json({ success: false, status: 'unavailable' });
      return;
    }

    const nowMs = deps.now ? deps.now() : Date.now();
    try {
      if (!(await hasActivePremium(store, caller.uid, nowMs))) {
        res.status(403).json({ success: false, status: 'premium_required' });
        return;
      }

      const persistence = await resolvePersistence(deps);
      if (!persistence) {
        res.status(503).json({ success: false, status: 'unavailable' });
        return;
      }

      if (!(await persistence.consumeRateLimit(caller.uid, nowMs, MAX_REQUESTS_PER_MINUTE))) {
        res.status(429).json({ success: false, status: 'rate_limited' });
        return;
      }

      const body = req.body as Record<string, unknown>;
      if (
        !isPlainObject(body) ||
        !Number.isInteger(body.baseRevision) ||
        (body.baseRevision as number) < 0 ||
        typeof body.idempotencyKey !== 'string' ||
        body.idempotencyKey.length < 8 ||
        body.idempotencyKey.length > 128
      ) {
        res.status(400).json({ success: false, status: 'invalid_request' });
        return;
      }

      const snapshot = validateCloudSyncSnapshot(body.snapshot);
      if (!snapshot) {
        res.status(400).json({ success: false, status: 'invalid_snapshot' });
        return;
      }

      const serialized = JSON.stringify(snapshot);
      if (Buffer.byteLength(serialized, 'utf8') > MAX_SNAPSHOT_BYTES) {
        res.status(413).json({ success: false, status: 'snapshot_too_large' });
        return;
      }

      const payloadHash = crypto
        .createHash('sha256')
        .update(`${body.baseRevision}:${serialized}`)
        .digest('hex');

      const next: StoredCloudSyncSnapshot = {
        schemaVersion: 1,
        revision: (body.baseRevision as number) + 1,
        snapshot,
        updatedAt: nowMs,
        idempotencyKey: body.idempotencyKey,
        payloadHash,
      };

      const result = await persistence.compareAndSet(
        caller.uid,
        body.baseRevision as number,
        next
      );
      if (!result.ok) {
        res.status(409).json({
          success: false,
          status: 'revision_conflict',
          currentRevision: result.currentRevision,
        });
        return;
      }

      res.status(200).json({
        success: true,
        revision: next.revision,
        updatedAt: next.updatedAt,
        hasPreviousBackup: (body.baseRevision as number) > 0,
      });
    } catch {
      res.status(503).json({ success: false, status: 'unavailable' });
    }
  };
}

/**
 * POST /api/cloud-sync/restore-previous
 * Restores the automatically retained pre-overwrite cloud snapshot as a new revision.
 */
export function createCloudSyncRestorePreviousHandler(deps: CloudSyncRouteDeps = {}) {
  return async function handleCloudSyncRestorePrevious(
    req: Request,
    res: Response
  ): Promise<void> {
    const caller = await resolveCaller(req, deps);
    if (caller === 'auth_unconfigured') {
      res.status(503).json({ success: false, status: 'unavailable' });
      return;
    }
    if (!caller) {
      res.status(401).json({ success: false, status: 'unauthorized' });
      return;
    }

    const store = await resolvePremiumStore(deps);
    if (!store) {
      res.status(503).json({ success: false, status: 'unavailable' });
      return;
    }

    const nowMs = deps.now ? deps.now() : Date.now();
    try {
      if (!(await hasActivePremium(store, caller.uid, nowMs))) {
        res.status(403).json({ success: false, status: 'premium_required' });
        return;
      }

      const persistence = await resolvePersistence(deps);
      if (!persistence || !persistence.restorePreviousBackup) {
        res.status(503).json({ success: false, status: 'unavailable' });
        return;
      }

      if (!(await persistence.consumeRateLimit(caller.uid, nowMs, MAX_REQUESTS_PER_MINUTE))) {
        res.status(429).json({ success: false, status: 'rate_limited' });
        return;
      }

      const result = await persistence.restorePreviousBackup(caller.uid, nowMs);
      if (!result.ok) {
        res.status(404).json({
          success: false,
          status: result.reason,
        });
        return;
      }

      res.status(200).json({
        success: true,
        revision: result.restored.revision,
        updatedAt: result.restored.updatedAt,
        snapshot: result.restored.snapshot,
      });
    } catch {
      res.status(503).json({ success: false, status: 'unavailable' });
    }
  };
}
