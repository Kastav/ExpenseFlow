import type { Expense, BudgetSettings, PlanData, SavingsChallenge, CurrencyCode } from '../types/expense';
import { getFreshFirebaseIdToken } from '../services/authService';
import { resolveApiUrl } from './apiConfig';
import {
  TRANSACTIONS_KEY, BUDGET_KEY, PLAN_KEY, COUNTRY_KEY, CHALLENGES_KEY,
  CURRENCY_KEY, LEGACY_CURRENCY_KEY, isValidExpenseItem, DEFAULT_BUDGET,
  DEFAULT_INITIAL_PLAN, VALID_CURRENCIES,
} from './storage';

export interface CloudSyncSnapshotV1 {
  schemaVersion: 1;
  transactions: Expense[];
  budget: BudgetSettings;
  plan: PlanData;
  currency: CurrencyCode;
  country: string | null;
  challenges: SavingsChallenge[];
}
export interface CloudSyncRemoteState {
  exists: boolean;
  revision: number;
  snapshot: CloudSyncSnapshotV1 | null;
  updatedAt: number | null;
}
export interface CloudSyncPreview {
  local: CloudSyncSnapshotV1;
  remote: CloudSyncRemoteState;
  transactionCounts: { local: number; remote: number; combined: number; duplicateIds: number };
}
export class CloudSyncClientError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'CloudSyncClientError'; }
}
const parseRaw = <T>(key: string, fallback: T): T => {
  const raw = localStorage.getItem(key);
  if (raw === null || raw.trim() === '') return fallback;
  try { return JSON.parse(raw) as T; } catch { throw new CloudSyncClientError('local_corrupt', `Local data (${key}) is unreadable. Sync stopped to protect it.`); }
};
function validateSnapshot(s: unknown): s is CloudSyncSnapshotV1 {
  if (!s || typeof s !== 'object') return false;
  const x = s as CloudSyncSnapshotV1;
  return x.schemaVersion === 1 && Array.isArray(x.transactions) && x.transactions.every(isValidExpenseItem) &&
    !!x.budget && typeof x.budget.monthlyBudget === 'number' && x.budget.monthlyBudget > 0 &&
    !!x.plan && typeof x.plan === 'object' && typeof x.currency === 'string' &&
    (VALID_CURRENCIES as string[]).includes(x.currency) &&
    (x.country === null || typeof x.country === 'string') && Array.isArray(x.challenges);
}
export function readLocalCloudSyncSnapshot(): CloudSyncSnapshotV1 {
  const tx = parseRaw<unknown>(TRANSACTIONS_KEY, []);
  const budget = parseRaw<BudgetSettings>(BUDGET_KEY, DEFAULT_BUDGET);
  const plan = parseRaw<PlanData>(PLAN_KEY, DEFAULT_INITIAL_PLAN);
  const currency = (localStorage.getItem(CURRENCY_KEY) || localStorage.getItem(LEGACY_CURRENCY_KEY) || 'USD').trim().toUpperCase() as CurrencyCode;
  const country = localStorage.getItem(COUNTRY_KEY);
  const challenges = parseRaw<SavingsChallenge[]>(CHALLENGES_KEY, []);
  const snapshot: CloudSyncSnapshotV1 = {
    schemaVersion: 1,
    transactions: Array.isArray(tx) ? tx.filter(isValidExpenseItem) : [],
    budget, plan, currency,
    country: country ? country.trim().toUpperCase() : null,
    challenges,
  };
  if (!validateSnapshot(snapshot)) throw new CloudSyncClientError('local_invalid', 'Local data validation failed. Sync stopped.');
  return snapshot;
}
async function authorizedFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getFreshFirebaseIdToken(true);
  if (!token) throw new CloudSyncClientError('auth_required', 'Sign in again to use Cloud Sync.');
  let url: string;
  try { url = resolveApiUrl(path); } catch (e) { throw new CloudSyncClientError('backend_unconfigured', e instanceof Error ? e.message : 'Cloud Sync backend is not configured.'); }
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Accept', 'application/json');
  if (init?.body) headers.set('Content-Type', 'application/json');
  let res: Response;
  try { res = await fetch(url, { ...init, headers }); } catch { throw new CloudSyncClientError('network', 'Network unavailable. Local data is unchanged.'); }
  if (res.status === 401) throw new CloudSyncClientError('auth_required', 'Please sign in again.');
  if (res.status === 403) throw new CloudSyncClientError('premium_required', 'Cloud Sync requires an active Premium subscription.');
  if (res.status === 409) throw new CloudSyncClientError('revision_conflict', 'Cloud changed since the last sync. Fetch latest data and review before retrying.');
  if (!res.ok) throw new CloudSyncClientError('server', `Cloud Sync request failed (${res.status}). Local data is unchanged.`);
  return res;
}
export async function fetchCloudSyncState(): Promise<CloudSyncRemoteState> {
  const res = await authorizedFetch('/api/cloud-sync/snapshot');
  const body = await res.json() as CloudSyncRemoteState & { success?: boolean };
  if (body.success !== true || !Number.isInteger(body.revision) || body.revision < 0 || (body.snapshot !== null && !validateSnapshot(body.snapshot))) {
    throw new CloudSyncClientError('invalid_response', 'Cloud returned an invalid response. No local data changed.');
  }
  return { exists: body.exists === true, revision: body.revision, snapshot: body.snapshot, updatedAt: typeof body.updatedAt === 'number' ? body.updatedAt : null };
}
export async function previewCloudSync(): Promise<CloudSyncPreview> {
  const local = readLocalCloudSyncSnapshot();
  const remote = await fetchCloudSyncState();
  const localIds = new Set(local.transactions.map(t => t.id));
  const remoteIds = new Set(remote.snapshot?.transactions.map(t => t.id) || []);
  const duplicateIds = [...localIds].filter(id => remoteIds.has(id)).length;
  return { local, remote, transactionCounts: { local: local.transactions.length, remote: remote.snapshot?.transactions.length || 0, combined: localIds.size + remoteIds.size - duplicateIds, duplicateIds } };
}
/** Upload is only invoked by an explicit user-confirmed action in the UI. */
export async function uploadLocalCloudSyncSnapshot(baseRevision: number): Promise<{ revision: number }> {
  const snapshot = readLocalCloudSyncSnapshot();
  const idempotencyKey = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `sync-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const res = await authorizedFetch('/api/cloud-sync/snapshot', { method: 'PUT', body: JSON.stringify({ baseRevision, idempotencyKey, snapshot }) });
  const body = await res.json() as { success?: boolean; revision?: number };
  if (body.success !== true || !Number.isInteger(body.revision)) throw new CloudSyncClientError('invalid_response', 'Upload response was invalid.');
  return { revision: body.revision! };
}
/** Returns remote data for an explicit restore/merge UI. It intentionally performs no local writes. */
export async function getRemoteSnapshotForRestore(): Promise<CloudSyncSnapshotV1> {
  const state = await fetchCloudSyncState();
  if (!state.snapshot) throw new CloudSyncClientError('remote_empty', 'No cloud backup exists for this account.');
  return state.snapshot;
}
/** Merge helper for preview only: keeps all unique transaction IDs, newer timestamp wins on duplicates. */
export function mergeCloudTransactionsForPreview(local: Expense[], remote: Expense[]): Expense[] {
  const byId = new Map<string, Expense>();
  for (const item of [...remote, ...local]) {
    if (!isValidExpenseItem(item)) continue;
    const prev = byId.get(item.id);
    if (!prev || (item.updatedAt || item.createdAt || 0) >= (prev.updatedAt || prev.createdAt || 0) || item === local.find(x => x.id === item.id)) byId.set(item.id, item);
  }
  return [...byId.values()].sort((a,b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
}
