/**
 * Client-Side Firebase Authentication Service for ExpenseFlow (project: expenseflow-ad899).
 *
 * Responsibilities:
 * - Email/Password sign-in, account creation, and sign-out via Firebase Auth Web SDK.
 * - Automatic authentication state restoration across app launches via onAuthStateChanged.
 * - Fresh Firebase ID token retrieval (getIdToken) wired directly into Play Billing
 *   verification and AI Spending Coach requests.
 * - Strict privacy & local data preservation: never stores passwords in storage and
 *   never deletes or uploads local offline-first expense records.
 */

import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  deleteUser,
  EmailAuthProvider,
  reauthenticateWithCredential,
  onAuthStateChanged,
  Auth,
  User,
} from 'firebase/auth';
import {
  clearLocalSubscriptionEntitlement,
  setBillingAuthTokenProvider,
} from './playBillingService';
import { setCoachAuthTokenProvider } from './aiCoachService';
import { clearLocalFinancialData } from '../utils/storage';

export interface AuthUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
}

export interface AuthStateSnapshot {
  user: AuthUser | null;
  initialized: boolean;
}

export interface AuthActionResult {
  success: boolean;
  user?: AuthUser;
  errorCode?: string;
  errorMessage?: string;
}

export interface AuthBackendAdapter {
  getCurrentUser(): AuthUser | null;
  getIdToken(forceRefresh?: boolean): Promise<string | null>;
  signInWithEmail(email: string, password: string): Promise<AuthUser>;
  registerWithEmail(email: string, password: string): Promise<AuthUser>;
  signOut(): Promise<void>;
  reauthenticate?(password: string): Promise<void>;
  deleteAccount?(): Promise<void>;
  onAuthStateChanged(callback: (user: AuthUser | null) => void): () => void;
}

export function getFirebaseWebConfig() {
  const env = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : undefined;
  return {
    apiKey: (env?.VITE_FIREBASE_API_KEY || '').trim() || 'AIzaSyCLYdkVvkGffN0cgAB_Aq4gcieY7vKocJw',
    authDomain: (env?.VITE_FIREBASE_AUTH_DOMAIN || '').trim() || 'expenseflow-ad899.firebaseapp.com',
    projectId: (env?.VITE_FIREBASE_PROJECT_ID || '').trim() || 'expenseflow-ad899',
    storageBucket: (env?.VITE_FIREBASE_STORAGE_BUCKET || '').trim() || 'expenseflow-ad899.firebasestorage.app',
    messagingSenderId: (env?.VITE_FIREBASE_MESSAGING_SENDER_ID || '').trim() || '328236928675',
    appId: (env?.VITE_FIREBASE_APP_ID || '').trim() || '1:328236928675:web:e1a63b7a769d97fecb3916',
    measurementId: (env?.VITE_FIREBASE_MEASUREMENT_ID || '').trim() || 'G-KTW24MRHJ5',
  };
}

let cachedAuthInstance: Auth | null = null;
let testBackendOverride: AuthBackendAdapter | null = null;

function mapFirebaseUser(user: User | null): AuthUser | null {
  if (!user) return null;
  return {
    uid: user.uid,
    email: user.email,
    emailVerified: Boolean(user.emailVerified),
  };
}

function getFirebaseAuthInstance(): Auth {
  if (cachedAuthInstance) {
    return cachedAuthInstance;
  }
  const app: FirebaseApp = getApps().length === 0 ? initializeApp(getFirebaseWebConfig()) : getApp();
  cachedAuthInstance = getAuth(app);
  return cachedAuthInstance;
}

export function setAuthBackendForTests(adapter: AuthBackendAdapter | null): void {
  testBackendOverride = adapter;
  connectAuthProviders();
}

export function formatFirebaseAuthError(err: unknown): { code: string; message: string } {
  const code =
    typeof (err as { code?: unknown })?.code === 'string'
      ? (err as { code: string }).code
      : 'auth/unknown';

  switch (code) {
    case 'auth/invalid-email':
      return { code, message: 'Please enter a valid email address.' };
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return { code, message: 'Incorrect email or password. Please check your credentials and try again.' };
    case 'auth/missing-password':
      return { code, message: 'Please enter your password.' };
    case 'auth/email-already-in-use':
      return { code, message: 'An ExpenseFlow account with this email already exists. Try signing in instead.' };
    case 'auth/weak-password':
      return { code, message: 'Password must be at least 6 characters long.' };
    case 'auth/too-many-requests':
      return { code, message: 'Too many authentication attempts. Please wait a moment and try again.' };
    case 'auth/network-request-failed':
      return { code, message: 'Network error while connecting to ExpenseFlow authentication. Check your internet connection.' };
    case 'auth/user-disabled':
      return { code, message: 'This account has been disabled.' };
    case 'auth/operation-not-allowed':
      return { code, message: 'Email/Password sign-in is not enabled in Firebase Authentication settings.' };
    case 'auth/unauthorized-domain':
      return { code, message: 'This app domain is not authorized for Firebase Authentication.' };
    case 'auth/requires-recent-login':
      return {
        code,
        message: 'For your security, please enter your current password to confirm deletion (or sign out and sign back in).',
      };
    case 'auth/invalid-api-key':
      return { code, message: 'Invalid Firebase Web API key configuration.' };
    default: {
      const rawMessage = err instanceof Error ? err.message : '';
      return {
        code,
        message: rawMessage
          ? `Authentication failed: ${rawMessage}`
          : 'Unable to complete authentication. Please try again.',
      };
    }
  }
}

export function getCurrentAuthUser(): AuthUser | null {
  if (testBackendOverride) {
    return testBackendOverride.getCurrentUser();
  }
  try {
    if (typeof window === 'undefined') return null;
    const auth = getFirebaseAuthInstance();
    return mapFirebaseUser(auth.currentUser);
  } catch {
    return null;
  }
}

/**
 * Fetches a fresh Firebase ID token for the currently authenticated user.
 * Waits for Firebase Auth persistence hydration before reading currentUser.
 * Never caches private credentials in localStorage.
 */
export async function getFreshFirebaseIdToken(forceRefresh = true): Promise<string | null> {
  if (testBackendOverride) {
    try {
      return await testBackendOverride.getIdToken(forceRefresh);
    } catch {
      return null;
    }
  }

  try {
    if (typeof window === 'undefined') return null;
    const auth = getFirebaseAuthInstance();
    const authWithReady = auth as Auth & { authStateReady?: () => Promise<void> };
    if (typeof authWithReady.authStateReady === 'function') {
      await authWithReady.authStateReady();
    }
    const user = auth.currentUser;
    if (!user) return null;
    return await user.getIdToken(forceRefresh);
  } catch {
    return null;
  }
}

export async function signInWithEmail(email: string, password: string): Promise<AuthActionResult> {
  const cleanEmail = email.trim();
  if (!cleanEmail || !password) {
    return {
      success: false,
      errorCode: 'auth/missing-fields',
      errorMessage: 'Email and password are required.',
    };
  }

  try {
    const user = testBackendOverride
      ? await testBackendOverride.signInWithEmail(cleanEmail, password)
      : mapFirebaseUser((await signInWithEmailAndPassword(getFirebaseAuthInstance(), cleanEmail, password)).user)!;

    return { success: true, user };
  } catch (err) {
    const formatted = formatFirebaseAuthError(err);
    return {
      success: false,
      errorCode: formatted.code,
      errorMessage: formatted.message,
    };
  }
}

export async function registerWithEmail(email: string, password: string): Promise<AuthActionResult> {
  const cleanEmail = email.trim();
  if (!cleanEmail || !password) {
    return {
      success: false,
      errorCode: 'auth/missing-fields',
      errorMessage: 'Email and password are required.',
    };
  }

  if (password.length < 6) {
    return {
      success: false,
      errorCode: 'auth/weak-password',
      errorMessage: 'Password must be at least 6 characters long.',
    };
  }

  try {
    const user = testBackendOverride
      ? await testBackendOverride.registerWithEmail(cleanEmail, password)
      : mapFirebaseUser((await createUserWithEmailAndPassword(getFirebaseAuthInstance(), cleanEmail, password)).user)!;

    return { success: true, user };
  } catch (err) {
    const formatted = formatFirebaseAuthError(err);
    return {
      success: false,
      errorCode: formatted.code,
      errorMessage: formatted.message,
    };
  }
}

/**
 * Signs out the current Firebase user and clears cached Premium entitlement state,
 * while strictly preserving all local expense records, budgets, plans, and preferences.
 */
export async function signOutUser(): Promise<{ success: boolean; errorMessage?: string }> {
  try {
    if (testBackendOverride) {
      await testBackendOverride.signOut();
    } else if (typeof window !== 'undefined') {
      await signOut(getFirebaseAuthInstance());
    }

    // Clear session-bound subscription entitlement cache on sign-out
    // WITHOUT touching local transactions, budgets, or planner data.
    clearLocalSubscriptionEntitlement();
    return { success: true };
  } catch (err) {
    const formatted = formatFirebaseAuthError(err);
    return { success: false, errorMessage: formatted.message };
  }
}

export interface DeleteAccountOptions {
  passwordForReauth?: string;
  deleteLocalData?: boolean;
}

/**
 * Permanently deletes the signed-in Firebase Authentication account and clears cached
 * subscription entitlement state on this device. Supports inline Firebase credential
 * re-authentication when Firebase returns auth/requires-recent-login.
 * Preserves local offline-first financial records unless deleteLocalData === true.
 */
export async function deleteCurrentUserAccount(
  options?: DeleteAccountOptions
): Promise<{
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
}> {
  const performDelete = async () => {
    if (testBackendOverride) {
      if (typeof testBackendOverride.deleteAccount === 'function') {
        await testBackendOverride.deleteAccount();
      } else {
        await testBackendOverride.signOut();
      }
      return;
    }

    if (typeof window !== 'undefined') {
      const auth = getFirebaseAuthInstance();
      if (!auth.currentUser) {
        const err = new Error('No active signed-in account found to delete.') as Error & { code?: string };
        err.code = 'auth/no-current-user';
        throw err;
      }
      await deleteUser(auth.currentUser);
    }
  };

  try {
    try {
      await performDelete();
    } catch (err) {
      const errCode = (err as { code?: unknown })?.code;
      if (errCode === 'auth/requires-recent-login' && options?.passwordForReauth) {
        if (testBackendOverride && typeof testBackendOverride.reauthenticate === 'function') {
          await testBackendOverride.reauthenticate(options.passwordForReauth);
        } else if (typeof window !== 'undefined') {
          const auth = getFirebaseAuthInstance();
          const current = auth.currentUser;
          if (!current || !current.email) {
            throw err;
          }
          const credential = EmailAuthProvider.credential(current.email, options.passwordForReauth);
          await reauthenticateWithCredential(current, credential);
        }
        await performDelete();
      } else {
        throw err;
      }
    }

    clearLocalSubscriptionEntitlement();
    if (options?.deleteLocalData === true) {
      clearLocalFinancialData();
    }
    return { success: true };
  } catch (err) {
    const formatted = formatFirebaseAuthError(err);
    return {
      success: false,
      errorCode: formatted.code,
      errorMessage: formatted.message,
    };
  }
}

/**
 * Computes the same 32-char lowercase SHA-256 hex digest of Firebase UID as
 * server-side firebaseAdmin.ts for Play Billing obfuscatedExternalAccountId.
 */
export async function getObfuscatedAccountIdForUser(uid?: string | null): Promise<string | undefined> {
  if (!uid || !uid.trim()) return undefined;
  try {
    if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
      const data = new TextEncoder().encode(uid);
      const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
      const bytes = Array.from(new Uint8Array(hashBuffer));
      return bytes.map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
    }
  } catch {
    // Fallback below if WebCrypto subtle is unavailable
  }
  return undefined;
}

/**
 * Subscribes to Firebase auth state restoration and changes.
 */
export function subscribeToAuthState(listener: (snapshot: AuthStateSnapshot) => void): () => void {
  if (testBackendOverride) {
    return testBackendOverride.onAuthStateChanged((user) => {
      listener({ user, initialized: true });
    });
  }

  if (typeof window === 'undefined') {
    listener({ user: null, initialized: true });
    return () => {};
  }

  try {
    const auth = getFirebaseAuthInstance();
    return onAuthStateChanged(auth, (fbUser) => {
      listener({ user: mapFirebaseUser(fbUser), initialized: true });
    });
  } catch {
    listener({ user: null, initialized: true });
    return () => {};
  }
}

/**
 * Wires Firebase ID token retrieval into Play Billing verification and AI Spending Coach requests.
 */
export function connectAuthProviders(): void {
  const provider = () => getFreshFirebaseIdToken(true);
  setBillingAuthTokenProvider(provider);
  setCoachAuthTokenProvider(provider);
}

connectAuthProviders();
