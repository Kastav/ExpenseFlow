/**
 * Server-Side Google Play Purchase Verification Engine.
 * Uses official Google Play Developer API (androidpublisher v3 via googleapis).
 *
 * Security & Lifecycle Guarantees:
 * - Never trusts client-supplied entitlement flags, productIds, or device IDs.
 * - Requires authenticated caller identity bound to purchase tokens in durable storage.
 * - Validates packageName and actual Google Play lineItems[0].productId.
 * - Rejects PENDING, EXPIRED, ON_HOLD, PAUSED, INVALID, REPLAYED, and REVOKED purchases.
 * - Allows CANCELED subscriptions to retain paid access until expiryTimeMillis > now.
 * - Acknowledges verified purchases server-side via Google Play Developer API.
 * - Supports Real-Time Developer Notifications (RTDN) with Pub/Sub OIDC verification & deduplication.
 */

import { Request, Response } from 'express';
import crypto from 'crypto';
import { google } from 'googleapis';
import {
  VerifyPurchaseRequestPayload,
  VerifyPurchaseResponsePayload,
  PLAY_PRODUCT_IDS,
  SubscriptionVerificationStatus,
} from '../types/billing';
import {
  EntitlementStore,
  EntitlementStoreConfigurationError,
  getConfiguredEntitlementStore,
  getEntitlementStoreStatus,
  getTokenIdFromHash,
  hashPurchaseToken,
  StoredPurchaseRecord,
} from './entitlementStore.ts';
import {
  FIREBASE_PROJECT_ID,
  verifyFirebaseIdToken,
} from './firebaseAdmin.ts';

const APP_PACKAGE_NAME = 'com.expenseflow.app';

export interface AuthenticatedBillingCaller {
  uid: string;
  obfuscatedAccountId?: string;
}

export interface SubscriptionLineItemV2 {
  productId?: string;
  expiryTime?: string;
  autoRenewingPlan?: {
    autoRenewEnabled?: boolean;
  };
}

export interface SubscriptionPurchaseV2Data {
  subscriptionState?: string;
  acknowledgementState?: string;
  latestOrderId?: string;
  externalAccountIdentifiers?: {
    obfuscatedExternalAccountId?: string;
    obfuscatedExternalProfileId?: string;
  };
  canceledStateContext?: {
    userInitiatedCancellation?: Record<string, unknown>;
    systemInitiatedCancellation?: Record<string, unknown>;
    developerInitiatedCancellation?: Record<string, unknown>;
    replacementCancellation?: Record<string, unknown>;
  };
  lineItems?: SubscriptionLineItemV2[];
}

export interface AndroidPublisherLike {
  purchases: {
    subscriptionsv2: {
      get(params: { packageName: string; token: string }): Promise<{
        data: SubscriptionPurchaseV2Data | null;
      }>;
    };
    subscriptions: {
      acknowledge(params: {
        packageName: string;
        subscriptionId: string;
        token: string;
        requestBody?: { developerPayload?: string };
      }): Promise<unknown>;
    };
  };
}

export interface BillingVerificationDeps {
  store?: EntitlementStore;
  getPublisher?: () => AndroidPublisherLike | null;
  verifyCallerToken?: (bearerToken: string) => Promise<AuthenticatedBillingCaller | null>;
  verifyPubSubOidcToken?: (bearerToken: string, expectedAudience: string) => Promise<boolean>;
  now?: () => number;
  rtdnLeaseDurationMs?: number;
}

/**
 * Returns the secret key for signing entitlement tokens.
 * Strictly fails closed if not configured or if insecure (<16 chars).
 * Never uses hardcoded fallback strings.
 */
function getSigningSecret(): string | null {
  const secret = process.env.PLAY_BILLING_SIGNING_SECRET || process.env.SESSION_SECRET;
  if (!secret || secret.trim().length < 16) {
    return null;
  }
  return secret.trim();
}

/**
 * Checks if Google Play Developer API credentials and signing secrets are set in environment.
 */
export function isPlayBillingConfigured(): boolean {
  const serviceAccountJson = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_KEY;
  const privateKey = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY;
  const clientEmail = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL;
  const hasSigningSecret = Boolean(getSigningSecret());

  const hasGoogleCreds = Boolean(
    (serviceAccountJson && serviceAccountJson.trim().length > 0) ||
      (privateKey && clientEmail && privateKey.trim().length > 0 && clientEmail.trim().length > 0)
  );

  return hasGoogleCreds && hasSigningSecret;
}

/**
 * Checks if Real-Time Developer Notification (Pub/Sub OIDC push) verification is configured.
 */
export function isRtdnConfigured(): boolean {
  return Boolean(process.env.GOOGLE_PUBSUB_AUDIENCE && process.env.GOOGLE_PUBSUB_AUDIENCE.trim().length > 0);
}

/**
 * Initializes Google AndroidPublisher API client using server-side service account credentials.
 */
export function getAndroidPublisherClient(): AndroidPublisherLike | null {
  const serviceAccountJson = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_KEY;
  const privateKey = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY;
  const clientEmail = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL;

  let credentials: Record<string, unknown>;

  if (serviceAccountJson) {
    try {
      credentials = JSON.parse(serviceAccountJson);
    } catch (err) {
      console.error('[Google Play Verification] Failed to parse GOOGLE_PLAY_SERVICE_ACCOUNT_KEY JSON:', err);
      return null;
    }
  } else if (privateKey && clientEmail) {
    credentials = {
      client_email: clientEmail,
      private_key: privateKey.replace(/\\n/g, '\n'),
    };
  } else {
    return null;
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });

  return google.androidpublisher({
    version: 'v3',
    auth,
  }) as unknown as AndroidPublisherLike;
}

async function defaultVerifyCallerToken(bearerToken: string): Promise<AuthenticatedBillingCaller | null> {
  const verified = await verifyFirebaseIdToken(bearerToken);
  if (!verified) return null;
  return {
    uid: verified.uid,
    obfuscatedAccountId: verified.obfuscatedAccountId,
  };
}

async function defaultVerifyPubSubOidcToken(bearerToken: string, expectedAudience: string): Promise<boolean> {
  if (!bearerToken || !expectedAudience) return false;
  try {
    const authClient = new google.auth.OAuth2();
    const ticket = await authClient.verifyIdToken({
      idToken: bearerToken,
      audience: expectedAudience,
    });
    const payload = ticket.getPayload();
    if (!payload) return false;

    const expectedEmail = process.env.GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL?.trim();
    if (expectedEmail && payload.email !== expectedEmail) {
      return false;
    }
    return Boolean(payload.email_verified);
  } catch {
    return false;
  }
}

function isAllowedProductId(productId: string): boolean {
  return productId === PLAY_PRODUCT_IDS.MONTHLY || productId === PLAY_PRODUCT_IDS.ANNUAL;
}

/**
 * Generates an HMAC-SHA256 signature for verified entitlement tokens.
 * Strictly binds:
 * - APP_PACKAGE_NAME ('com.expenseflow.app')
 * - productId ('expenseflow_premium_monthly' or 'expenseflow_premium_annual')
 * - expiryTimeMillis (epoch timestamp)
 * - tokenId (first 16 hex chars of SHA-256(purchaseToken))
 * Fails closed if secret is missing or insecure.
 */
export function generateVerifiedEntitlementToken(
  productId: string,
  purchaseToken: string,
  expiryTimeMillis: number
): string {
  const secret = getSigningSecret();
  if (!secret) {
    throw new Error('FAIL_CLOSED: Entitlement signing secret is not configured on the server.');
  }

  if (!isAllowedProductId(productId)) {
    throw new Error(`Invalid productId for entitlement token: ${productId}`);
  }

  if (!purchaseToken || !purchaseToken.trim()) {
    throw new Error('purchaseToken is required to bind entitlement token.');
  }

  const tokenId = getTokenIdFromHash(hashPurchaseToken(purchaseToken));
  const payloadStr = `${APP_PACKAGE_NAME}:${productId}:${expiryTimeMillis}:${tokenId}`;
  const hmac = crypto.createHmac('sha256', secret).update(payloadStr).digest('hex').slice(0, 32);
  return `play_sub_${productId}_${expiryTimeMillis}_${tokenId}_${hmac}`;
}

export interface ParsedEntitlementToken {
  productId: string;
  expiryTimeMillis: number;
  tokenId: string;
  tokenHmac: string;
}

export function parseVerifiedEntitlementToken(token: string): ParsedEntitlementToken | null {
  if (!token || !token.startsWith('play_sub_')) return null;

  const body = token.substring('play_sub_'.length);
  const lastUnderscore = body.lastIndexOf('_');
  if (lastUnderscore === -1) return null;
  const tokenHmac = body.substring(lastUnderscore + 1);
  const beforeHmac = body.substring(0, lastUnderscore);

  const secondLastUnderscore = beforeHmac.lastIndexOf('_');
  if (secondLastUnderscore === -1) return null;
  const maybeTokenId = beforeHmac.substring(secondLastUnderscore + 1);
  const beforeTokenId = beforeHmac.substring(0, secondLastUnderscore);

  const thirdLastUnderscore = beforeTokenId.lastIndexOf('_');
  if (thirdLastUnderscore === -1) return null;
  const expiryStr = beforeTokenId.substring(thirdLastUnderscore + 1);
  const productId = beforeTokenId.substring(0, thirdLastUnderscore);

  if (!isAllowedProductId(productId)) return null;
  if (!/^\d+$/.test(expiryStr)) return null;
  const expiryTimeMillis = parseInt(expiryStr, 10);
  if (isNaN(expiryTimeMillis)) return null;

  if (!/^[a-f0-9]{16}$/i.test(maybeTokenId)) return null;
  if (!tokenHmac || tokenHmac.length !== 32) return null;

  return {
    productId,
    expiryTimeMillis,
    tokenId: maybeTokenId,
    tokenHmac,
  };
}

/**
 * Validates whether an entitlement token's HMAC signature is genuine, unexpired,
 * and bound to the recognized product ID.
 * Fails closed if server secret is not configured.
 */
export function validateVerifiedEntitlementToken(token: string, expectedProductId?: string): boolean {
  const secret = getSigningSecret();
  if (!secret) {
    return false;
  }

  const parsed = parseVerifiedEntitlementToken(token);
  if (!parsed) return false;

  if (expectedProductId && parsed.productId !== expectedProductId) {
    return false;
  }

  if (parsed.expiryTimeMillis <= Date.now()) {
    return false;
  }

  const payloadStr = `${APP_PACKAGE_NAME}:${parsed.productId}:${parsed.expiryTimeMillis}:${parsed.tokenId}`;
  const expectedHmac = crypto.createHmac('sha256', secret).update(payloadStr).digest('hex').slice(0, 32);

  try {
    return crypto.timingSafeEqual(Buffer.from(parsed.tokenHmac), Buffer.from(expectedHmac));
  } catch {
    return false;
  }
}

/**
 * Validates entitlement token both cryptographically AND against durable server storage
 * so revoked/refunded/expired subscriptions lose API access immediately.
 */
export async function validateEntitlementTokenWithStore(
  token: string,
  store?: EntitlementStore,
  expectedProductId?: string,
  nowMs: number = Date.now(),
  expectedUserId?: string
): Promise<{ valid: boolean; tokenId?: string; productId?: string; userId?: string; reason?: string }> {
  const secret = getSigningSecret();
  if (!secret) {
    return { valid: false, reason: 'missing_signing_secret' };
  }

  const parsed = parseVerifiedEntitlementToken(token);
  if (!parsed) {
    return { valid: false, reason: 'malformed_token' };
  }

  if (expectedProductId && parsed.productId !== expectedProductId) {
    return { valid: false, reason: 'product_mismatch' };
  }

  if (parsed.expiryTimeMillis <= nowMs) {
    return { valid: false, reason: 'expired' };
  }

  const payloadStr = `${APP_PACKAGE_NAME}:${parsed.productId}:${parsed.expiryTimeMillis}:${parsed.tokenId}`;
  const expectedHmac = crypto.createHmac('sha256', secret).update(payloadStr).digest('hex').slice(0, 32);

  let sigValid = false;
  try {
    sigValid = crypto.timingSafeEqual(Buffer.from(parsed.tokenHmac), Buffer.from(expectedHmac));
  } catch {
    sigValid = false;
  }

  if (!sigValid) {
    return { valid: false, reason: 'invalid_signature' };
  }

  const resolvedStore = store || (await getConfiguredEntitlementStore());
  const record = await resolvedStore.getPurchaseRecordByTokenId(parsed.tokenId);

  if (expectedUserId && !record) {
    return { valid: false, reason: 'entitlement_not_found' };
  }

  if (record) {
    if (!record.userId || record.ownershipStatus === 'unbound') {
      return { valid: false, reason: 'unbound_ownership' };
    }
    if (expectedUserId && record.userId !== expectedUserId) {
      return { valid: false, reason: 'ownership_mismatch' };
    }
    if (record.revoked || record.status === 'revoked') {
      return { valid: false, reason: 'revoked' };
    }
    if (
      record.status === 'expired' ||
      record.status === 'pending' ||
      record.status === 'on_hold' ||
      record.status === 'paused' ||
      record.expiryTimeMillis <= nowMs
    ) {
      return { valid: false, reason: 'inactive_in_store' };
    }
    if (record.productId !== parsed.productId) {
      return { valid: false, reason: 'store_product_mismatch' };
    }
  }

  return {
    valid: true,
    tokenId: parsed.tokenId,
    productId: parsed.productId,
    userId: record?.userId ?? undefined,
  };
}

/**
 * GET /api/billing/status
 * Returns Google Play Developer API, RTDN, and persistence configuration status without exposing secrets.
 */
export function handleBillingStatus(_req: Request, res: Response): void {
  const playConfigured = isPlayBillingConfigured();
  const rtdnConfigured = isRtdnConfigured();
  const storeStatus = getEntitlementStoreStatus();
  const configured = playConfigured && storeStatus.ready;
  res.status(200).json({
    configured,
    playApiConfigured: playConfigured,
    persistenceBackend: storeStatus.backend,
    persistenceReady: storeStatus.ready,
    rtdnConfigured,
    firebaseProjectId: FIREBASE_PROJECT_ID,
    packageName: APP_PACKAGE_NAME,
    supportedProducts: [PLAY_PRODUCT_IDS.MONTHLY, PLAY_PRODUCT_IDS.ANNUAL],
    message: !storeStatus.ready
      ? storeStatus.reason
      : configured
      ? 'Google Play Developer API and durable persistence are configured.'
      : 'Google Play Developer API service account credentials are not configured on the server. Configure GOOGLE_PLAY_SERVICE_ACCOUNT_KEY.',
  });
}

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers?.authorization;
  if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.substring(7).trim();
  return token || null;
}

/**
 * Evaluates a SubscriptionPurchaseV2 payload and updates durable storage + acknowledgement
 * using atomic transactions to enforce caller ownership, duplicate-purchase protection,
 * and concurrent revocation safety.
 */
async function evaluateAndPersistSubscription(params: {
  publisher: AndroidPublisherLike;
  store: EntitlementStore;
  callerUid?: string;
  callerObfuscatedAccountId?: string;
  purchaseToken: string;
  requestedProductId?: string;
  requestedOrderId?: string;
  mode: 'purchase' | 'restore' | 'rtdn';
  rtdnEventTimeMillis?: number;
  nowMs: number;
}): Promise<{
  httpStatus: number;
  body: VerifyPurchaseResponsePayload;
  staleIgnored?: boolean;
  ownershipStatus?: 'bound' | 'unbound';
}> {
  const {
    publisher,
    store,
    callerUid,
    callerObfuscatedAccountId,
    purchaseToken,
    requestedProductId,
    requestedOrderId,
    mode,
    rtdnEventTimeMillis,
    nowMs,
  } = params;

  const tokenHash = hashPurchaseToken(purchaseToken);
  const tokenId = getTokenIdFromHash(tokenHash);

  const lock = await store.acquirePurchaseVerificationLock({
    tokenHash,
    tokenId,
    userId: callerUid,
    productId: requestedProductId,
    requestedOrderId,
    mode,
    nowMs,
  });

  if (!lock.ok) {
    if (lock.reason === 'unauthorized') {
      return {
        httpStatus: 401,
        body: {
          success: false,
          status: 'unauthorized',
          message: 'Authenticated customer identity is required to verify Google Play purchases.',
        },
      };
    }

    if (lock.reason === 'revoked') {
      return {
        httpStatus: 403,
        body: {
          success: false,
          status: 'revoked',
          message: 'This subscription purchase has been revoked or refunded.',
        },
      };
    }

    if (lock.reason === 'cross_user_replay') {
      return {
        httpStatus: 409,
        body: {
          success: false,
          status: 'replayed',
          message: 'Purchase token is already bound to a different customer account.',
        },
      };
    }

    return {
      httpStatus: 409,
      body: {
        success: false,
        status: 'replayed',
        message: 'Duplicate purchase verification rejected. Use Restore Purchases to sync an existing subscription.',
      },
    };
  }

  const existing = lock.existing;
  let committed = false;
  const releaseLockIfNeeded = async () => {
    if (!committed) {
      await store.releasePurchaseVerificationLock(tokenHash, lock.createdReservation);
    }
  };

  try {
    let subData: SubscriptionPurchaseV2Data | null = null;
    try {
      const subResponse = await publisher.purchases.subscriptionsv2.get({
        packageName: APP_PACKAGE_NAME,
        token: purchaseToken,
      });
      subData = subResponse.data;
    } catch (err: unknown) {
      const statusCode =
        (err as { code?: number; response?: { status?: number } })?.code ||
        (err as { response?: { status?: number } })?.response?.status;
      if (statusCode === 404 || statusCode === 400) {
        await releaseLockIfNeeded();
        return {
          httpStatus: 404,
          body: {
            success: false,
            status: 'invalid',
            message: 'Subscription record not found or invalid purchase token.',
          },
        };
      }
      if (statusCode === 410) {
        if (existing) {
          await store.commitVerifiedPurchase(
            {
              ...existing,
              userId: existing.userId ?? null,
              ownershipStatus: existing.userId ? 'bound' : 'unbound',
              status: existing.userId ? 'expired' : 'pending',
              subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED',
              lastRtdnEventTimeMillis: rtdnEventTimeMillis,
              updatedAt: nowMs,
              lastVerifiedAt: nowMs,
            },
            mode
          );
          committed = true;
        } else {
          await releaseLockIfNeeded();
        }
        return {
          httpStatus: 410,
          body: {
            success: false,
            status: 'expired',
            message: 'Subscription purchase token is expired or no longer valid on Google Play.',
          },
        };
      }

      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('[Google Play Verification Error]', errorMsg);
      await releaseLockIfNeeded();
      return {
        httpStatus: 502,
        body: {
          success: false,
          status: 'server_error',
          message: 'Failed to verify purchase with Google Play Developer API.',
        },
      };
    }

    if (!subData || !Array.isArray(subData.lineItems) || subData.lineItems.length === 0) {
      await releaseLockIfNeeded();
      return {
        httpStatus: 400,
        body: {
          success: false,
          status: 'invalid',
          message: 'Invalid subscription response from Google Play: missing lineItems.',
        },
      };
    }

    const lineItem = subData.lineItems[0];
    const actualProductId = lineItem.productId;

    if (!actualProductId || !isAllowedProductId(actualProductId)) {
      await releaseLockIfNeeded();
      return {
        httpStatus: 400,
        body: {
          success: false,
          status: 'invalid',
          message: `Unsupported Google Play subscription SKU in verified receipt: ${actualProductId || 'missing'}.`,
        },
      };
    }

    // Strictly enforce match between verified Google SKU and client-claimed productId
    if (requestedProductId && actualProductId !== requestedProductId) {
      await releaseLockIfNeeded();
      return {
        httpStatus: 400,
        body: {
          success: false,
          status: 'invalid',
          message: `Product ID mismatch: client requested "${requestedProductId}", but Google Play receipt is for "${actualProductId}".`,
        },
      };
    }

    // Validate Play obfuscatedExternalAccountId if present on purchase
    const playObfuscatedAccountId = subData.externalAccountIdentifiers?.obfuscatedExternalAccountId;
    if (
      mode !== 'rtdn' &&
      playObfuscatedAccountId &&
      callerObfuscatedAccountId &&
      playObfuscatedAccountId !== callerObfuscatedAccountId
    ) {
      await releaseLockIfNeeded();
      return {
        httpStatus: 403,
        body: {
          success: false,
          status: 'replayed',
          message: 'Purchase account identifier does not match authenticated customer.',
        },
      };
    }

    // Prevent replay / duplicate initial purchase processing once bound to an authenticated user
    const latestOrderId = subData.latestOrderId || requestedOrderId;
    if (
      mode === 'purchase' &&
      existing &&
      existing.userId &&
      (existing.acknowledged || (latestOrderId && existing.latestOrderId === latestOrderId))
    ) {
      await releaseLockIfNeeded();
      return {
        httpStatus: 409,
        body: {
          success: false,
          status: 'replayed',
          message: 'Duplicate purchase verification rejected. Use Restore Purchases to sync an existing subscription.',
        },
      };
    }

    const expiryTimeMillis = lineItem.expiryTime ? new Date(lineItem.expiryTime).getTime() : 0;
    const isUnexpired = !isNaN(expiryTimeMillis) && expiryTimeMillis > nowMs;
    const autoRenewing = Boolean(lineItem.autoRenewingPlan?.autoRenewEnabled ?? lineItem.autoRenewingPlan);
    const subscriptionState = subData.subscriptionState || 'SUBSCRIPTION_STATE_UNSPECIFIED';
    const resolvedExistingUid = existing?.userId ?? null;
    const effectiveUid: string | null = callerUid || resolvedExistingUid;
    const ownershipStatus: 'bound' | 'unbound' = effectiveUid ? 'bound' : 'unbound';

    const isRevokedByGoogle =
      subscriptionState === 'SUBSCRIPTION_STATE_REVOKED' ||
      Boolean(subData.canceledStateContext?.developerInitiatedCancellation && !isUnexpired) ||
      Boolean(subData.canceledStateContext?.systemInitiatedCancellation && !isUnexpired);

    if (isRevokedByGoogle) {
      const commitRes = await store.commitVerifiedPurchase(
        {
          tokenHash,
          tokenId,
          userId: effectiveUid,
          ownershipStatus,
          obfuscatedAccountId: playObfuscatedAccountId || existing?.obfuscatedAccountId,
          productId: actualProductId,
          latestOrderId,
          subscriptionState,
          status: 'revoked',
          expiryTimeMillis: expiryTimeMillis || nowMs,
          autoRenewing: false,
          cancelAtPeriodEnd: false,
          acknowledged: subData.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
          revoked: true,
          revokedAt: existing?.revokedAt || nowMs,
          lastRtdnEventTimeMillis: rtdnEventTimeMillis,
          createdAt: existing?.createdAt || nowMs,
          updatedAt: nowMs,
          lastVerifiedAt: nowMs,
        },
        mode
      );
      committed = true;

      if (!commitRes.ok && commitRes.reason === 'cross_user_replay') {
        return {
          httpStatus: 409,
          body: {
            success: false,
            status: 'replayed',
            message: 'Purchase token is already bound to a different customer account.',
          },
        };
      }

      return {
        httpStatus: 200,
        ownershipStatus,
        body: {
          success: false,
          status: 'revoked',
          productId: actualProductId,
          expiryTimeMillis,
          autoRenewing: false,
          subscriptionState,
          message: 'Subscription purchase was revoked or refunded and is no longer valid.',
        },
      };
    }

    if (subscriptionState === 'SUBSCRIPTION_STATE_PENDING') {
      const commitRes = await store.commitVerifiedPurchase(
        {
          tokenHash,
          tokenId,
          userId: effectiveUid,
          ownershipStatus,
          obfuscatedAccountId: playObfuscatedAccountId || existing?.obfuscatedAccountId,
          productId: actualProductId,
          latestOrderId,
          subscriptionState,
          status: 'pending',
          expiryTimeMillis: expiryTimeMillis || 0,
          autoRenewing: false,
          cancelAtPeriodEnd: false,
          acknowledged: false,
          revoked: false,
          lastRtdnEventTimeMillis: rtdnEventTimeMillis,
          createdAt: existing?.createdAt || nowMs,
          updatedAt: nowMs,
          lastVerifiedAt: nowMs,
        },
        mode
      );
      committed = true;

      if (!commitRes.ok) {
        if (commitRes.reason === 'stale_notification') {
          return {
            httpStatus: 200,
            staleIgnored: true,
            ownershipStatus,
            body: {
              success: true,
              status: existing?.status || 'pending',
              message: 'Stale out-of-order RTDN notification ignored.',
            },
          };
        }
        return {
          httpStatus: commitRes.reason === 'revoked' ? 403 : 409,
          body: {
            success: false,
            status: commitRes.reason === 'revoked' ? 'revoked' : 'replayed',
            message:
              commitRes.reason === 'revoked'
                ? 'This subscription purchase has been revoked or refunded.'
                : 'Purchase token is already bound to a different customer account.',
          },
        };
      }

      return {
        httpStatus: 200,
        ownershipStatus,
        body: {
          success: false,
          status: 'pending',
          productId: actualProductId,
          expiryTimeMillis,
          autoRenewing: false,
          subscriptionState,
          message: 'Subscription payment is pending confirmation from Google Play.',
        },
      };
    }

    const isCanceledWithRemainingPaidTime = subscriptionState === 'SUBSCRIPTION_STATE_CANCELED' && isUnexpired;
    const isStateActive =
      subscriptionState === 'SUBSCRIPTION_STATE_ACTIVE' ||
      subscriptionState === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD' ||
      isCanceledWithRemainingPaidTime;

    if (isStateActive && isUnexpired) {
      const isAlreadyAcknowledged = subData.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED';

      // If an RTDN arrives before any authenticated user verifies the purchase,
      // record it safely as pending/unbound without acknowledging or granting Premium.
      if (mode === 'rtdn' && !effectiveUid) {
        const commitRes = await store.commitVerifiedPurchase(
          {
            tokenHash,
            tokenId,
            userId: null,
            ownershipStatus: 'unbound',
            obfuscatedAccountId: playObfuscatedAccountId || existing?.obfuscatedAccountId,
            productId: actualProductId,
            latestOrderId,
            subscriptionState,
            status: 'pending',
            expiryTimeMillis,
            autoRenewing: false,
            cancelAtPeriodEnd: false,
            acknowledged: isAlreadyAcknowledged,
            revoked: false,
            lastRtdnEventTimeMillis: rtdnEventTimeMillis,
            createdAt: existing?.createdAt || nowMs,
            updatedAt: nowMs,
            lastVerifiedAt: nowMs,
          },
          mode
        );
        committed = true;

        if (!commitRes.ok) {
          if (commitRes.reason === 'stale_notification') {
            return {
              httpStatus: 200,
              staleIgnored: true,
              ownershipStatus: 'unbound',
              body: {
                success: true,
                status: existing?.status || 'pending',
                message: 'Stale out-of-order RTDN notification ignored.',
              },
            };
          }
          if (commitRes.reason === 'revoked') {
            return {
              httpStatus: 200,
              ownershipStatus: 'unbound',
              body: {
                success: false,
                status: 'revoked',
                productId: actualProductId,
                expiryTimeMillis,
                autoRenewing: false,
                subscriptionState,
                message: 'This subscription purchase has been revoked or refunded.',
              },
            };
          }
        }

        return {
          httpStatus: 200,
          ownershipStatus: 'unbound',
          body: {
            success: false,
            status: 'pending',
            productId: actualProductId,
            expiryTimeMillis,
            autoRenewing: false,
            cancelAtPeriodEnd: false,
            acknowledged: isAlreadyAcknowledged,
            subscriptionState,
            message: 'RTDN subscription notification recorded as pending/unbound until authenticated customer verification.',
          },
        };
      }

      let acknowledged = isAlreadyAcknowledged;

      if (!isAlreadyAcknowledged) {
        try {
          await publisher.purchases.subscriptions.acknowledge({
            packageName: APP_PACKAGE_NAME,
            subscriptionId: actualProductId,
            token: purchaseToken,
            requestBody: {},
          });
          acknowledged = true;
        } catch (ackErr) {
          const ackMsg = ackErr instanceof Error ? ackErr.message : String(ackErr);
          console.error('[Google Play Acknowledge Error]', ackMsg);
          await releaseLockIfNeeded();
          return {
            httpStatus: 502,
            body: {
              success: false,
              status: 'server_error',
              acknowledged: false,
              message: 'Subscription verified, but server-side acknowledgement with Google Play failed.',
            },
          };
        }
      }

      const commitRes = await store.commitVerifiedPurchase(
        {
          tokenHash,
          tokenId,
          userId: effectiveUid,
          ownershipStatus: 'bound',
          obfuscatedAccountId: playObfuscatedAccountId || existing?.obfuscatedAccountId,
          productId: actualProductId,
          latestOrderId,
          subscriptionState,
          status: isCanceledWithRemainingPaidTime ? 'canceled' : 'active',
          expiryTimeMillis,
          autoRenewing: isCanceledWithRemainingPaidTime ? false : autoRenewing,
          cancelAtPeriodEnd: isCanceledWithRemainingPaidTime,
          acknowledged,
          revoked: false,
          lastRtdnEventTimeMillis: rtdnEventTimeMillis,
          createdAt: existing?.createdAt || nowMs,
          updatedAt: nowMs,
          lastVerifiedAt: nowMs,
        },
        mode
      );
      committed = true;

      if (!commitRes.ok) {
        if (commitRes.reason === 'stale_notification') {
          return {
            httpStatus: 200,
            staleIgnored: true,
            ownershipStatus: 'bound',
            body: {
              success: true,
              status: existing?.status || 'active',
              message: 'Stale out-of-order RTDN notification ignored.',
            },
          };
        }
        return {
          httpStatus: commitRes.reason === 'revoked' ? 403 : 409,
          body: {
            success: false,
            status: commitRes.reason === 'revoked' ? 'revoked' : 'replayed',
            message:
              commitRes.reason === 'revoked'
                ? 'This subscription purchase has been revoked or refunded.'
                : 'Purchase token is already bound to a different customer account.',
          },
        };
      }

      const verifiedEntitlementToken =
        mode === 'rtdn'
          ? undefined
          : generateVerifiedEntitlementToken(actualProductId, purchaseToken, expiryTimeMillis);

      return {
        httpStatus: 200,
        ownershipStatus: 'bound',
        body: {
          success: true,
          status: 'active',
          productId: actualProductId,
          expiryTimeMillis,
          autoRenewing: isCanceledWithRemainingPaidTime ? false : autoRenewing,
          cancelAtPeriodEnd: isCanceledWithRemainingPaidTime,
          acknowledged,
          subscriptionState,
          verifiedEntitlementToken,
          message: isCanceledWithRemainingPaidTime
            ? 'Subscription is canceled for next renewal, but remains active through the end of the paid period.'
            : 'Google Play subscription verified and acknowledged successfully.',
        },
      };
    }

    // Handle EXPIRED / ON_HOLD / PAUSED / CANCELED-after-expiry
    let inactiveStatus: SubscriptionVerificationStatus = 'expired';
    if (subscriptionState === 'SUBSCRIPTION_STATE_ON_HOLD') {
      inactiveStatus = 'on_hold';
    } else if (subscriptionState === 'SUBSCRIPTION_STATE_PAUSED') {
      inactiveStatus = 'paused';
    } else if (subscriptionState === 'SUBSCRIPTION_STATE_CANCELED') {
      inactiveStatus = 'canceled';
    }

    const commitRes = await store.commitVerifiedPurchase(
      {
        tokenHash,
        tokenId,
        userId: effectiveUid,
        ownershipStatus,
        obfuscatedAccountId: playObfuscatedAccountId || existing?.obfuscatedAccountId,
        productId: actualProductId,
        latestOrderId,
        subscriptionState,
        status: !effectiveUid
          ? 'pending'
          : inactiveStatus === 'on_hold'
          ? 'on_hold'
          : inactiveStatus === 'paused'
          ? 'paused'
          : 'expired',
        expiryTimeMillis,
        autoRenewing: false,
        cancelAtPeriodEnd: false,
        acknowledged: subData.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
        revoked: false,
        lastRtdnEventTimeMillis: rtdnEventTimeMillis,
        createdAt: existing?.createdAt || nowMs,
        updatedAt: nowMs,
        lastVerifiedAt: nowMs,
      },
      mode
    );
    committed = true;

    if (!commitRes.ok) {
      if (commitRes.reason === 'stale_notification') {
        return {
          httpStatus: 200,
          staleIgnored: true,
          ownershipStatus,
          body: {
            success: true,
            status: existing?.status || 'expired',
            message: 'Stale out-of-order RTDN notification ignored.',
          },
        };
      }
      if (commitRes.reason === 'cross_user_replay') {
        return {
          httpStatus: 409,
          body: {
            success: false,
            status: 'replayed',
            message: 'Purchase token is already bound to a different customer account.',
          },
        };
      }
      if (commitRes.reason === 'revoked') {
        return {
          httpStatus: 200,
          ownershipStatus,
          body: {
            success: false,
            status: 'revoked',
            productId: actualProductId,
            expiryTimeMillis,
            autoRenewing: false,
            subscriptionState,
            message: 'This subscription purchase has been revoked or refunded.',
          },
        };
      }
    }

    return {
      httpStatus: 200,
      ownershipStatus,
      body: {
        success: false,
        status: !effectiveUid ? 'pending' : inactiveStatus,
        productId: actualProductId,
        expiryTimeMillis,
        autoRenewing: false,
        subscriptionState,
        message: `Subscription is not active. Status: ${subscriptionState}.`,
      },
    };
  } catch (err) {
    await releaseLockIfNeeded();
    throw err;
  }
}

/**
 * Factory for POST /api/billing/verify handler (supports dependency injection for automated tests).
 */
export function createVerifyPurchaseHandler(deps: BillingVerificationDeps = {}) {
  return async function handleVerifyPurchase(req: Request, res: Response): Promise<void> {
    const nowMs = deps.now ? deps.now() : Date.now();

    // 1. Authenticate caller identity (never trust bare device IDs or unauthenticated callers)
    const bearerToken = extractBearerToken(req);
    if (!bearerToken) {
      res.status(401).json({
        success: false,
        status: 'unauthorized',
        message: 'Authorization Bearer token is required to verify purchases.',
      } satisfies VerifyPurchaseResponsePayload);
      return;
    }

    const verifyCaller = deps.verifyCallerToken || defaultVerifyCallerToken;
    const caller = await verifyCaller(bearerToken);
    if (!caller || !caller.uid) {
      res.status(401).json({
        success: false,
        status: 'unauthorized',
        message: 'Invalid or expired customer authentication token.',
      } satisfies VerifyPurchaseResponsePayload);
      return;
    }

    // 2. Resolve configured durable store (fails closed in production if Firestore is missing)
    let store: EntitlementStore;
    try {
      store = deps.store || (await getConfiguredEntitlementStore());
    } catch (err) {
      const message =
        err instanceof EntitlementStoreConfigurationError
          ? err.message
          : 'Entitlement persistence store is not configured.';
      res.status(503).json({
        success: false,
        status: 'configuration_required',
        message,
      } satisfies VerifyPurchaseResponsePayload);
      return;
    }

    // 3. Validate payload structure
    const payload = req.body as VerifyPurchaseRequestPayload;
    if (
      !payload ||
      typeof payload.purchaseToken !== 'string' ||
      !payload.purchaseToken.trim() ||
      typeof payload.productId !== 'string' ||
      !payload.productId.trim()
    ) {
      res.status(400).json({
        success: false,
        status: 'invalid',
        message: 'Missing required purchase verification fields: purchaseToken and productId are mandatory.',
      } satisfies VerifyPurchaseResponsePayload);
      return;
    }

    const { purchaseToken, productId, packageName, orderId, mode } = payload;

    if (packageName && packageName !== APP_PACKAGE_NAME) {
      res.status(400).json({
        success: false,
        status: 'invalid',
        message: `Invalid package name: ${packageName}. Expected ${APP_PACKAGE_NAME}.`,
      } satisfies VerifyPurchaseResponsePayload);
      return;
    }

    if (!isAllowedProductId(productId)) {
      res.status(400).json({
        success: false,
        status: 'invalid',
        message: `Unknown or unsupported product ID: ${productId}. Expected ${PLAY_PRODUCT_IDS.MONTHLY} or ${PLAY_PRODUCT_IDS.ANNUAL}.`,
      } satisfies VerifyPurchaseResponsePayload);
      return;
    }

    // 4. Ensure Google Play API & signing secret are available
    if (!deps.getPublisher && !isPlayBillingConfigured()) {
      res.status(503).json({
        success: false,
        status: 'configuration_required',
        message:
          'Google Play Developer API credentials are not yet configured on the backend server. Configure GOOGLE_PLAY_SERVICE_ACCOUNT_KEY and PLAY_BILLING_SIGNING_SECRET.',
      } satisfies VerifyPurchaseResponsePayload);
      return;
    }

    if (!getSigningSecret()) {
      res.status(503).json({
        success: false,
        status: 'configuration_required',
        message: 'PLAY_BILLING_SIGNING_SECRET is not configured on the backend server.',
      } satisfies VerifyPurchaseResponsePayload);
      return;
    }

    const publisher = deps.getPublisher ? deps.getPublisher() : getAndroidPublisherClient();
    if (!publisher) {
      res.status(500).json({
        success: false,
        status: 'server_error',
        message: 'Failed to initialize Google AndroidPublisher client.',
      } satisfies VerifyPurchaseResponsePayload);
      return;
    }

    const result = await evaluateAndPersistSubscription({
      publisher,
      store,
      callerUid: caller.uid,
      callerObfuscatedAccountId: caller.obfuscatedAccountId,
      purchaseToken: purchaseToken.trim(),
      requestedProductId: productId,
      requestedOrderId: orderId,
      mode: mode === 'restore' ? 'restore' : 'purchase',
      nowMs,
    });

    res.status(result.httpStatus).json(result.body);
  };
}

export const handleVerifyPurchase = createVerifyPurchaseHandler();

/**
 * Factory for POST /api/billing/rtdn (Google Play Real-Time Developer Notifications via Cloud Pub/Sub).
 * Fails closed unless GOOGLE_PUBSUB_AUDIENCE and valid Pub/Sub OIDC authentication are configured.
 */
export function createRtdnHandler(deps: BillingVerificationDeps = {}) {
  return async function handleRtdnNotification(req: Request, res: Response): Promise<void> {
    const audience = process.env.GOOGLE_PUBSUB_AUDIENCE?.trim();
    if (!audience) {
      res.status(503).json({
        success: false,
        status: 'configuration_required',
        message: 'Google Play RTDN Pub/Sub push verification is not configured (missing GOOGLE_PUBSUB_AUDIENCE).',
      });
      return;
    }

    const bearer = extractBearerToken(req);
    if (!bearer) {
      res.status(401).json({ success: false, status: 'unauthorized', message: 'Missing Pub/Sub OIDC Bearer token.' });
      return;
    }

    const verifyOidc = deps.verifyPubSubOidcToken || defaultVerifyPubSubOidcToken;
    const isAuthed = await verifyOidc(bearer, audience);
    if (!isAuthed) {
      res.status(403).json({ success: false, status: 'unauthorized', message: 'Invalid Pub/Sub OIDC token.' });
      return;
    }

    let store: EntitlementStore;
    try {
      store = deps.store || (await getConfiguredEntitlementStore());
    } catch (err) {
      const message =
        err instanceof EntitlementStoreConfigurationError
          ? err.message
          : 'Entitlement persistence store is not configured.';
      res.status(503).json({ success: false, status: 'configuration_required', message });
      return;
    }

    const message = req.body?.message as
      | { data?: string; messageId?: string; publishTime?: string }
      | undefined;
    if (!message || !message.data || !message.messageId) {
      res.status(400).json({ success: false, status: 'invalid', message: 'Malformed Pub/Sub RTDN envelope.' });
      return;
    }

    let decoded: {
      packageName?: string;
      eventTimeMillis?: string | number;
      subscriptionNotification?: {
        notificationType?: number;
        purchaseToken?: string;
        subscriptionId?: string;
      };
    };

    try {
      decoded = JSON.parse(Buffer.from(message.data, 'base64').toString('utf-8'));
    } catch {
      res.status(400).json({ success: false, status: 'invalid', message: 'Invalid base64 RTDN payload.' });
      return;
    }

    const nowMs = deps.now ? deps.now() : Date.now();
    const subNotif = decoded.subscriptionNotification;
    const eventType =
      decoded.packageName && decoded.packageName !== APP_PACKAGE_NAME
        ? 'ignored_package'
        : !subNotif?.purchaseToken
        ? 'non_subscription'
        : `SUBSCRIPTION_${subNotif.notificationType ?? 'UNKNOWN'}`;

    const rawEventTs =
      decoded.eventTimeMillis !== undefined && decoded.eventTimeMillis !== null
        ? Number(decoded.eventTimeMillis)
        : message.publishTime
        ? Date.parse(message.publishTime)
        : NaN;
    const rtdnEventTimeMillis = Number.isFinite(rawEventTs) && rawEventTs > 0 ? rawEventTs : undefined;

    // Atomically acquire processing lease BEFORE any Google Play API lookup
    const lease = await store.acquireRtdnProcessingLease(message.messageId, {
      eventType,
      nowMs,
      leaseDurationMs: deps.rtdnLeaseDurationMs,
    });

    if (!lease.acquired) {
      if (lease.reason === 'already_completed') {
        res.status(200).json({ success: true, deduplicated: true });
        return;
      }
      res.status(409).json({
        success: false,
        status: 'processing',
        deduplicated: true,
        message: 'Notification is currently being processed by another request.',
      });
      return;
    }

    try {
      if (decoded.packageName && decoded.packageName !== APP_PACKAGE_NAME) {
        await store.completeRtdnNotification(message.messageId, 'ignored_package', nowMs);
        res.status(200).json({ success: true, ignored: true });
        return;
      }

      if (!subNotif?.purchaseToken) {
        await store.completeRtdnNotification(message.messageId, 'non_subscription', nowMs);
        res.status(200).json({ success: true, ignored: true });
        return;
      }

      const publisher = deps.getPublisher ? deps.getPublisher() : getAndroidPublisherClient();
      if (!publisher) {
        await store.failRtdnNotification(message.messageId, 'Google Play client unavailable.', eventType, nowMs);
        res.status(503).json({
          success: false,
          status: 'configuration_required',
          message: 'Google Play client unavailable.',
        });
        return;
      }

      const tokenHash = hashPurchaseToken(subNotif.purchaseToken);
      const tokenId = getTokenIdFromHash(tokenHash);
      // Resolve existing ownership through token index first, falling back to direct record lookup
      const existing =
        (await store.getPurchaseRecordByTokenId(tokenId)) || (await store.getPurchaseRecord(tokenHash));

      // Notification Type 12 = SUBSCRIPTION_REVOKED (immediate revocation)
      if (subNotif.notificationType === 12 && existing) {
        const ownershipStatus: 'bound' | 'unbound' = existing.userId ? 'bound' : 'unbound';
        const commitRes = await store.commitVerifiedPurchase(
          {
            ...existing,
            userId: existing.userId ?? null,
            ownershipStatus,
            status: 'revoked',
            subscriptionState: 'SUBSCRIPTION_STATE_REVOKED',
            autoRenewing: false,
            cancelAtPeriodEnd: false,
            revoked: true,
            revokedAt: existing.revokedAt || nowMs,
            lastRtdnEventTimeMillis: rtdnEventTimeMillis,
            updatedAt: nowMs,
            lastVerifiedAt: nowMs,
          },
          'rtdn'
        );
        await store.completeRtdnNotification(message.messageId, 'SUBSCRIPTION_REVOKED', nowMs);
        res.status(200).json({
          success: true,
          status: 'revoked',
          ownershipStatus,
          ...(commitRes.ok ? {} : { ignored: true }),
        });
        return;
      }

      const evalResult = await evaluateAndPersistSubscription({
        publisher,
        store,
        purchaseToken: subNotif.purchaseToken,
        requestedProductId: subNotif.subscriptionId,
        mode: 'rtdn',
        rtdnEventTimeMillis,
        nowMs,
      });

      if (evalResult.httpStatus >= 500) {
        await store.failRtdnNotification(
          message.messageId,
          evalResult.body.message || 'Transient Google Play API error during RTDN processing.',
          eventType,
          nowMs
        );
        res.status(evalResult.httpStatus).json(evalResult.body);
        return;
      }

      await store.completeRtdnNotification(message.messageId, eventType, nowMs);
      res.status(200).json({
        success: true,
        status: evalResult.body.status,
        ...(evalResult.ownershipStatus ? { ownershipStatus: evalResult.ownershipStatus } : {}),
        ...(evalResult.staleIgnored ? { ignored: true, reason: 'stale_notification' } : {}),
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await store.failRtdnNotification(message.messageId, errMsg, eventType, nowMs);
      res.status(500).json({
        success: false,
        status: 'server_error',
        message: 'Unexpected error while processing RTDN notification.',
      });
    }
  };
}

export const handleRtdnNotification = createRtdnHandler();
