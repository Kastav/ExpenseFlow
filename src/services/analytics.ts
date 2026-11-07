import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAnalytics, isSupported, logEvent, Analytics } from 'firebase/analytics';

/**
 * Firebase Web configuration for ExpenseFlow.
 * Reads environment variables with embedded fallback defaults matching
 * the ExpenseFlow Firebase project (expenseflow-ad899) to ensure Analytics
 * initializes reliably on both local Preview and published production builds.
 */
export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyCLYdkVvkGffN0cgAB_Aq4gcieY7vKocJw',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'expenseflow-ad899.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'expenseflow-ad899',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'expenseflow-ad899.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '328236928675',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:328236928675:web:e1a63b7a769d97fecb3916',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || 'G-KTW24MRHJ5',
};

export const ANALYTICS_CONSENT_KEY = 'expenseflow_analytics_consent_v1';

/**
 * Checks whether the user has consented to anonymous usage telemetry.
 * Defaults to true unless explicitly disabled by the user in settings.
 */
export function getAnalyticsConsent(): boolean {
  try {
    if (typeof window === 'undefined') return true;
    const val = localStorage.getItem(ANALYTICS_CONSENT_KEY);
    return val !== 'false';
  } catch {
    return true;
  }
}

/**
 * Persists the user's analytics consent preference to browser storage.
 */
export function setAnalyticsConsent(enabled: boolean): void {
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(ANALYTICS_CONSENT_KEY, enabled ? 'true' : 'false');
    }
  } catch {
    // Non-fatal if localStorage is restricted
  }
}

/**
 * Strict allowlist of permitted analytics events for ExpenseFlow.
 * Privacy rule: Never send expense amounts, categories, notes, payment details,
 * or any financial or personally identifying information.
 */
export type AllowedAnalyticsEvent =
  | 'page_view'
  | 'app_open'
  | 'expenseflow_test'
  | 'expense_added'
  | 'expense_deleted'
  | 'history_viewed'
  | 'insights_viewed'
  | 'planner_used'
  | 'onboarding_completed';

let analyticsInstance: Analytics | null = null;
let isInitialized = false;
let initPromise: Promise<Analytics | null> | null = null;

/**
 * Safely initializes Firebase App and Firebase Analytics only in supported browser environments
 * and when telemetry consent has not been disabled by the user.
 * Strictly verifies the presence of configuration (including measurementId) and browser capabilities.
 * Emits non-sensitive diagnostic console logs without revealing private configuration.
 */
export async function initializeFirebaseAnalytics(): Promise<Analytics | null> {
  // Check user privacy preference before initializing
  if (!getAnalyticsConsent()) {
    console.log('[ExpenseFlow Analytics] Skipped: telemetry disabled by user preference.');
    return null;
  }

  if (isInitialized) {
    return analyticsInstance;
  }

  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      if (!getAnalyticsConsent()) {
        isInitialized = true;
        return null;
      }
      console.log('[ExpenseFlow Analytics] Starting Firebase Analytics initialization...');

      // 1. Verify browser environment
      if (typeof window === 'undefined' || typeof document === 'undefined') {
        console.warn('[ExpenseFlow Analytics] Skipped: non-browser environment.');
        isInitialized = true;
        return null;
      }

      // 2. Verify all required config fields, specifically measurementId
      const hasValidConfig = Boolean(
        firebaseConfig.apiKey &&
        firebaseConfig.projectId &&
        firebaseConfig.appId &&
        firebaseConfig.measurementId
      );

      if (!hasValidConfig) {
        console.warn('[ExpenseFlow Analytics] Configuration incomplete. Ensure apiKey, projectId, appId, and measurementId are set.');
        isInitialized = true;
        return null;
      }
      console.log('[ExpenseFlow Analytics] Configuration check passed (Measurement ID configured).');

      // 3. Verify browser capability (IndexedDB, cookies, storage access)
      const supported = await isSupported().catch((err) => {
        console.warn('[ExpenseFlow Analytics] isSupported check failed:', err?.message || err);
        return false;
      });

      if (!supported) {
        console.warn('[ExpenseFlow Analytics] Browser does not support Firebase Analytics (IndexedDB or cookie access restricted).');
        isInitialized = true;
        return null;
      }
      console.log('[ExpenseFlow Analytics] Browser environment confirmed as supported.');

      // 4. Initialize or retrieve Firebase App
      const app: FirebaseApp = getApps().length === 0
        ? initializeApp(firebaseConfig)
        : getApp();

      // 5. Initialize Analytics
      analyticsInstance = getAnalytics(app);
      isInitialized = true;
      console.log('[ExpenseFlow Analytics] Firebase Analytics successfully initialized.');
      return analyticsInstance;
    } catch (error: any) {
      console.warn('[ExpenseFlow Analytics] Initialization error:', error?.message || error);
      isInitialized = true;
      return null;
    }
  })();

  return initPromise;
}

/**
 * Safely logs an allowed analytics event without any financial or personal data.
 * @param eventName The allowed event name from the strict whitelist
 */
export function trackEvent(eventName: AllowedAnalyticsEvent): void {
  try {
    // Respect user privacy opt-out
    if (!getAnalyticsConsent()) {
      return;
    }

    const dispatch = (analytics: Analytics) => {
      if (eventName === 'page_view') {
        logEvent(analytics, 'page_view', {
          page_title: typeof document !== 'undefined' ? document.title : 'ExpenseFlow',
          page_location: typeof window !== 'undefined' ? window.location.href : '',
          page_path: typeof window !== 'undefined' ? window.location.pathname : '/',
        });
      } else if (eventName === 'expenseflow_test') {
        // Include debug_mode flag so test event appears immediately in GA4 DebugView
        logEvent(analytics, 'expenseflow_test', {
          debug_mode: true,
        });
      } else {
        logEvent(analytics, eventName);
      }
      console.log(`[ExpenseFlow Analytics] Event logged successfully: "${eventName}"`);
    };

    // If analytics is already ready, log immediately
    if (analyticsInstance) {
      dispatch(analyticsInstance);
      return;
    }

    // Otherwise, wait for initialization promise to resolve
    initializeFirebaseAnalytics()
      .then((analytics) => {
        if (analytics) {
          dispatch(analytics);
        } else {
          console.warn(`[ExpenseFlow Analytics] Event "${eventName}" not sent: Analytics instance not active.`);
        }
      })
      .catch((err) => {
        console.warn(`[ExpenseFlow Analytics] Event "${eventName}" dispatch error:`, err?.message || err);
      });
  } catch (error) {
    console.warn(`[ExpenseFlow Analytics] Error dispatching event "${eventName}":`, error);
  }
}
