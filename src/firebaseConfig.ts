/**
 * Centralized Firebase Web SDK Configuration & Singleton Initializer for ExpenseFlow.
 *
 * Single source of truth used by Firebase Authentication and Firebase Analytics
 * across Web, Capacitor Android WebView (com.expenseflow.app), and Vite builds.
 * Target Firebase project: expenseflow-ad899 (Firestore Standard Native mode: us-central1).
 *
 * Security rules:
 * - Strictly client-safe Firebase Web options only (never import server SDKs or server keys).
 * - Preserves offline-first localStorage data and never enables paid services or App Check.
 */

import { initializeApp, getApps, getApp, FirebaseApp, FirebaseOptions } from 'firebase/app';

export const EXPENSEFLOW_FIREBASE_PROJECT_ID = 'expenseflow-ad899';

export interface FirebaseWebConfig extends FirebaseOptions {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId: string;
}

export interface FirebaseConfigValidationResult {
  valid: boolean;
  hasMeasurementId: boolean;
  errors: string[];
}

const DEFAULT_FIREBASE_WEB_CONFIG: FirebaseWebConfig = {
  apiKey: 'AIzaSyCLYdkVvkGffN0cgAB_Aq4gcieY7vKocJw',
  authDomain: 'expenseflow-ad899.firebaseapp.com',
  projectId: EXPENSEFLOW_FIREBASE_PROJECT_ID,
  storageBucket: 'expenseflow-ad899.firebasestorage.app',
  messagingSenderId: '328236928675',
  appId: '1:328236928675:web:e1a63b7a769d97fecb3916',
  measurementId: 'G-KTW24MRHJ5',
};

function readEnvValue(env: Record<string, unknown> | undefined, key: string): string {
  const raw = env?.[key];
  return typeof raw === 'string' ? raw.trim() : '';
}

function resolveEnvString(
  env: Record<string, unknown> | undefined,
  key: string,
  fallback: string
): string {
  const val = readEnvValue(env, key);
  if (!val) {
    return fallback;
  }
  return val;
}

/**
 * Resolves and validates the Firebase Web configuration from Vite environment variables,
 * falling back cleanly to the ExpenseFlow project (expenseflow-ad899) defaults when unset.
 */
export function getFirebaseWebConfig(
  envOverride?: Record<string, unknown>
): FirebaseWebConfig {
  const env =
    envOverride ??
    (typeof import.meta !== 'undefined' && import.meta.env
      ? (import.meta.env as Record<string, unknown>)
      : undefined);

  const requestedProjectId = readEnvValue(env, 'VITE_FIREBASE_PROJECT_ID');
  if (requestedProjectId && requestedProjectId !== EXPENSEFLOW_FIREBASE_PROJECT_ID) {
    console.warn(
      `[ExpenseFlow Firebase] Ignoring mismatched VITE_FIREBASE_PROJECT_ID "${requestedProjectId}"; retaining required "${EXPENSEFLOW_FIREBASE_PROJECT_ID}".`
    );
  }

  return {
    apiKey: resolveEnvString(env, 'VITE_FIREBASE_API_KEY', DEFAULT_FIREBASE_WEB_CONFIG.apiKey),
    authDomain: resolveEnvString(
      env,
      'VITE_FIREBASE_AUTH_DOMAIN',
      DEFAULT_FIREBASE_WEB_CONFIG.authDomain
    ),
    projectId: EXPENSEFLOW_FIREBASE_PROJECT_ID,
    storageBucket: resolveEnvString(
      env,
      'VITE_FIREBASE_STORAGE_BUCKET',
      DEFAULT_FIREBASE_WEB_CONFIG.storageBucket
    ),
    messagingSenderId: resolveEnvString(
      env,
      'VITE_FIREBASE_MESSAGING_SENDER_ID',
      DEFAULT_FIREBASE_WEB_CONFIG.messagingSenderId
    ),
    appId: resolveEnvString(env, 'VITE_FIREBASE_APP_ID', DEFAULT_FIREBASE_WEB_CONFIG.appId),
    measurementId: resolveEnvString(
      env,
      'VITE_FIREBASE_MEASUREMENT_ID',
      DEFAULT_FIREBASE_WEB_CONFIG.measurementId
    ),
  };
}

/**
 * Validates that required Firebase Web SDK fields are present and bound to expenseflow-ad899.
 */
export function validateFirebaseWebConfig(
  config: Partial<FirebaseWebConfig>
): FirebaseConfigValidationResult {
  const errors: string[] = [];

  if (!config.apiKey || !config.apiKey.trim()) {
    errors.push('Missing Firebase Web apiKey.');
  }
  if (!config.authDomain || !config.authDomain.trim()) {
    errors.push('Missing Firebase authDomain.');
  }
  if (!config.projectId || config.projectId.trim() !== EXPENSEFLOW_FIREBASE_PROJECT_ID) {
    errors.push(`Firebase projectId must be "${EXPENSEFLOW_FIREBASE_PROJECT_ID}".`);
  }
  if (!config.appId || !config.appId.trim()) {
    errors.push('Missing Firebase Web appId.');
  }

  return {
    valid: errors.length === 0,
    hasMeasurementId: Boolean(config.measurementId && config.measurementId.trim()),
    errors,
  };
}

export const firebaseConfig: FirebaseWebConfig = getFirebaseWebConfig();

/**
 * Returns the singleton default FirebaseApp instance for ExpenseFlow,
 * initializing it once via getApps()/initializeApp()/getApp().
 */
export function getFirebaseClientApp(): FirebaseApp {
  if (getApps().length > 0) {
    return getApp();
  }

  const config = getFirebaseWebConfig();
  const validation = validateFirebaseWebConfig(config);
  if (!validation.valid) {
    throw new Error(
      `Invalid ExpenseFlow Firebase configuration: ${validation.errors.join(' ')}`
    );
  }

  return initializeApp(config);
}
