import { createApp } from '../../server';
import {
  CloudSyncPersistence,
  CloudSyncRouteDeps,
  StoredCloudSyncSnapshot,
} from '../server/cloudSyncRoute';
import { EntitlementStore, StoredPurchaseRecord } from '../server/entitlementStore';
import { PLAY_PRODUCT_IDS } from '../types/billing';
import type { Server } from 'http';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

class MemoryCloudSyncPersistence implements CloudSyncPersistence {
  private readonly records = new Map<string, StoredCloudSyncSnapshot>();
  private readonly recentRequests = new Map<string, number[]>();

  async consumeRateLimit(uid: string, nowMs: number, maxPerMinute: number): Promise<boolean> {
    const recent = (this.recentRequests.get(uid) || []).filter((time) => time > nowMs - 60_000);
    if (recent.length >= maxPerMinute) return false;
    recent.push(nowMs);
    this.recentRequests.set(uid, recent);
    return true;
  }

  async get(uid: string): Promise<StoredCloudSyncSnapshot | null> {
    return this.records.get(uid) || null;
  }

  async compareAndSet(uid: string, expectedRevision: number, next: StoredCloudSyncSnapshot) {
    const current = this.records.get(uid);
    const currentRevision = current?.revision ?? 0;
    if (current?.idempotencyKey === next.idempotencyKey) {
      if (current.payloadHash === next.payloadHash) return { ok: true as const };
      return { ok: false as const, currentRevision };
    }
    if (currentRevision !== expectedRevision) return { ok: false as const, currentRevision };
    this.records.set(uid, next);
    return { ok: true as const };
  }
}

function makePurchase(uid: string, active: boolean): StoredPurchaseRecord {
  const now = Date.now();
  return {
    tokenHash: `hash_${uid}`,
    tokenId: `token_${uid}`,
    userId: uid,
    ownershipStatus: 'bound',
    productId: PLAY_PRODUCT_IDS.MONTHLY,
    subscriptionState: active ? 'SUBSCRIPTION_STATE_ACTIVE' : 'SUBSCRIPTION_STATE_EXPIRED',
    status: active ? 'active' : 'expired',
    expiryTimeMillis: active ? now + 86_400_000 : now - 1,
    autoRenewing: active,
    cancelAtPeriodEnd: false,
    acknowledged: true,
    revoked: false,
    createdAt: now,
    updatedAt: now,
    lastVerifiedAt: now,
  };
}

const snapshot = {
  schemaVersion: 1 as const,
  transactions: [{
    id: 'tx_1',
    amount: 18.5,
    category: 'Groceries',
    date: '2026-11-18',
    createdAt: 100,
    updatedAt: 100,
  }],
  budget: { monthlyBudget: 1200, lastUpdated: 100 },
  plan: {
    availableMoney: '500',
    upcomingBills: '100',
    otherExpenses: '50',
    proposedPurchase: '20',
    categoryBudgets: { Groceries: '200' },
  },
  currency: 'USD' as const,
  country: 'US',
  challenges: [],
};

async function main() {
  const persistence = new MemoryCloudSyncPersistence();
  const premiumUids = new Set(['premium_user_a', 'premium_user_b']);
  const store = {
    backendName: 'firestore',
    async getPurchaseRecordByUserId(uid: string) {
      return premiumUids.has(uid) ? makePurchase(uid, true) : makePurchase(uid, false);
    },
  } as unknown as EntitlementStore;

  const deps: CloudSyncRouteDeps = {
    store,
    persistence,
    verifyCallerToken: async (token) => {
      if (token === 'token_a') return { uid: 'premium_user_a' };
      if (token === 'token_b') return { uid: 'premium_user_b' };
      if (token === 'token_free') return { uid: 'free_user' };
      return null;
    },
  };

  const app = await createApp({ disableVite: true, cloudSyncDeps: deps });
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  try {
    const noAuth = await fetch(`${baseUrl}/api/cloud-sync/snapshot`);
    assert(noAuth.status === 401, 'Cloud Sync must reject missing Firebase ID token.');

    const free = await fetch(`${baseUrl}/api/cloud-sync/snapshot`, {
      headers: { Authorization: 'Bearer token_free', 'X-ExpenseFlow-Entitlement-Tier': 'premium' },
    });
    assert(free.status === 403, 'Free user must remain blocked despite spoofed Premium header.');

    const empty = await fetch(`${baseUrl}/api/cloud-sync/snapshot`, {
      headers: { Authorization: 'Bearer token_a' },
    });
    const emptyJson = await empty.json() as { exists?: boolean; revision?: number };
    assert(empty.status === 200 && emptyJson.exists === false && emptyJson.revision === 0,
      'New Premium user must receive an empty revision-zero snapshot state.');

    const put = await fetch(`${baseUrl}/api/cloud-sync/snapshot`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token_a' },
      body: JSON.stringify({ baseRevision: 0, idempotencyKey: 'sync_request_0001', snapshot }),
    });
    const putJson = await put.json() as { success?: boolean; revision?: number };
    assert(put.status === 200 && putJson.success === true && putJson.revision === 1,
      'Premium snapshot upload must commit revision 1.');

    const retry = await fetch(`${baseUrl}/api/cloud-sync/snapshot`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token_a' },
      body: JSON.stringify({ baseRevision: 0, idempotencyKey: 'sync_request_0001', snapshot }),
    });
    assert(retry.status === 200, 'Exact idempotent retry must succeed without creating another revision.');

    const conflict = await fetch(`${baseUrl}/api/cloud-sync/snapshot`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token_a' },
      body: JSON.stringify({ baseRevision: 0, idempotencyKey: 'sync_request_0002', snapshot }),
    });
    const conflictJson = await conflict.json() as { status?: string; currentRevision?: number };
    assert(conflict.status === 409 && conflictJson.status === 'revision_conflict' && conflictJson.currentRevision === 1,
      'Stale base revision must return conflict without overwriting newer data.');

    const invalid = await fetch(`${baseUrl}/api/cloud-sync/snapshot`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token_a' },
      body: JSON.stringify({ baseRevision: 1, idempotencyKey: 'sync_request_0003', snapshot: { ...snapshot, currency: 'XYZ' } }),
    });
    assert(invalid.status === 400, 'Invalid snapshot schema/currency must be rejected.');

    const userB = await fetch(`${baseUrl}/api/cloud-sync/snapshot`, {
      headers: { Authorization: 'Bearer token_b' },
    });
    const userBJson = await userB.json() as { exists?: boolean; revision?: number };
    assert(userB.status === 200 && userBJson.exists === false && userBJson.revision === 0,
      'A different Premium UID must not see User A cloud data.');

    const readBack = await fetch(`${baseUrl}/api/cloud-sync/snapshot`, {
      headers: { Authorization: 'Bearer token_a' },
    });
    const readJson = await readBack.json() as { exists?: boolean; revision?: number; snapshot?: typeof snapshot };
    assert(readBack.status === 200 && readJson.exists === true && readJson.revision === 1 &&
      readJson.snapshot?.transactions[0]?.id === 'tx_1',
      'The owning UID must read back the committed snapshot.');

    for (let i = 0; i < 24; i++) {
      const allowed = await fetch(`${baseUrl}/api/cloud-sync/snapshot`, {
        headers: { Authorization: 'Bearer token_a' },
      });
      assert(allowed.status === 200, 'Cloud Sync must allow up to 30 requests per UID per minute.');
    }
    const limited = await fetch(`${baseUrl}/api/cloud-sync/snapshot`, {
      headers: { Authorization: 'Bearer token_a' },
    });
    assert(limited.status === 429, 'Cloud Sync must rate-limit the 31st request in a rolling minute.');

    console.log('✔ Cloud Sync tests passed: auth, Premium enforcement, UID isolation, schema validation, idempotency, revision conflicts, and rate limiting.');
  } finally {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
