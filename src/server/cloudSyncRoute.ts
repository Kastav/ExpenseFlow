import crypto from 'crypto';
import type { Firestore } from 'firebase-admin/firestore';
import type { Request, Response } from 'express';
import {
  EntitlementStore,
  getConfiguredEntitlementStore,
} from './entitlementStore.ts';
import { getAdminFirestore, verifyFirebaseIdToken } from './firebaseAdmin.ts';
import { PLAY_PRODUCT_IDS } from '../types/billing';
import {
  BudgetSettings,
  CurrencyCode,
  Expense,
  PlanData,
  SavingsChallenge,
} from '../types/expense';
import { VALID_CURRENCIES, isValidExpenseItem } from '../utils/storage';

export interface CloudSyncSnapshotV1 {
  schemaVersion: 1;
  transactions: Expense[];
  budget: BudgetSettings;
  plan: PlanData;
  currency: CurrencyCode;
  country: string | null;
  challenges: SavingsChallenge[];
}

export interface StoredCloudSyncSnapshot {
  schemaVersion: 1;
  revision: number;
  snapshot: CloudSyncSnapshotV1;
  updatedAt: number;
  idempotencyKey: string;
  payloadHash: string;
}

export interface CloudSyncPersistence {
  get(uid: string): Promise<StoredCloudSyncSnapshot | null>;
  compareAndSet(
    uid: string,
    expectedRevision: number,
    next: StoredCloudSyncSnapshot
  ): Promise<{ ok: true } | { ok: false; currentRevision: number }>;
}

export interface CloudSyncRouteDeps {
  store?: EntitlementStore;
  persistence?: CloudSyncPersistence;
  verifyCallerToken?: (bearer: string) => Promise<{ uid: string } | null>;
  now?: () => number;
}

function getUidDocumentId(uid: string): string {
  if (!uid || uid.length > 128 || uid.includes('/')) {
    throw new Error('Invalid verified Firebase UID.');
  }
  return uid;
}

export function createAdminCloudSyncPersistence(db: Firestore): CloudSyncPersistence {
  const refFor = (uid: string) => db.collection('users').doc(getUidDocumentId(uid))
    .collection('cloud_sync').doc('snapshot');

  return {
    async get(uid) {
      const snap = await refFor(uid).get();
      if (!snap.exists) return null;
      return snap.data() as StoredCloudSyncSnapshot;
    },
    async compareAndSet(uid, expectedRevision, next) {
      const ref = refFor(uid);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const current = snap.exists ? (snap.data() as StoredCloudSyncSnapshot) : null;
        const currentRevision = current?.revision ?? 0;

        // Safe retry: the exact same idempotency key and payload already committed.
        if (current?.idempotencyKey === next.idempotencyKey) {
          if (current.payloadHash === next.payloadHash) return { ok: true as const };
          return { ok: false as const, currentRevision };
        }
        if (currentRevision !== expectedRevision) {
          return { ok: false as const, currentRevision };
        }
        tx.set(ref, next);
        return { ok: true as const };
      });
    },
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateSnapshot(input: unknown): CloudSyncSnapshotV1 | null {
  if (!isPlainObject(input) || input.schemaVersion !== 1) return null;
  if (!Array.isArray(input.transactions) || input.transactions.length > 5000) return null;
  if (!input.transactions.every((item) => {
    if (!isValidExpenseItem(item)) return false;
    const tx = item as Expense;
    return tx.id.length <= 128 &&
      tx.category.length <= 80 &&
      tx.date.length === 10 &&
      (!tx.paymentMethod || (typeof tx.paymentMethod === 'string' && tx.paymentMethod.length <= 80)) &&
      (!tx.notes || (typeof tx.notes === 'string' && tx.notes.length <= 2000)) &&
      (!tx.description || (typeof tx.description === 'string' && tx.description.length <= 2000)) &&
      isFiniteNumber(tx.createdAt) && isFiniteNumber(tx.updatedAt);
  })) return null;

  if (!isPlainObject(input.budget) ||
      !isFiniteNumber(input.budget.monthlyBudget) ||
      input.budget.monthlyBudget <= 0 ||
      !isFiniteNumber(input.budget.lastUpdated)) return null;

  const plan = input.plan;
  if (!isPlainObject(plan)) return null;
  const planFields = ['availableMoney', 'upcomingBills', 'otherExpenses', 'proposedPurchase'];
  if (!planFields.every((field) => typeof plan[field] === 'string' && (plan[field] as string).length <= 80)) return null;
  if (plan.categoryBudgets !== undefined) {
    if (!isPlainObject(plan.categoryBudgets) || Object.keys(plan.categoryBudgets).length > 40) return null;
    if (!Object.values(plan.categoryBudgets).every((value) => typeof value === 'string' && value.length <= 80)) return null;
  }
  if (plan.lastSaved !== undefined && !isFiniteNumber(plan.lastSaved)) return null;

  if (typeof input.currency !== 'string' || !VALID_CURRENCIES.includes(input.currency as CurrencyCode)) return null;
  if (input.country !== null && (typeof input.country !== 'string' || !/^[A-Z]{2}$/.test(input.country))) return null;

  if (!Array.isArray(input.challenges) || input.challenges.length > 100) return null;
  if (!input.challenges.every((item) => isPlainObject(item) &&
    typeof item.id === 'string' && item.id.length <= 128 &&
    typeof item.title === 'string' && item.title.length <= 160 &&
    typeof item.description === 'string' && item.description.length <= 1000 &&
    typeof item.type === 'string' &&
    isFiniteNumber(item.targetValue) &&
    isFiniteNumber(item.currentProgress) &&
    typeof item.unit === 'string' && item.unit.length <= 40 &&
    typeof item.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.startDate) &&
    typeof item.endDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.endDate) &&
    typeof item.status === 'string')) return null;

  return {
    schemaVersion: 1,
    transactions: input.transactions as Expense[],
    budget: input.budget as unknown as BudgetSettings,
    plan: input.plan as unknown as PlanData,
    currency: input.currency as CurrencyCode,
    country: input.country as string | null,
    challenges: input.challenges as SavingsChallenge[],
  };
}

async function resolveCaller(
  req: Request,
  deps: CloudSyncRouteDeps
): Promise<{ uid: string } | null> {
  const header = req.headers.authorization;
  const match = typeof header === 'string' ? /^Bearer\s+(.+)$/i.exec(header) : null;
  const bearer = match?.[1]?.trim();
  if (!bearer) return null;
  const verify = deps.verifyCallerToken || (async (token: string) => {
    const caller = await verifyFirebaseIdToken(token);
    return caller ? { uid: caller.uid } : null;
  });
  const caller = await verify(bearer);
  return caller?.uid ? { uid: caller.uid } : null;
}

async function resolvePremiumStore(deps: CloudSyncRouteDeps): Promise<EntitlementStore | null> {
  try {
    return deps.store || await getConfiguredEntitlementStore();
  } catch {
    return null;
  }
}

async function hasActivePremium(store: EntitlementStore, uid: string, nowMs: number): Promise<boolean> {
  if (!store.getPurchaseRecordByUserId) return false;
  const record = await store.getPurchaseRecordByUserId(uid);
  return Boolean(
    record && record.userId === uid && record.ownershipStatus !== 'unbound' &&
    !record.revoked && record.expiryTimeMillis > nowMs &&
    (record.status === 'active' || record.status === 'canceled') &&
    (record.productId === PLAY_PRODUCT_IDS.MONTHLY || record.productId === PLAY_PRODUCT_IDS.ANNUAL)
  );
}

async function resolvePersistence(deps: CloudSyncRouteDeps): Promise<CloudSyncPersistence | null> {
  if (deps.persistence) return deps.persistence;
  try {
    const db = await getAdminFirestore();
    return db ? createAdminCloudSyncPersistence(db) : null;
  } catch {
    return null;
  }
}

export function createCloudSyncGetHandler(deps: CloudSyncRouteDeps = {}) {
  return async function handleCloudSyncGet(req: Request, res: Response): Promise<void> {
    const caller = await resolveCaller(req, deps);
    if (!caller) {
      res.status(401).json({ success: false, status: 'unauthorized' });
      return;
    }
    const store = await resolvePremiumStore(deps);
    const persistence = await resolvePersistence(deps);
    if (!store || !persistence) {
      res.status(503).json({ success: false, status: 'unavailable' });
      return;
    }
    const nowMs = deps.now ? deps.now() : Date.now();
    try {
      if (!(await hasActivePremium(store, caller.uid, nowMs))) {
        res.status(403).json({ success: false, status: 'premium_required' });
        return;
      }
      const record = await persistence.get(caller.uid);
      res.status(200).json({
        success: true,
        exists: Boolean(record),
        revision: record?.revision ?? 0,
        snapshot: record?.snapshot ?? null,
        updatedAt: record?.updatedAt ?? null,
      });
    } catch {
      res.status(503).json({ success: false, status: 'unavailable' });
    }
  };
}

export function createCloudSyncPutHandler(deps: CloudSyncRouteDeps = {}) {
  return async function handleCloudSyncPut(req: Request, res: Response): Promise<void> {
    const caller = await resolveCaller(req, deps);
    if (!caller) {
      res.status(401).json({ success: false, status: 'unauthorized' });
      return;
    }
    const store = await resolvePremiumStore(deps);
    const persistence = await resolvePersistence(deps);
    if (!store || !persistence) {
      res.status(503).json({ success: false, status: 'unavailable' });
      return;
    }
    const nowMs = deps.now ? deps.now() : Date.now();
    try {
      if (!(await hasActivePremium(store, caller.uid, nowMs))) {
        res.status(403).json({ success: false, status: 'premium_required' });
        return;
      }
      const body = req.body as Record<string, unknown>;
      if (!isPlainObject(body) || !Number.isInteger(body.baseRevision) ||
          (body.baseRevision as number) < 0 ||
          typeof body.idempotencyKey !== 'string' ||
          body.idempotencyKey.length < 8 || body.idempotencyKey.length > 128) {
        res.status(400).json({ success: false, status: 'invalid_request' });
        return;
      }
      const snapshot = validateSnapshot(body.snapshot);
      if (!snapshot) {
        res.status(400).json({ success: false, status: 'invalid_snapshot' });
        return;
      }
      const serialized = JSON.stringify(snapshot);
      if (Buffer.byteLength(serialized, 'utf8') > 48 * 1024) {
        res.status(413).json({ success: false, status: 'snapshot_too_large' });
        return;
      }
      const payloadHash = crypto.createHash('sha256').update(serialized).digest('hex');
      const next: StoredCloudSyncSnapshot = {
        schemaVersion: 1,
        revision: (body.baseRevision as number) + 1,
        snapshot,
        updatedAt: nowMs,
        idempotencyKey: body.idempotencyKey,
        payloadHash,
      };
      const result = await persistence.compareAndSet(caller.uid, body.baseRevision as number, next);
      if (!result.ok) {
        res.status(409).json({ success: false, status: 'revision_conflict', currentRevision: result.currentRevision });
        return;
      }
      res.status(200).json({ success: true, revision: next.revision, updatedAt: next.updatedAt });
    } catch {
      res.status(503).json({ success: false, status: 'unavailable' });
    }
  };
}
