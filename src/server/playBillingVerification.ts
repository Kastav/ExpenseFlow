/**
 * Server-Side Google Play Purchase Verification Engine.
 * Uses official Google Play Developer API (androidpublisher v3 via googleapis).
 *
 * Rules:
 * - NEVER trusts client-side receipts or headers.
 * - Authenticates with Google Play Developer API to verify purchase tokens.
 * - Confirms subscription status, product ID, expiry date, and auto-renewal.
 * - Returns cryptographically signed verified entitlement token.
 * - Honest configuration-required reporting when service account is not yet configured.
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

const APP_PACKAGE_NAME = 'com.expenseflow.app';

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
 * Initializes Google AndroidPublisher API client using server-side service account credentials.
 */
function getAndroidPublisherClient() {
  const serviceAccountJson = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_KEY;
  const privateKey = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY;
  const clientEmail = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL;

  let credentials;

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
  });
}

/**
 * Generates an HMAC-SHA256 signature for verified entitlement tokens.
 * Strictly binds:
 * - APP_PACKAGE_NAME ('com.expenseflow.app')
 * - productId ('expenseflow_premium_monthly' or 'expenseflow_premium_annual')
 * - expiryTimeMillis (epoch timestamp)
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

  if (productId !== PLAY_PRODUCT_IDS.MONTHLY && productId !== PLAY_PRODUCT_IDS.ANNUAL) {
    throw new Error(`Invalid productId for entitlement token: ${productId}`);
  }

  const payloadStr = `${APP_PACKAGE_NAME}:${productId}:${expiryTimeMillis}`;
  const hmac = crypto.createHmac('sha256', secret).update(payloadStr).digest('hex').slice(0, 32);
  return `play_sub_${productId}_${expiryTimeMillis}_${hmac}`;
}

/**
 * Validates whether an entitlement token's HMAC signature is genuine, unexpired,
 * and bound to the recognized product ID.
 * Optionally verifies matching an expected productId.
 * Fails closed if server secret is not configured.
 */
export function validateVerifiedEntitlementToken(token: string, expectedProductId?: string): boolean {
  if (!token || !token.startsWith('play_sub_')) return false;

  const secret = getSigningSecret();
  if (!secret) {
    // Fail closed: without server secret, no token can be validated
    return false;
  }

  const parts = token.split('_');
  // Format: ['play', 'sub', productId, expiryTimeMillis, hmac]
  // Note: productId might contain underscores (e.g. 'expenseflow_premium_monthly')
  // To handle safely:
  // prefix: 'play_sub_'
  const body = token.substring('play_sub_'.length);
  const lastUnderscore = body.lastIndexOf('_');
  if (lastUnderscore === -1) return false;
  const tokenHmac = body.substring(lastUnderscore + 1);
  const remaining = body.substring(0, lastUnderscore);

  const secondLastUnderscore = remaining.lastIndexOf('_');
  if (secondLastUnderscore === -1) return false;
  const expiryStr = remaining.substring(secondLastUnderscore + 1);
  const productId = remaining.substring(0, secondLastUnderscore);

  // Validate product ID
  if (productId !== PLAY_PRODUCT_IDS.MONTHLY && productId !== PLAY_PRODUCT_IDS.ANNUAL) {
    return false;
  }

  if (expectedProductId && productId !== expectedProductId) {
    return false;
  }

  const expiryTimeMillis = parseInt(expiryStr, 10);
  if (isNaN(expiryTimeMillis) || expiryTimeMillis < Date.now()) {
    return false; // Token expired
  }

  if (!tokenHmac || tokenHmac.length !== 32) return false;

  const payloadStr = `${APP_PACKAGE_NAME}:${productId}:${expiryTimeMillis}`;
  const expectedHmac = crypto.createHmac('sha256', secret).update(payloadStr).digest('hex').slice(0, 32);

  try {
    return crypto.timingSafeEqual(Buffer.from(tokenHmac), Buffer.from(expectedHmac));
  } catch {
    return false;
  }
}

/**
 * GET /api/billing/status
 * Returns Google Play Developer API configuration status.
 */
export function handleBillingStatus(_req: Request, res: Response): void {
  const configured = isPlayBillingConfigured();
  res.status(200).json({
    configured,
    packageName: APP_PACKAGE_NAME,
    supportedProducts: [PLAY_PRODUCT_IDS.MONTHLY, PLAY_PRODUCT_IDS.ANNUAL],
    message: configured
      ? 'Google Play Developer API is configured for server-side verification.'
      : 'Google Play Developer API service account credentials are not configured on the server. Configure GOOGLE_PLAY_SERVICE_ACCOUNT_KEY.',
  });
}

/**
 * POST /api/billing/verify
 * Server-side purchase token verification endpoint.
 */
export async function handleVerifyPurchase(req: Request, res: Response): Promise<void> {
  const payload = req.body as VerifyPurchaseRequestPayload;

  if (!payload || !payload.purchaseToken || !payload.productId) {
    const errorResponse: VerifyPurchaseResponsePayload = {
      success: false,
      status: 'invalid',
      message: 'Missing required purchase verification fields: purchaseToken and productId are mandatory.',
    };
    res.status(400).json(errorResponse);
    return;
  }

  const { purchaseToken, productId, packageName } = payload;

  // Validate package name if passed from client
  if (packageName && packageName !== APP_PACKAGE_NAME) {
    const errorResponse: VerifyPurchaseResponsePayload = {
      success: false,
      status: 'invalid',
      message: `Invalid package name: ${packageName}. Expected ${APP_PACKAGE_NAME}.`,
    };
    res.status(400).json(errorResponse);
    return;
  }

  // Validate that productId belongs to ExpenseFlow Premium
  if (productId !== PLAY_PRODUCT_IDS.MONTHLY && productId !== PLAY_PRODUCT_IDS.ANNUAL) {
    const errorResponse: VerifyPurchaseResponsePayload = {
      success: false,
      status: 'invalid',
      message: `Unknown or unsupported product ID: ${productId}. Expected ${PLAY_PRODUCT_IDS.MONTHLY} or ${PLAY_PRODUCT_IDS.ANNUAL}.`,
    };
    res.status(400).json(errorResponse);
    return;
  }

  // Check if Google Play Developer API credentials exist
  if (!isPlayBillingConfigured()) {
    const response: VerifyPurchaseResponsePayload = {
      success: false,
      status: 'configuration_required',
      message:
        'Google Play Developer API credentials are not yet configured on the backend server. The app is prepared, but server receipt verification requires GOOGLE_PLAY_SERVICE_ACCOUNT_KEY to be linked.',
    };
    res.status(503).json(response);
    return;
  }

  const publisher = getAndroidPublisherClient();
  if (!publisher) {
    res.status(500).json({
      success: false,
      status: 'server_error',
      message: 'Failed to initialize Google AndroidPublisher client.',
    });
    return;
  }

  try {
    // Query Google Play Developer API (purchases.subscriptionsv2)
    const subResponse = await publisher.purchases.subscriptionsv2.get({
      packageName: APP_PACKAGE_NAME,
      token: purchaseToken,
    });

    const subData = subResponse.data;
    if (!subData) {
      res.status(404).json({
        success: false,
        status: 'invalid',
        message: 'Subscription record not found on Google Play for the provided token.',
      });
      return;
    }

    const subscriptionState = subData.subscriptionState;
    // Possible states: SUBSCRIPTION_STATE_ACTIVE, SUBSCRIPTION_STATE_IN_GRACE_PERIOD, SUBSCRIPTION_STATE_CANCELED, etc.
    const isStateActive =
      subscriptionState === 'SUBSCRIPTION_STATE_ACTIVE' ||
      subscriptionState === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD';

    // Parse expiry date
    let expiryTimeMillis = 0;
    if (subData.lineItems && subData.lineItems.length > 0 && subData.lineItems[0].expiryTime) {
      expiryTimeMillis = new Date(subData.lineItems[0].expiryTime).getTime();
    }

    const isUnexpired = expiryTimeMillis > Date.now();
    const autoRenewing = Boolean(subData.lineItems?.[0]?.autoRenewingPlan);

    if (isStateActive && isUnexpired) {
      // Valid active subscription -> issue verified entitlement token
      const verifiedEntitlementToken = generateVerifiedEntitlementToken(
        productId,
        purchaseToken,
        expiryTimeMillis
      );

      const successResponse: VerifyPurchaseResponsePayload = {
        success: true,
        status: 'active',
        productId,
        expiryTimeMillis,
        autoRenewing,
        verifiedEntitlementToken,
        message: 'Google Play subscription verified successfully. Premium tier unlocked.',
      };

      res.status(200).json(successResponse);
      return;
    } else {
      let status: SubscriptionVerificationStatus = 'expired';
      if (subscriptionState === 'SUBSCRIPTION_STATE_PENDING') {
        status = 'pending';
      } else if (subscriptionState === 'SUBSCRIPTION_STATE_CANCELED') {
        status = 'canceled';
      }

      res.status(200).json({
        success: false,
        status,
        productId,
        expiryTimeMillis,
        autoRenewing,
        message: `Subscription is not active. Status: ${subscriptionState || 'expired'}.`,
      });
      return;
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[Google Play Verification Error]', errorMsg);

    res.status(502).json({
      success: false,
      status: 'server_error',
      message: `Failed to verify with Google Play Developer API: ${errorMsg}`,
    });
  }
}
