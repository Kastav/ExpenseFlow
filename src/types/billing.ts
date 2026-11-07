/**
 * Google Play In-App Billing & Subscription Entitlement Types for ExpenseFlow.
 *
 * Strict Google Play Store Compliance:
 * - Product IDs: expenseflow_premium_monthly, expenseflow_premium_annual
 * - Server-side receipt & token verification via Google Play Developer API (androidpublisher v3)
 * - Zero client-side privilege escalation: Premium unlocks ONLY upon valid server confirmation
 */

export const PLAY_PRODUCT_IDS = {
  MONTHLY: 'expenseflow_premium_monthly',
  ANNUAL: 'expenseflow_premium_annual',
} as const;

export type PlayProductId = typeof PLAY_PRODUCT_IDS[keyof typeof PLAY_PRODUCT_IDS];

export interface PlayProductDetails {
  productId: PlayProductId;
  title: string;
  description: string;
  formattedPrice: string;
  priceCurrencyCode: string;
  priceAmountMicros: number;
  billingPeriod: string; // ISO 8601 (e.g. "P1M" for monthly, "P1Y" for annual)
  offerToken?: string;
}

export type PurchaseState = 'PURCHASED' | 'PENDING' | 'UNSPECIFIED';

export interface PlayPurchaseResult {
  orderId?: string;
  productId: string;
  purchaseToken: string;
  purchaseTime: number;
  purchaseState: PurchaseState;
  isAcknowledged: boolean;
  autoRenewing?: boolean;
}

export interface VerifyPurchaseRequestPayload {
  purchaseToken: string;
  productId: string;
  packageName?: string;
}

export type SubscriptionVerificationStatus =
  | 'active'
  | 'expired'
  | 'pending'
  | 'canceled'
  | 'invalid'
  | 'configuration_required'
  | 'server_error';

export interface VerifyPurchaseResponsePayload {
  success: boolean;
  status: SubscriptionVerificationStatus;
  productId?: string;
  expiryTimeMillis?: number;
  autoRenewing?: boolean;
  verifiedEntitlementToken?: string;
  message?: string;
}

export interface StoredSubscriptionEntitlement {
  tier: 'premium' | 'free';
  productId: string | null;
  purchaseToken: string | null;
  verifiedEntitlementToken: string | null;
  expiryTimeMillis: number | null;
  autoRenewing: boolean;
  lastVerifiedAt: number;
}
