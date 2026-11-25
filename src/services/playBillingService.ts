/**
 * Client-Side Google Play In-App Billing & Subscription Service for ExpenseFlow.
 *
 * Interfaces with:
 * 1. Native Capacitor Android GooglePlayBilling plugin (on Android).
 * 2. Secure Server-Side receipt verification (/api/billing/verify).
 *
 * Enforces:
 * - Real Google Play purchase flows on Android devices.
 * - Server verification before granting Premium.
 * - Honest configuration-required messaging on Web or unconfigured environments.
 * - Expiry and automatic renewal status tracking.
 */

import { registerPlugin, Capacitor } from '@capacitor/core';
import {
  PLAY_PRODUCT_IDS,
  PlayProductId,
  PlayProductDetails,
  PlayPurchaseResult,
  VerifyPurchaseResponsePayload,
  StoredSubscriptionEntitlement,
} from '../types/billing';
import { setStoredEntitlementToken } from '../utils/premium';
import { ApiConfigurationError, resolveApiUrl, ResolveApiUrlOptions } from '../utils/apiConfig';

export const SUBSCRIPTION_ENTITLEMENT_KEY = 'expenseflow_subscription_entitlement_v1';

// Register native plugin bridge
export interface NativeGooglePlayBillingPlugin {
  isAvailable(): Promise<{ available: boolean; platform: string; reason?: string }>;
  queryProductDetails(): Promise<{ products: PlayProductDetails[] }>;
  launchBillingFlow(options: {
    productId: string;
    obfuscatedAccountId?: string;
  }): Promise<{ success: boolean; purchases: PlayPurchaseResult[] }>;
  queryPurchases(): Promise<{ purchases: PlayPurchaseResult[] }>;
  acknowledgePurchase(options: { purchaseToken: string }): Promise<{ success: boolean; purchaseToken: string }>;
}

export const NativeGooglePlayBilling = registerPlugin<NativeGooglePlayBillingPlugin>('GooglePlayBilling');

let testBridgeOverride: NativeGooglePlayBillingPlugin | null = null;
let testNativeAndroidOverride: boolean | null = null;
let authTokenProvider: (() => Promise<string | null> | string | null) | null = null;
let activeSyncPromise: Promise<{ synced: boolean; tier: 'free' | 'premium'; reason?: string }> | null = null;
let lastSyncAtMs = 0;

/**
 * Registers an optional customer authentication token provider (e.g., Firebase ID Token)
 * attached as Authorization: Bearer <token> on purchase verification requests.
 */
export function setBillingAuthTokenProvider(
  provider: (() => Promise<string | null> | string | null) | null
): void {
  authTokenProvider = provider;
}

/**
 * Allows automated tests to inject a mock native bridge and platform override cleanly.
 */
export function setNativeBillingBridgeForTests(
  bridge: NativeGooglePlayBillingPlugin | null,
  isNativeAndroid: boolean | null = null
): void {
  testBridgeOverride = bridge;
  testNativeAndroidOverride = isNativeAndroid;
}

function getNativeBridge(): NativeGooglePlayBillingPlugin {
  return testBridgeOverride || NativeGooglePlayBilling;
}

function isNativeAndroidPlatform(): boolean {
  if (testNativeAndroidOverride !== null) {
    return testNativeAndroidOverride;
  }
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  } catch {
    return false;
  }
}

export const DEFAULT_SUBSCRIPTION_DETAILS: Record<PlayProductId, PlayProductDetails> = {
  [PLAY_PRODUCT_IDS.MONTHLY]: {
    productId: PLAY_PRODUCT_IDS.MONTHLY,
    basePlanId: 'monthly-standard',
    title: 'ExpenseFlow Premium (Monthly)',
    description: 'Full AI Personal Spending Coach, advanced insights, and cloud power.',
    formattedPrice: '$14.99',
    priceCurrencyCode: 'USD',
    priceAmountMicros: 14990000,
    billingPeriod: 'P1M',
  },
  [PLAY_PRODUCT_IDS.ANNUAL]: {
    productId: PLAY_PRODUCT_IDS.ANNUAL,
    basePlanId: 'annual-standard',
    title: 'ExpenseFlow Premium (Annual)',
    description: 'Best value: 38% annual savings on ExpenseFlow Premium.',
    formattedPrice: '$109.99',
    priceCurrencyCode: 'USD',
    priceAmountMicros: 109990000,
    billingPeriod: 'P1Y',
  },
};

function createDefaultEntitlementRecord(): StoredSubscriptionEntitlement {
  return {
    tier: 'free',
    productId: null,
    purchaseToken: null,
    verifiedEntitlementToken: null,
    expiryTimeMillis: null,
    autoRenewing: false,
    cancelAtPeriodEnd: false,
    lastVerifiedAt: 0,
  };
}

export function clearLocalSubscriptionEntitlement(): void {
  saveSubscriptionEntitlement(createDefaultEntitlementRecord());
  setStoredEntitlementToken(null);
}

/**
 * Checks if the Google Play Billing client is supported and available on this device.
 */
export async function checkPlayBillingAvailability(): Promise<{
  available: boolean;
  isNative: boolean;
  reason?: string;
}> {
  const isNative = isNativeAndroidPlatform();

  if (!isNative) {
    return {
      available: false,
      isNative: false,
      reason: 'web_environment',
    };
  }

  try {
    const res = await getNativeBridge().isAvailable();
    return {
      available: Boolean(res.available),
      isNative: true,
      reason: res.reason,
    };
  } catch (err) {
    return {
      available: false,
      isNative: true,
      reason: err instanceof Error ? err.message : 'Billing service unavailable',
    };
  }
}

/**
 * Queries Google Play for live localized subscription pricing.
 * Falls back to default USD pricing if running on Web or Play Console is in setup.
 */
export async function fetchPlaySubscriptionProducts(): Promise<{
  products: Record<PlayProductId, PlayProductDetails>;
  isLiveFromPlayStore: boolean;
}> {
  const availability = await checkPlayBillingAvailability();

  if (!availability.available) {
    return {
      products: DEFAULT_SUBSCRIPTION_DETAILS,
      isLiveFromPlayStore: false,
    };
  }

  try {
    const res = await getNativeBridge().queryProductDetails();
    if (res && Array.isArray(res.products) && res.products.length > 0) {
      const liveMap: Record<string, PlayProductDetails> = { ...DEFAULT_SUBSCRIPTION_DETAILS };
      for (const p of res.products) {
        if (p.productId === PLAY_PRODUCT_IDS.MONTHLY || p.productId === PLAY_PRODUCT_IDS.ANNUAL) {
          liveMap[p.productId] = p;
        }
      }
      return {
        products: liveMap as Record<PlayProductId, PlayProductDetails>,
        isLiveFromPlayStore: true,
      };
    }
  } catch (err) {
    console.warn('[PlayBilling] Query product details fallback:', err);
  }

  return {
    products: DEFAULT_SUBSCRIPTION_DETAILS,
    isLiveFromPlayStore: false,
  };
}

/**
 * Loads stored subscription entitlement record from localStorage.
 * Automatically clears expired entitlements.
 */
export function getStoredSubscriptionEntitlement(): StoredSubscriptionEntitlement {
  const defaultRecord = createDefaultEntitlementRecord();

  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return defaultRecord;
    }
    const raw = window.localStorage.getItem(SUBSCRIPTION_ENTITLEMENT_KEY);
    if (!raw) return defaultRecord;

    const parsed = JSON.parse(raw) as StoredSubscriptionEntitlement;

    if (parsed.expiryTimeMillis && parsed.expiryTimeMillis < Date.now()) {
      clearLocalSubscriptionEntitlement();
      return defaultRecord;
    }

    return parsed;
  } catch {
    return defaultRecord;
  }
}

/**
 * Persists verified subscription entitlement record.
 */
export function saveSubscriptionEntitlement(entitlement: StoredSubscriptionEntitlement): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(SUBSCRIPTION_ENTITLEMENT_KEY, JSON.stringify(entitlement));
    }
  } catch {
    // Ignore storage failure
  }
}

export interface VerifyPurchaseOptions {
  orderId?: string;
  mode?: 'purchase' | 'restore';
  authToken?: string | null;
  obfuscatedAccountId?: string;
  apiConfigOptions?: ResolveApiUrlOptions;
}

/**
 * Verifies purchase token with server-side Google Play Developer API.
 */
export async function verifyPurchaseWithServer(
  purchaseToken: string,
  productId: string,
  options?: VerifyPurchaseOptions
): Promise<VerifyPurchaseResponsePayload> {
  let targetUrl: string;
  try {
    targetUrl = resolveApiUrl('/api/billing/verify', options?.apiConfigOptions);
  } catch (err) {
    if (err instanceof ApiConfigurationError) {
      return {
        success: false,
        status: 'configuration_required',
        message: err.message,
      };
    }
    throw err;
  }

  try {
    const resolvedAuthToken =
      options?.authToken !== undefined
        ? options.authToken
        : authTokenProvider
        ? await authTokenProvider()
        : null;

    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(resolvedAuthToken ? { 'Authorization': `Bearer ${resolvedAuthToken}` } : {}),
      },
      body: JSON.stringify({
        purchaseToken,
        productId,
        packageName: 'com.kastav.expenseflow',
        orderId: options?.orderId,
        mode: options?.mode || 'purchase',
      }),
    });

    let data: VerifyPurchaseResponsePayload;
    try {
      data = (await res.json()) as VerifyPurchaseResponsePayload;
    } catch {
      return {
        success: false,
        status: res.status === 401 ? 'unauthorized' : res.status === 503 ? 'configuration_required' : 'server_error',
        message: `Verification server returned an unreadable response (HTTP ${res.status}).`,
      };
    }

    // Revoked, expired, unauthorized, or ownership-mismatched subscriptions must clear stale cached Premium entitlement immediately
    const isOwnershipMismatch =
      res.status === 401 ||
      res.status === 403 ||
      (res.status === 409 && options?.mode === 'restore');
    if (
      data.status === 'revoked' ||
      data.status === 'expired' ||
      data.status === 'on_hold' ||
      data.status === 'paused' ||
      isOwnershipMismatch
    ) {
      const current = getStoredSubscriptionEntitlement();
      if (current.purchaseToken === purchaseToken) {
        clearLocalSubscriptionEntitlement();
      }
    }

    return data;
  } catch {
    return {
      success: false,
      status: 'server_error',
      message: 'Failed to connect to ExpenseFlow purchase verification server.',
    };
  }
}

async function finalizeVerifiedPurchase(
  purchase: PlayPurchaseResult,
  verification: VerifyPurchaseResponsePayload,
  isNative: boolean
): Promise<{ ok: boolean; errorMessage?: string }> {
  if (!verification.success || verification.status !== 'active' || !verification.verifiedEntitlementToken) {
    return {
      ok: false,
      errorMessage: verification.message || 'Subscription token verification failed.',
    };
  }

  // Only acknowledge if neither the server nor Play cache has confirmed acknowledgement yet.
  // Failing native acknowledgement MUST NOT unlock Premium silently.
  if (isNative && !purchase.isAcknowledged && !verification.acknowledged) {
    try {
      const ackRes = await getNativeBridge().acknowledgePurchase({
        purchaseToken: purchase.purchaseToken,
      });
      if (!ackRes || !ackRes.success) {
        return {
          ok: false,
          errorMessage: 'Purchase acknowledgement with Google Play did not succeed.',
        };
      }
    } catch (ackErr) {
      return {
        ok: false,
        errorMessage:
          ackErr instanceof Error
            ? `Failed to acknowledge Google Play purchase: ${ackErr.message}`
            : 'Failed to acknowledge Google Play purchase.',
      };
    }
  }

  const entitlement: StoredSubscriptionEntitlement = {
    tier: 'premium',
    productId: verification.productId || purchase.productId,
    purchaseToken: purchase.purchaseToken,
    verifiedEntitlementToken: verification.verifiedEntitlementToken,
    expiryTimeMillis: verification.expiryTimeMillis || null,
    autoRenewing: Boolean(verification.autoRenewing),
    cancelAtPeriodEnd: Boolean(verification.cancelAtPeriodEnd),
    lastVerifiedAt: Date.now(),
  };

  saveSubscriptionEntitlement(entitlement);
  setStoredEntitlementToken(verification.verifiedEntitlementToken);

  return { ok: true };
}

/**
 * Launches the native Google Play purchase flow for a subscription.
 */
export async function initiateSubscriptionPurchase(
  productId: PlayProductId,
  verifyOptions?: Omit<VerifyPurchaseOptions, 'orderId' | 'mode'>
): Promise<{
  success: boolean;
  status: 'active' | 'pending' | 'canceled' | 'configuration_required' | 'failed';
  message: string;
}> {
  const availability = await checkPlayBillingAvailability();

  if (!availability.isNative) {
    return {
      success: false,
      status: 'configuration_required',
      message:
        'Google Play In-App Subscriptions are supported directly on Android devices. In web preview mode, purchases cannot be initiated through Google Play.',
    };
  }

  if (!availability.available) {
    return {
      success: false,
      status: 'configuration_required',
      message:
        availability.reason ||
        'Google Play Billing service is currently unavailable or awaiting Play Console product activation.',
    };
  }

  try {
    const launchOptions: { productId: string; obfuscatedAccountId?: string } = { productId };
    if (verifyOptions?.obfuscatedAccountId) {
      launchOptions.obfuscatedAccountId = verifyOptions.obfuscatedAccountId;
    }
    const launchResult = await getNativeBridge().launchBillingFlow(launchOptions);

    if (!launchResult || !launchResult.purchases || launchResult.purchases.length === 0) {
      return {
        success: false,
        status: 'failed',
        message: 'No purchase record returned from Google Play.',
      };
    }

    const purchase = launchResult.purchases[0];

    // PENDING purchases MUST NEVER unlock Premium
    if (purchase.purchaseState === 'PENDING') {
      return {
        success: false,
        status: 'pending',
        message:
          'Your purchase is pending approval by Google Play or your financial institution. Premium will unlock once payment clears.',
      };
    }

    if (purchase.purchaseState !== 'PURCHASED') {
      return {
        success: false,
        status: 'failed',
        message: 'Google Play returned an incomplete purchase state. Premium was not unlocked.',
      };
    }

    // Verify server-side FIRST (server also acknowledges via androidpublisher)
    const verification = await verifyPurchaseWithServer(purchase.purchaseToken, productId, {
      ...verifyOptions,
      orderId: purchase.orderId,
      mode: 'purchase',
    });

    if (verification.status === 'pending') {
      return {
        success: false,
        status: 'pending',
        message:
          verification.message ||
          'Subscription payment is pending confirmation from Google Play. Premium will unlock once payment clears.',
      };
    }

    const finalized = await finalizeVerifiedPurchase(purchase, verification, availability.isNative);
    if (!finalized.ok) {
      return {
        success: false,
        status: verification.status === 'configuration_required' ? 'configuration_required' : 'failed',
        message: finalized.errorMessage || verification.message || 'Subscription token verification failed.',
      };
    }

    return {
      success: true,
      status: 'active',
      message: verification.cancelAtPeriodEnd
        ? 'Subscription confirmed through the end of your paid period.'
        : 'Subscription confirmed! Welcome to ExpenseFlow Premium.',
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (errorMsg.includes('USER_CANCELED') || errorMsg.toLowerCase().includes('canceled')) {
      return {
        success: false,
        status: 'canceled',
        message: 'Purchase was canceled.',
      };
    }

    return {
      success: false,
      status: 'failed',
      message: `Google Play purchase encountered an error: ${errorMsg}`,
    };
  }
}

/**
 * Restores previously purchased subscriptions.
 * Verifies each PURCHASED item with the backend before acknowledgement and Premium unlock.
 * PENDING items never unlock Premium.
 */
export async function restoreSubscriptionPurchases(
  verifyOptions?: Omit<VerifyPurchaseOptions, 'orderId' | 'mode'>
): Promise<{
  restored: boolean;
  status?: 'active' | 'pending' | 'configuration_required' | 'failed';
  message: string;
}> {
  const availability = await checkPlayBillingAvailability();

  if (!availability.isNative) {
    return {
      restored: false,
      status: 'configuration_required',
      message: 'Restore purchases is available on Android devices linked to your Google Play account.',
    };
  }

  if (!availability.available) {
    return {
      restored: false,
      status: 'configuration_required',
      message: availability.reason || 'Google Play Billing service is currently unavailable.',
    };
  }

  try {
    const res = await getNativeBridge().queryPurchases();
    if (!res || !res.purchases || res.purchases.length === 0) {
      return {
        restored: false,
        message: 'No existing active ExpenseFlow subscriptions found on this Google account.',
      };
    }

    let hasPending = false;
    let lastFailureMessage: string | null = null;
    let lastFailureStatus: 'configuration_required' | 'failed' = 'failed';

    for (const p of res.purchases) {
      if (p.purchaseState === 'PENDING') {
        hasPending = true;
        continue;
      }

      if (p.purchaseState !== 'PURCHASED') {
        continue;
      }

      const verification = await verifyPurchaseWithServer(p.purchaseToken, p.productId, {
        ...verifyOptions,
        orderId: p.orderId,
        mode: 'restore',
      });

      if (verification.status === 'pending') {
        hasPending = true;
        continue;
      }

      if (verification.success && verification.status === 'active' && verification.verifiedEntitlementToken) {
        const finalized = await finalizeVerifiedPurchase(p, verification, availability.isNative);
        if (finalized.ok) {
          return {
            restored: true,
            status: 'active',
            message: verification.cancelAtPeriodEnd
              ? 'Your ExpenseFlow Premium subscription was restored through the end of the current paid period.'
              : 'Your ExpenseFlow Premium subscription has been restored successfully.',
          };
        }

        lastFailureMessage = finalized.errorMessage || 'Failed to acknowledge restored purchase.';
        lastFailureStatus = 'failed';
      } else {
        lastFailureMessage = verification.message || 'Purchase could not be verified.';
        if (verification.status === 'configuration_required') {
          lastFailureStatus = 'configuration_required';
        }
      }
    }

    if (hasPending && !lastFailureMessage) {
      return {
        restored: false,
        status: 'pending',
        message: 'Found a pending Google Play purchase awaiting payment settlement. Premium will unlock once payment clears.',
      };
    }

    if (lastFailureMessage) {
      return {
        restored: false,
        status: lastFailureStatus,
        message: lastFailureMessage,
      };
    }

    return {
      restored: false,
      message: 'Found prior purchases, but none are currently active or unexpired.',
    };
  } catch (err) {
    return {
      restored: false,
      status: 'failed',
      message:
        err instanceof Error
          ? `Failed to restore purchases from Google Play: ${err.message}`
          : 'Failed to restore purchases from Google Play. Please try again.',
    };
  }
}

/**
 * Synchronizes local Premium entitlement on app startup and app resume:
 * - Clears expired local entitlements.
 * - On Android, queries Google Play for active subscriptions and re-verifies with the backend.
 * - Clears revoked/expired/refunded local entitlements immediately if Play/backend reports inactive.
 */
export async function syncSubscriptionOnAppActive(
  options?: {
    force?: boolean;
    cooldownMs?: number;
    verifyOptions?: Omit<VerifyPurchaseOptions, 'orderId' | 'mode'>;
  }
): Promise<{ synced: boolean; tier: 'free' | 'premium'; reason?: string }> {
  const cooldownMs = options?.cooldownMs ?? 30_000;
  const now = Date.now();

  if (!options?.force && activeSyncPromise) {
    return activeSyncPromise;
  }

  if (!options?.force && now - lastSyncAtMs < cooldownMs) {
    const current = getStoredSubscriptionEntitlement();
    return { synced: false, tier: current.tier, reason: 'cooldown' };
  }

  const runSync = async (): Promise<{ synced: boolean; tier: 'free' | 'premium'; reason?: string }> => {
    lastSyncAtMs = Date.now();
    // getStoredSubscriptionEntitlement automatically clears expired local tokens
    const stored = getStoredSubscriptionEntitlement();
    const availability = await checkPlayBillingAvailability();

    if (availability.isNative && availability.available) {
      try {
        const res = await getNativeBridge().queryPurchases();
        const purchases = res?.purchases || [];
        const purchased = purchases.filter((p) => p.purchaseState === 'PURCHASED');

        if (purchased.length === 0) {
          // Only revoke local cache if user had a cached Play purchase that is no longer present in Play Store
          if (stored.tier === 'premium' && stored.purchaseToken) {
            clearLocalSubscriptionEntitlement();
            return { synced: true, tier: 'free', reason: 'no_active_play_purchase' };
          }
          return { synced: true, tier: 'free' };
        }

        for (const p of purchased) {
          const verification = await verifyPurchaseWithServer(p.purchaseToken, p.productId, {
            ...options?.verifyOptions,
            orderId: p.orderId,
            mode: 'restore',
          });

          if (verification.success && verification.status === 'active' && verification.verifiedEntitlementToken) {
            const finalized = await finalizeVerifiedPurchase(p, verification, true);
            if (finalized.ok) {
              return { synced: true, tier: 'premium' };
            }
          } else if (
            verification.status === 'revoked' ||
            verification.status === 'expired' ||
            verification.status === 'on_hold' ||
            verification.status === 'paused' ||
            verification.status === 'canceled'
          ) {
            clearLocalSubscriptionEntitlement();
            return { synced: true, tier: 'free', reason: verification.status };
          }
        }

        const refreshed = getStoredSubscriptionEntitlement();
        return { synced: true, tier: refreshed.tier };
      } catch {
        // Offline / Play temporary error: preserve existing non-expired state without crashing startup
        return { synced: false, tier: stored.tier, reason: 'play_sync_error' };
      }
    }

    // Non-native fallback: if an existing purchaseToken exists and auth token is available, re-verify
    if (stored.tier === 'premium' && stored.purchaseToken && stored.productId) {
      const hasAuth =
        options?.verifyOptions?.authToken !== undefined
          ? Boolean(options.verifyOptions.authToken)
          : Boolean(authTokenProvider && (await authTokenProvider()));

      if (hasAuth) {
        const verification = await verifyPurchaseWithServer(stored.purchaseToken, stored.productId, {
          ...options?.verifyOptions,
          mode: 'restore',
        });
        if (verification.success && verification.status === 'active' && verification.verifiedEntitlementToken) {
          saveSubscriptionEntitlement({
            tier: 'premium',
            productId: verification.productId || stored.productId,
            purchaseToken: stored.purchaseToken,
            verifiedEntitlementToken: verification.verifiedEntitlementToken,
            expiryTimeMillis: verification.expiryTimeMillis || stored.expiryTimeMillis,
            autoRenewing: Boolean(verification.autoRenewing),
            cancelAtPeriodEnd: Boolean(verification.cancelAtPeriodEnd),
            lastVerifiedAt: Date.now(),
          });
          setStoredEntitlementToken(verification.verifiedEntitlementToken);
          return { synced: true, tier: 'premium' };
        }
        if (
          verification.status === 'revoked' ||
          verification.status === 'expired' ||
          verification.status === 'on_hold' ||
          verification.status === 'paused' ||
          verification.status === 'canceled'
        ) {
          clearLocalSubscriptionEntitlement();
          return { synced: true, tier: 'free', reason: verification.status };
        }
      }
    }

    return { synced: false, tier: stored.tier };
  };

  activeSyncPromise = runSync().finally(() => {
    activeSyncPromise = null;
  });

  return activeSyncPromise;
}
