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

export const SUBSCRIPTION_ENTITLEMENT_KEY = 'expenseflow_subscription_entitlement_v1';

// Register native plugin bridge
interface NativeGooglePlayBillingPlugin {
  isAvailable(): Promise<{ available: boolean; platform: string }>;
  queryProductDetails(): Promise<{ products: PlayProductDetails[] }>;
  launchBillingFlow(options: { productId: string }): Promise<{ success: boolean; purchases: PlayPurchaseResult[] }>;
  queryPurchases(): Promise<{ purchases: PlayPurchaseResult[] }>;
  acknowledgePurchase(options: { purchaseToken: string }): Promise<{ success: boolean; purchaseToken: string }>;
}

export const NativeGooglePlayBilling = registerPlugin<NativeGooglePlayBillingPlugin>('GooglePlayBilling');

export const DEFAULT_SUBSCRIPTION_DETAILS: Record<PlayProductId, PlayProductDetails> = {
  [PLAY_PRODUCT_IDS.MONTHLY]: {
    productId: PLAY_PRODUCT_IDS.MONTHLY,
    title: 'ExpenseFlow Premium (Monthly)',
    description: 'Full AI Personal Spending Coach, advanced insights, and cloud power.',
    formattedPrice: '$14.99',
    priceCurrencyCode: 'USD',
    priceAmountMicros: 14990000,
    billingPeriod: 'P1M',
  },
  [PLAY_PRODUCT_IDS.ANNUAL]: {
    productId: PLAY_PRODUCT_IDS.ANNUAL,
    title: 'ExpenseFlow Premium (Annual)',
    description: 'Best value: 38% annual savings on ExpenseFlow Premium.',
    formattedPrice: '$109.99',
    priceCurrencyCode: 'USD',
    priceAmountMicros: 109990000,
    billingPeriod: 'P1Y',
  },
};

/**
 * Checks if the Google Play Billing client is supported and available on this device.
 */
export async function checkPlayBillingAvailability(): Promise<{
  available: boolean;
  isNative: boolean;
  reason?: string;
}> {
  const isNative = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

  if (!isNative) {
    return {
      available: false,
      isNative: false,
      reason: 'web_environment',
    };
  }

  try {
    const res = await NativeGooglePlayBilling.isAvailable();
    return {
      available: Boolean(res.available),
      isNative: true,
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
    const res = await NativeGooglePlayBilling.queryProductDetails();
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
 * Automatically checks expiry date.
 */
export function getStoredSubscriptionEntitlement(): StoredSubscriptionEntitlement {
  const defaultRecord: StoredSubscriptionEntitlement = {
    tier: 'free',
    productId: null,
    purchaseToken: null,
    verifiedEntitlementToken: null,
    expiryTimeMillis: null,
    autoRenewing: false,
    lastVerifiedAt: 0,
  };

  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return defaultRecord;
    }
    const raw = window.localStorage.getItem(SUBSCRIPTION_ENTITLEMENT_KEY);
    if (!raw) return defaultRecord;

    const parsed = JSON.parse(raw) as StoredSubscriptionEntitlement;

    // Check expiry
    if (parsed.expiryTimeMillis && parsed.expiryTimeMillis < Date.now()) {
      // Subscription has expired
      saveSubscriptionEntitlement(defaultRecord);
      setStoredEntitlementToken(null);
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

/**
 * Verifies purchase token with server-side Google Play Developer API.
 */
export async function verifyPurchaseWithServer(
  purchaseToken: string,
  productId: string
): Promise<VerifyPurchaseResponsePayload> {
  try {
    const res = await fetch('/api/billing/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        purchaseToken,
        productId,
        packageName: 'com.expenseflow.app',
      }),
    });

    return (await res.json()) as VerifyPurchaseResponsePayload;
  } catch (err) {
    return {
      success: false,
      status: 'server_error',
      message: 'Failed to connect to ExpenseFlow purchase verification server.',
    };
  }
}

/**
 * Launches the native Google Play purchase flow for a subscription.
 */
export async function initiateSubscriptionPurchase(productId: PlayProductId): Promise<{
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
        'Google Play Billing service is currently unavailable or awaiting Play Console product activation.',
    };
  }

  try {
    const launchResult = await NativeGooglePlayBilling.launchBillingFlow({ productId });

    if (!launchResult || !launchResult.purchases || launchResult.purchases.length === 0) {
      return {
        success: false,
        status: 'failed',
        message: 'No purchase record returned from Google Play.',
      };
    }

    const purchase = launchResult.purchases[0];

    // If purchase state is PENDING (e.g. slow credit card or cash in store)
    if (purchase.purchaseState === 'PENDING') {
      return {
        success: false,
        status: 'pending',
        message:
          'Your purchase is pending approval by Google Play or your financial institution. Premium will unlock once payment clears.',
      };
    }

    // Securely verify token with server
    const verification = await verifyPurchaseWithServer(purchase.purchaseToken, productId);

    if (verification.success && verification.status === 'active' && verification.verifiedEntitlementToken) {
      // Acknowledge the purchase with Google Play to prevent 3-day automatic refund
      if (availability.isNative && !purchase.isAcknowledged) {
        try {
          await NativeGooglePlayBilling.acknowledgePurchase({ purchaseToken: purchase.purchaseToken });
        } catch (ackErr) {
          console.warn('[PlayBilling] Acknowledge note:', ackErr);
        }
      }

      const entitlement: StoredSubscriptionEntitlement = {
        tier: 'premium',
        productId,
        purchaseToken: purchase.purchaseToken,
        verifiedEntitlementToken: verification.verifiedEntitlementToken,
        expiryTimeMillis: verification.expiryTimeMillis || Date.now() + 30 * 24 * 60 * 60 * 1000,
        autoRenewing: Boolean(verification.autoRenewing),
        lastVerifiedAt: Date.now(),
      };

      saveSubscriptionEntitlement(entitlement);
      setStoredEntitlementToken(verification.verifiedEntitlementToken);

      return {
        success: true,
        status: 'active',
        message: 'Subscription confirmed! Welcome to ExpenseFlow Premium.',
      };
    } else {
      return {
        success: false,
        status: verification.status === 'configuration_required' ? 'configuration_required' : 'failed',
        message: verification.message || 'Subscription token verification failed.',
      };
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (errorMsg.includes('USER_CANCELED') || errorMsg.includes('canceled')) {
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
 */
export async function restoreSubscriptionPurchases(): Promise<{
  restored: boolean;
  message: string;
}> {
  const availability = await checkPlayBillingAvailability();

  if (!availability.isNative) {
    return {
      restored: false,
      message: 'Restore purchases is available on Android devices linked to your Google Play account.',
    };
  }

  try {
    const res = await NativeGooglePlayBilling.queryPurchases();
    if (!res || !res.purchases || res.purchases.length === 0) {
      return {
        restored: false,
        message: 'No existing active ExpenseFlow subscriptions found on this Google account.',
      };
    }

    for (const p of res.purchases) {
      if (p.purchaseState === 'PURCHASED') {
        const verification = await verifyPurchaseWithServer(p.purchaseToken, p.productId);
        if (verification.success && verification.status === 'active' && verification.verifiedEntitlementToken) {
          const entitlement: StoredSubscriptionEntitlement = {
            tier: 'premium',
            productId: p.productId,
            purchaseToken: p.purchaseToken,
            verifiedEntitlementToken: verification.verifiedEntitlementToken,
            expiryTimeMillis: verification.expiryTimeMillis || null,
            autoRenewing: Boolean(verification.autoRenewing),
            lastVerifiedAt: Date.now(),
          };

          saveSubscriptionEntitlement(entitlement);
          setStoredEntitlementToken(verification.verifiedEntitlementToken);

          return {
            restored: true,
            message: 'Your ExpenseFlow Premium subscription has been restored successfully.',
          };
        }
      }
    }

    return {
      restored: false,
      message: 'Found prior purchases, but none are currently active or unexpired.',
    };
  } catch (err) {
    return {
      restored: false,
      message: 'Failed to restore purchases from Google Play. Please try again.',
    };
  }
}
