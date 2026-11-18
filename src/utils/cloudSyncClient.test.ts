import assert from 'node:assert/strict';
import { mergeCloudTransactionsForPreview, readLocalCloudSyncSnapshot } from './cloudSyncClient';
import { TRANSACTIONS_KEY, BUDGET_KEY, PLAN_KEY, COUNTRY_KEY, CHALLENGES_KEY, CURRENCY_KEY } from './storage';

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => store.set(k, v),
  removeItem: (k: string) => store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
} as Storage;

const tx = (id: string, updatedAt: number) => ({ id, amount: 20, category: 'Groceries', date: '2026-11-17', createdAt: 1, updatedAt });
store.set(TRANSACTIONS_KEY, JSON.stringify([tx('local', 5)]));
store.set(BUDGET_KEY, JSON.stringify({ monthlyBudget: 1000, lastUpdated: 1 }));
store.set(PLAN_KEY, JSON.stringify({ availableMoney: '100', upcomingBills: '0', otherExpenses: '0', proposedPurchase: '0', categoryBudgets: {} }));
store.set(CURRENCY_KEY, 'INR');
store.set(COUNTRY_KEY, 'IN');
store.set(CHALLENGES_KEY, JSON.stringify([]));
const snapshot = readLocalCloudSyncSnapshot();
assert.equal(snapshot.currency, 'INR');
assert.equal(snapshot.transactions[0].id, 'local');

const merged = mergeCloudTransactionsForPreview([tx('same', 3), tx('localOnly', 1)], [tx('same', 2), tx('remoteOnly', 1)]);
assert.deepEqual(new Set(merged.map(x => x.id)), new Set(['same', 'localOnly', 'remoteOnly']));
assert.equal(merged.find(x => x.id === 'same')?.updatedAt, 3);
store.set(TRANSACTIONS_KEY, '{corrupted');
assert.throws(() => readLocalCloudSyncSnapshot(), /unreadable/);
console.log('Cloud Sync client snapshot/merge safety tests passed.');
