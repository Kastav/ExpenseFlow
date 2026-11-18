/**
 * Server-Side Firebase Admin SDK Initialization for ExpenseFlow (project: expenseflow-ad899).
 *
 * Strictly backend-only. Never import this module into browser/client bundles.
 */

import crypto from 'crypto';
import type { App } from 'firebase-admin/app';
import type { Firestore } from 'firebase-admin/firestore';

export const FIREBASE_PROJECT_ID = 'expenseflow-ad899';

export interface VerifiedFirebaseCaller {
  uid: string;
  email?: string;
  emailVerified?: boolean;
  obfuscatedAccountId: string;
}

let cachedAppPromise: Promise<App | null> | null = null;

/**
 * Checks whether Firebase Admin credentials or explicit GCP runtime credentials are configured.
 */
export function isFirebaseAdminConfigured(): boolean {
  const hasSaJson = Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim());
  const hasAppCreds = Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim());
  const isCloudRunAdc = Boolean(
    process.env.USE_GCP_ADC === 'true' &&
      (process.env.K_SERVICE || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT)
  );
  return hasSaJson || hasAppCreds || isCloudRunAdc;
}

/**
 * Initializes (or returns existing) Firebase Admin App singleton bound to expenseflow-ad899.
 * Returns null if no credentials are configured. Throws if configured JSON is malformed.
 */
export async function getFirebaseAdminApp(): Promise<App | null> {
  if (cachedAppPromise) {
    return cachedAppPromise;
  }

  cachedAppPromise = (async () => {
    const adminApp = await import('firebase-admin/app');
    if (adminApp.getApps().length > 0) {
      return adminApp.getApps()[0];
    }

    const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim();
    if (saJson) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(saJson);
      } catch (err) {
        throw new Error(
          `FAIL_CLOSED: Invalid FIREBASE_SERVICE_ACCOUNT_KEY JSON: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      if (parsed.project_id && parsed.project_id !== FIREBASE_PROJECT_ID) {
        throw new Error(
          `FAIL_CLOSED: FIREBASE_SERVICE_ACCOUNT_KEY project_id "${String(parsed.project_id)}" does not match required "${FIREBASE_PROJECT_ID}".`
        );
      }

      return adminApp.initializeApp({
        credential: adminApp.cert(parsed),
        projectId: FIREBASE_PROJECT_ID,
      });
    }

    if (process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()) {
      return adminApp.initializeApp({
        projectId: FIREBASE_PROJECT_ID,
      });
    }

    if (
      process.env.USE_GCP_ADC === 'true' &&
      (process.env.K_SERVICE || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT)
    ) {
      return adminApp.initializeApp({
        projectId: FIREBASE_PROJECT_ID,
      });
    }

    return null;
  })().catch((err) => {
    cachedAppPromise = null;
    throw err;
  });

  return cachedAppPromise;
}

/**
 * Resets cached Firebase Admin singleton (intended strictly for automated tests).
 */
export function resetFirebaseAdminCacheForTests(): void {
  cachedAppPromise = null;
}

/**
 * Verifies a client-supplied Firebase ID Token using Firebase Admin Auth.
 * Enforces revocation check (checkRevoked = true) and project/UID validity.
 */
export async function verifyFirebaseIdToken(bearerToken: string): Promise<VerifiedFirebaseCaller | null> {
  if (!bearerToken || !bearerToken.trim()) {
    return null;
  }

  try {
    const app = await getFirebaseAdminApp();
    if (!app) {
      return null;
    }
    const { getAuth } = await import('firebase-admin/auth');
    const decoded = await getAuth(app).verifyIdToken(bearerToken.trim(), true);
    if (!decoded || !decoded.uid) {
      return null;
    }

    const obfuscatedAccountId = crypto
      .createHash('sha256')
      .update(decoded.uid)
      .digest('hex')
      .slice(0, 32);

    return {
      uid: decoded.uid,
      email: decoded.email,
      emailVerified: decoded.email_verified,
      obfuscatedAccountId,
    };
  } catch {
    return null;
  }
}

/**
 * Returns Firebase Admin Firestore instance for expenseflow-ad899 if configured.
 */
export async function getAdminFirestore(): Promise<Firestore | null> {
  const app = await getFirebaseAdminApp();
  if (!app) {
    return null;
  }

  const { getFirestore } = await import('firebase-admin/firestore');
  const databaseId = process.env.FIRESTORE_DATABASE_ID?.trim();
  const db = databaseId ? getFirestore(app, databaseId) : getFirestore(app);
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch {
    // settings() may throw if already called on an existing instance; safe to ignore
  }
  return db;
}
