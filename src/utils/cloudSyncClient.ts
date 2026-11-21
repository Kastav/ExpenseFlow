/**
 * Client-Side Premium Multi-Device Cloud Sync, Conflict Handling & Recovery Service.
 *
 * Design & Safety Guarantees:
 * - Financial tracking stays 100% local/offline-first; Cloud Sync only runs on explicit user action.
 * - Requires authenticated Firebase account AND server-verified active Premium entitlement.
 * - Never overwrites local storage if auth fails (401), entitlement is free/expired (403),
 *   backend is unavailable (503), or revision conflict occurs (409).
 * - Always creates a pre-sync local recovery snapshot before mutating local keys.
 */

import type {
  Expense,
  BudgetSettings,
  PlanData,
  SavingsChallenge,
  CurrencyCode,
} from '../types/expense';
import { getFreshFirebaseIdToken } from '../services/authService';
import { resolveApiUrl, ResolveApiUrlOptions } from './apiConfig';
import {
  TRANSACTIONS_KEY,
  BUDGET_KEY,
  PLAN_KEY,
  COUNTRY_KEY,
  CHALLENGES_KEY,
  CURRENCY_KEY,
  LEGACY_CURRENCY_KEY,
  isValidExpenseItem,
  DEFAULT_BUDGET,
  DEFAULT_INITIAL_PLAN,
  VALID_CURRENCIES,
  loadDeletedSyncTombstones,
  saveDeletedSyncTombstones,
  SyncDeletedTombstone,
} from './storage';

export interface CloudSyncSnapshotV1 {
  schemaVersion: 1;
  transactions: Expense[];
  deletedTombstones?: SyncDeletedTombstone[];
  budget: BudgetSettings;
  plan: PlanData;
  currency: CurrencyCode;
  currencyUpdatedAt?: number;
  country: string | null;
  countryUpdatedAt?: number;
  challenges: SavingsChallenge[];
  challengesUpdatedAt?: number;
}

export interface CloudSyncRemoteState {
  exists: boolean;
  revision: number;
  snapshot: CloudSyncSnapshotV1 | null;
  updatedAt: number | null;
  hasPreviousBackup?: boolean;
  previousRevision?: number | null;
  previousUpdatedAt?: number | null;
}

export interface CloudSyncConflictSummary {
  onlyLocalCount: number;
  onlyRemoteCount: number;
  conflictingTransactionIds: string[];
  budgetDiffers: boolean;
  planDiffers: boolean;
  combinedCount: number;
}

export interface CloudSyncPreview {
  local: CloudSyncSnapshotV1;
  remote: CloudSyncRemoteState;
  diff: CloudSyncConflictSummary;
}

export interface PreSyncRecoveryBackup {
  savedAt: number;
  reason: string;
  snapshot: CloudSyncSnapshotV1;
}

export interface CloudSyncLocalMeta {
  lastSyncedAt: number;
  lastSyncedRevision: number;
}

export type CloudSyncMergeStrategy = 'merge_newest' | 'keep_local' | 'use_cloud';

export interface CloudSyncClientOptions {
  authToken?: string | null;
  apiConfigOptions?: ResolveApiUrlOptions;
}

export const PRE_SYNC_RECOVERY_KEY = 'expenseflow_pre_sync_recovery_v1';
export const CLOUD_SYNC_META_KEY = 'expenseflow_cloud_sync_meta_v1';

export class CloudSyncClientError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'CloudSyncClientError';
  }
}

function parseRaw<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  if (raw === null || raw.trim() === '') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new CloudSyncClientError(
      'local_corrupt',
      `Local data (${key}) is unreadable. Sync stopped to protect existing data.`
    );
  }
}

export function validateClientCloudSnapshot(s: unknown): s is CloudSyncSnapshotV1 {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
  const x = s as CloudSyncSnapshotV1;
  return (
    x.schemaVersion === 1 &&
    Array.isArray(x.transactions) &&
    x.transactions.every(isValidExpenseItem) &&
    !!x.budget &&
    typeof x.budget.monthlyBudget === 'number' &&
    Number.isFinite(x.budget.monthlyBudget) &&
    x.budget.monthlyBudget > 0 &&
    !!x.plan &&
    typeof x.plan === 'object' &&
    typeof x.currency === 'string' &&
    (VALID_CURRENCIES as string[]).includes(x.currency) &&
    (x.country === null || typeof x.country === 'string') &&
    Array.isArray(x.challenges)
  );
}

export function readLocalCloudSyncSnapshot(): CloudSyncSnapshotV1 {
  const tx = parseRaw<unknown>(TRANSACTIONS_KEY, []);
  const budget = parseRaw<BudgetSettings>(BUDGET_KEY, { ...DEFAULT_BUDGET });
  const plan = parseRaw<PlanData>(PLAN_KEY, { ...DEFAULT_INITIAL_PLAN });
  const currency = (
    localStorage.getItem(CURRENCY_KEY) ||
    localStorage.getItem(LEGACY_CURRENCY_KEY) ||
    'USD'
  )
    .trim()
    .toUpperCase() as CurrencyCode;
  const country = localStorage.getItem(COUNTRY_KEY);
  const challenges = parseRaw<SavingsChallenge[]>(CHALLENGES_KEY, []);
  const deletedTombstones = loadDeletedSyncTombstones();

  const snapshot: CloudSyncSnapshotV1 = {
    schemaVersion: 1,
    transactions: Array.isArray(tx) ? tx.filter(isValidExpenseItem) : [],
    ...(deletedTombstones.length > 0 ? { deletedTombstones } : {}),
    budget: {
      monthlyBudget:
        typeof budget.monthlyBudget === 'number' && budget.monthlyBudget > 0
          ? budget.monthlyBudget
          : DEFAULT_BUDGET.monthlyBudget,
      lastUpdated: typeof budget.lastUpdated === 'number' ? budget.lastUpdated : 0,
    },
    plan: {
      availableMoney: String(plan.availableMoney ?? DEFAULT_INITIAL_PLAN.availableMoney),
      upcomingBills: String(plan.upcomingBills ?? DEFAULT_INITIAL_PLAN.upcomingBills),
      otherExpenses: String(plan.otherExpenses ?? DEFAULT_INITIAL_PLAN.otherExpenses),
      proposedPurchase: String(plan.proposedPurchase ?? DEFAULT_INITIAL_PLAN.proposedPurchase),
      categoryBudgets:
        plan.categoryBudgets && typeof plan.categoryBudgets === 'object'
          ? plan.categoryBudgets
          : {},
      ...(typeof plan.lastSaved === 'number' ? { lastSaved: plan.lastSaved } : {}),
    },
    currency,
    country: country ? country.trim().toUpperCase() : null,
    challenges: Array.isArray(challenges) ? challenges : [],
  };

  if (!validateClientCloudSnapshot(snapshot)) {
    throw new CloudSyncClientError(
      'local_invalid',
      'Local data validation failed. Sync stopped to prevent corruption.'
    );
  }
  return snapshot;
}

export function getCloudSyncLocalMeta(): CloudSyncLocalMeta | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(CLOUD_SYNC_META_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CloudSyncLocalMeta;
    if (
      typeof parsed?.lastSyncedAt === 'number' &&
      typeof parsed?.lastSyncedRevision === 'number'
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function saveCloudSyncLocalMeta(meta: CloudSyncLocalMeta): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(CLOUD_SYNC_META_KEY, JSON.stringify(meta));
  } catch {
    // Ignore storage quota issues
  }
}

export function getPreSyncRecoveryBackup(): PreSyncRecoveryBackup | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(PRE_SYNC_RECOVERY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PreSyncRecoveryBackup;
    if (
      parsed &&
      typeof parsed.savedAt === 'number' &&
      validateClientCloudSnapshot(parsed.snapshot)
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function savePreSyncRecoveryBackup(reason: string): PreSyncRecoveryBackup | null {
  try {
    const snapshot = readLocalCloudSyncSnapshot();
    const backup: PreSyncRecoveryBackup = {
      savedAt: Date.now(),
      reason,
      snapshot,
    };
    localStorage.setItem(PRE_SYNC_RECOVERY_KEY, JSON.stringify(backup));
    return backup;
  } catch {
    return null;
  }
}

export function applyCloudSnapshotToLocalStorage(snapshot: CloudSyncSnapshotV1): void {
  if (!validateClientCloudSnapshot(snapshot)) {
    throw new CloudSyncClientError(
      'invalid_snapshot',
      'Cloud snapshot validation failed. No local data changed.'
    );
  }

  localStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(snapshot.transactions));
  localStorage.setItem(BUDGET_KEY, JSON.stringify(snapshot.budget));
  localStorage.setItem(PLAN_KEY, JSON.stringify(snapshot.plan));
  localStorage.setItem(CURRENCY_KEY, snapshot.currency);
  localStorage.setItem(LEGACY_CURRENCY_KEY, snapshot.currency);
  if (snapshot.country) {
    localStorage.setItem(COUNTRY_KEY, snapshot.country);
  } else {
    localStorage.removeItem(COUNTRY_KEY);
  }
  localStorage.setItem(CHALLENGES_KEY, JSON.stringify(snapshot.challenges));
  if (snapshot.deletedTombstones) {
    saveDeletedSyncTombstones(snapshot.deletedTombstones);
  }
}

export function restorePreSyncRecoveryBackup(): PreSyncRecoveryBackup {
  const backup = getPreSyncRecoveryBackup();
  if (!backup) {
    throw new CloudSyncClientError(
      'no_recovery_backup',
      'No pre-sync local recovery backup is available on this device.'
    );
  }
  applyCloudSnapshotToLocalStorage(backup.snapshot);
  return backup;
}

async function authorizedFetch(
  path: string,
  init?: RequestInit,
  options?: CloudSyncClientOptions
): Promise<Response> {
  const token =
    options?.authToken !== undefined ? options.authToken : await getFreshFirebaseIdToken(true);
  if (!token) {
    throw new CloudSyncClientError('auth_required', 'Sign in with your account to use Cloud Sync.');
  }

  let url: string;
  try {
    url = resolveApiUrl(path, options?.apiConfigOptions);
  } catch (e) {
    throw new CloudSyncClientError(
      'backend_unconfigured',
      e instanceof Error ? e.message : 'Cloud Sync backend is not configured.'
    );
  }

  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Accept', 'application/json');
  if (init?.body) headers.set('Content-Type', 'application/json');

  let res: Response;
  try {
    res = await fetch(url, { ...init, headers });
  } catch {
    throw new CloudSyncClientError(
      'network',
      'Network unavailable. Your local financial data remains unchanged.'
    );
  }

  if (res.status === 401) {
    throw new CloudSyncClientError('auth_required', 'Session expired. Please sign in again.');
  }
  if (res.status === 403) {
    throw new CloudSyncClientError(
      'premium_required',
      'Multi-Device Cloud Sync requires an active ExpenseFlow Premium subscription.'
    );
  }
  if (res.status === 409) {
    throw new CloudSyncClientError(
      'revision_conflict',
      'Another device updated your cloud backup while syncing. Refresh preview and try again.'
    );
  }
  if (res.status === 429) {
    throw new CloudSyncClientError(
      'rate_limited',
      'Cloud Sync rate limit reached. Please wait a moment and try again.'
    );
  }
  if (res.status === 503) {
    throw new CloudSyncClientError(
      'backend_unavailable',
      'Cloud Sync service is currently unavailable. Your local data remains intact.'
    );
  }
  if (!res.ok) {
    throw new CloudSyncClientError(
      'server',
      `Cloud Sync request failed (${res.status}). Local data is unchanged.`
    );
  }
  return res;
}

export async function fetchCloudSyncState(
  options?: CloudSyncClientOptions
): Promise<CloudSyncRemoteState> {
  const res = await authorizedFetch('/api/cloud-sync/snapshot', undefined, options);
  const body = (await res.json()) as CloudSyncRemoteState & { success?: boolean };
  if (
    body.success !== true ||
    !Number.isInteger(body.revision) ||
    body.revision < 0 ||
    (body.snapshot !== null && !validateClientCloudSnapshot(body.snapshot))
  ) {
    throw new CloudSyncClientError(
      'invalid_response',
      'Cloud returned an invalid response. No local data changed.'
    );
  }
  return {
    exists: body.exists === true,
    revision: body.revision,
    snapshot: body.snapshot,
    updatedAt: typeof body.updatedAt === 'number' ? body.updatedAt : null,
    hasPreviousBackup: Boolean(body.hasPreviousBackup),
    previousRevision:
      typeof body.previousRevision === 'number' ? body.previousRevision : null,
    previousUpdatedAt:
      typeof body.previousUpdatedAt === 'number' ? body.previousUpdatedAt : null,
  };
}

function areExpensesEqual(a: Expense, b: Expense): boolean {
  return (
    a.amount === b.amount &&
    a.category === b.category &&
    a.date === b.date &&
    (a.paymentMethod || '') === (b.paymentMethod || '') &&
    (a.notes || '') === (b.notes || '') &&
    (a.description || '') === (b.description || '')
  );
}

export function computeCloudSyncDiff(
  local: CloudSyncSnapshotV1,
  remote: CloudSyncSnapshotV1 | null
): CloudSyncConflictSummary {
  if (!remote) {
    return {
      onlyLocalCount: local.transactions.length,
      onlyRemoteCount: 0,
      conflictingTransactionIds: [],
      budgetDiffers: false,
      planDiffers: false,
      combinedCount: local.transactions.length,
    };
  }
  const localMap = new Map(local.transactions.map((t) => [t.id, t]));
  const remoteMap = new Map(remote.transactions.map((t) => [t.id, t]));

  let onlyLocalCount = 0;
  let onlyRemoteCount = 0;
  const conflictingTransactionIds: string[] = [];

  for (const [id, lTx] of localMap.entries()) {
    const rTx = remoteMap.get(id);
    if (!rTx) {
      onlyLocalCount += 1;
    } else if (!areExpensesEqual(lTx, rTx)) {
      conflictingTransactionIds.push(id);
    }
  }
  for (const id of remoteMap.keys()) {
    if (!localMap.has(id)) {
      onlyRemoteCount += 1;
    }
  }

  const budgetDiffers = local.budget.monthlyBudget !== remote.budget.monthlyBudget;
  const planDiffers =
    local.plan.availableMoney !== remote.plan.availableMoney ||
    local.plan.upcomingBills !== remote.plan.upcomingBills ||
    local.plan.otherExpenses !== remote.plan.otherExpenses ||
    local.plan.proposedPurchase !== remote.plan.proposedPurchase;

  const merged = mergeCloudSnapshots(local, remote, 'merge_newest');

  return {
    onlyLocalCount,
    onlyRemoteCount,
    conflictingTransactionIds,
    budgetDiffers,
    planDiffers,
    combinedCount: merged.transactions.length,
  };
}

export async function previewCloudSync(
  options?: CloudSyncClientOptions
): Promise<CloudSyncPreview> {
  const local = readLocalCloudSyncSnapshot();
  const remote = await fetchCloudSyncState(options);
  return {
    local,
    remote,
    diff: computeCloudSyncDiff(local, remote.snapshot),
  };
}

export function mergeCloudSnapshots(
  local: CloudSyncSnapshotV1,
  remote: CloudSyncSnapshotV1 | null,
  strategy: CloudSyncMergeStrategy = 'merge_newest'
): CloudSyncSnapshotV1 {
  if (!remote) return local;
  if (strategy === 'keep_local') return local;
  if (strategy === 'use_cloud') return remote;

  // Combine delete tombstones (max deletedAt per ID)
  const tombstoneMap = new Map<string, number>();
  for (const item of [...(remote.deletedTombstones || []), ...(local.deletedTombstones || [])]) {
    tombstoneMap.set(item.id, Math.max(tombstoneMap.get(item.id) || 0, item.deletedAt));
  }

  // Merge transactions by ID; newest updatedAt wins on shared IDs unless deleted more recently
  const txMap = new Map<string, Expense>();
  for (const item of remote.transactions) {
    if (isValidExpenseItem(item)) txMap.set(item.id, item);
  }
  for (const item of local.transactions) {
    if (!isValidExpenseItem(item)) continue;
    const prev = txMap.get(item.id);
    const itemTs = item.updatedAt || item.createdAt || 0;
    const prevTs = prev ? prev.updatedAt || prev.createdAt || 0 : -1;
    if (!prev || itemTs >= prevTs) {
      txMap.set(item.id, item);
    }
  }

  const mergedTransactions: Expense[] = [];
  for (const tx of txMap.values()) {
    const deletedAt = tombstoneMap.get(tx.id);
    const txTs = tx.updatedAt || tx.createdAt || 0;
    if (deletedAt && deletedAt > txTs) {
      continue;
    }
    mergedTransactions.push(tx);
  }
  mergedTransactions.sort(
    (a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0)
  );

  // Merge budget & plan by latest timestamp
  const mergedBudget =
    (local.budget.lastUpdated || 0) >= (remote.budget.lastUpdated || 0)
      ? local.budget
      : remote.budget;

  const mergedPlan =
    (local.plan.lastSaved || 0) >= (remote.plan.lastSaved || 0) ? local.plan : remote.plan;

  // Merge challenges by ID
  const challengeMap = new Map<string, SavingsChallenge>();
  for (const c of [...remote.challenges, ...local.challenges]) {
    challengeMap.set(c.id, c);
  }

  const mergedTombstones = Array.from(tombstoneMap.entries())
    .map(([id, deletedAt]) => ({ id, deletedAt }))
    .slice(-500);

  return {
    schemaVersion: 1,
    transactions: mergedTransactions,
    ...(mergedTombstones.length > 0 ? { deletedTombstones: mergedTombstones } : {}),
    budget: mergedBudget,
    plan: mergedPlan,
    currency: local.currency || remote.currency,
    country: local.country ?? remote.country,
    challenges: Array.from(challengeMap.values()),
  };
}

export async function uploadCloudSnapshot(
  snapshot: CloudSyncSnapshotV1,
  baseRevision: number,
  options?: CloudSyncClientOptions
): Promise<{ revision: number; updatedAt: number; hasPreviousBackup?: boolean }> {
  const idempotencyKey =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `sync-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  const res = await authorizedFetch(
    '/api/cloud-sync/snapshot',
    {
      method: 'PUT',
      body: JSON.stringify({ baseRevision, idempotencyKey, snapshot }),
    },
    options
  );
  const body = (await res.json()) as {
    success?: boolean;
    revision?: number;
    updatedAt?: number;
    hasPreviousBackup?: boolean;
  };
  if (body.success !== true || !Number.isInteger(body.revision)) {
    throw new CloudSyncClientError('invalid_response', 'Upload response was invalid.');
  }
  const updatedAt = typeof body.updatedAt === 'number' ? body.updatedAt : Date.now();
  saveCloudSyncLocalMeta({ lastSyncedRevision: body.revision!, lastSyncedAt: updatedAt });
  return {
    revision: body.revision!,
    updatedAt,
    hasPreviousBackup: Boolean(body.hasPreviousBackup),
  };
}

/**
 * Full two-way safe Cloud Sync:
 * 1. Validates & reads local state.
 * 2. Fetches latest remote state.
 * 3. Merges using selected strategy (default: newest-wins union with delete tombstones).
 * 4. Uploads merged state with atomic baseRevision compare-and-set.
 * 5. Saves pre-sync local recovery backup, then applies merged snapshot locally.
 */
export async function performSmartCloudSync(
  strategy: CloudSyncMergeStrategy = 'merge_newest',
  options?: CloudSyncClientOptions
): Promise<{
  revision: number;
  updatedAt: number;
  snapshot: CloudSyncSnapshotV1;
  diff: CloudSyncConflictSummary;
}> {
  const local = readLocalCloudSyncSnapshot();
  const remote = await fetchCloudSyncState(options);
  const diff = computeCloudSyncDiff(local, remote.snapshot);
  const merged = mergeCloudSnapshots(local, remote.snapshot, strategy);

  const uploaded = await uploadCloudSnapshot(merged, remote.revision, options);
  savePreSyncRecoveryBackup(`Before Cloud Sync (rev ${uploaded.revision})`);
  applyCloudSnapshotToLocalStorage(merged);

  return {
    revision: uploaded.revision,
    updatedAt: uploaded.updatedAt,
    snapshot: merged,
    diff,
  };
}

/**
 * Pulls and applies the remote cloud backup to this device, preserving a pre-sync local
 * recovery backup beforehand.
 */
export async function pullAndApplyCloudBackup(
  options?: CloudSyncClientOptions
): Promise<{ revision: number; updatedAt: number | null; snapshot: CloudSyncSnapshotV1 }> {
  const remote = await fetchCloudSyncState(options);
  if (!remote.snapshot) {
    throw new CloudSyncClientError('remote_empty', 'No cloud backup exists for this account yet.');
  }
  savePreSyncRecoveryBackup(`Before Cloud Restore (rev ${remote.revision})`);
  applyCloudSnapshotToLocalStorage(remote.snapshot);
  saveCloudSyncLocalMeta({
    lastSyncedRevision: remote.revision,
    lastSyncedAt: remote.updatedAt || Date.now(),
  });
  return {
    revision: remote.revision,
    updatedAt: remote.updatedAt,
    snapshot: remote.snapshot,
  };
}

/**
 * Restores the previous server-side snapshot retained before the last cloud overwrite,
 * and updates this device locally after saving a local pre-sync recovery backup.
 */
export async function restorePreviousCloudRevision(
  options?: CloudSyncClientOptions
): Promise<{ revision: number; updatedAt: number; snapshot: CloudSyncSnapshotV1 }> {
  const res = await authorizedFetch(
    '/api/cloud-sync/restore-previous',
    { method: 'POST' },
    options
  );
  const body = (await res.json()) as {
    success?: boolean;
    revision?: number;
    updatedAt?: number;
    snapshot?: CloudSyncSnapshotV1;
  };
  if (
    body.success !== true ||
    !Number.isInteger(body.revision) ||
    !validateClientCloudSnapshot(body.snapshot)
  ) {
    throw new CloudSyncClientError(
      'invalid_response',
      'Server did not return a valid previous cloud backup.'
    );
  }
  savePreSyncRecoveryBackup(`Before Cloud Rollback (rev ${body.revision})`);
  applyCloudSnapshotToLocalStorage(body.snapshot);
  const updatedAt = typeof body.updatedAt === 'number' ? body.updatedAt : Date.now();
  saveCloudSyncLocalMeta({ lastSyncedRevision: body.revision!, lastSyncedAt: updatedAt });
  return {
    revision: body.revision!,
    updatedAt,
    snapshot: body.snapshot,
  };
}
