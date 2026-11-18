import { useState, useEffect } from 'react';
import { ApiConfigurationError, resolveApiUrl, ResolveApiUrlOptions } from './apiConfig';

export interface StageFeatureAvailability {
  checked: boolean;
  isStage1OfflineMode: boolean;
  isBackendConfigured: boolean;
  purchasesEnabled: boolean;
  aiCoachEnabled: boolean;
  cloudSyncEnabled: boolean;
  billingReason: string;
  aiCoachReason: string;
}

const DEFAULT_UNAVAILABLE_STATE: StageFeatureAvailability = {
  checked: false,
  isStage1OfflineMode: true,
  isBackendConfigured: false,
  purchasesEnabled: false,
  aiCoachEnabled: false,
  cloudSyncEnabled: false,
  billingReason: 'In-app subscriptions are disabled in Stage 1 offline-first release until Stage 2 backend and Play Console billing are configured.',
  aiCoachReason: 'AI Personal Spending Coach is disabled in Stage 1 offline-first release until the Stage 2 backend is deployed.',
};

let testAvailabilityOverride: Partial<StageFeatureAvailability> | null = null;

/**
 * Allows automated tests to deterministically override Stage 1/2 feature availability.
 */
export function setStageAvailabilityForTests(
  override: Partial<StageFeatureAvailability> | null
): void {
  testAvailabilityOverride = override;
}

/**
 * Synchronous initial assessment based strictly on compiled client configuration.
 * Ensures native Android builds without VITE_API_BASE_URL default immediately to
 * Stage 1 offline-first mode without firing dead network requests.
 */
export function getInitialStageAvailability(
  apiConfigOptions?: ResolveApiUrlOptions
): StageFeatureAvailability {
  if (testAvailabilityOverride) {
    return {
      ...DEFAULT_UNAVAILABLE_STATE,
      checked: true,
      ...testAvailabilityOverride,
    };
  }

  try {
    resolveApiUrl('/api/billing/status', apiConfigOptions);
    // Relative / web URL or valid explicit HTTPS base URL exists, but fail closed
    // until live /api/billing/status and /api/coach/status confirm Stage 2 readiness.
    return {
      ...DEFAULT_UNAVAILABLE_STATE,
      checked: false,
      isStage1OfflineMode: false,
      isBackendConfigured: true,
    };
  } catch (err) {
    if (err instanceof ApiConfigurationError) {
      return {
        ...DEFAULT_UNAVAILABLE_STATE,
        checked: true,
        isStage1OfflineMode: true,
        isBackendConfigured: false,
      };
    }
    return {
      ...DEFAULT_UNAVAILABLE_STATE,
      checked: true,
      isStage1OfflineMode: true,
      isBackendConfigured: false,
    };
  }
}

/**
 * Probes server readiness endpoints when a backend URL exists to determine whether
 * Stage 2 monetization and AI features are genuinely active on the server.
 * Always fails closed to Stage 1 disabled state if unconfigured or unreachable.
 */
export async function resolveStageFeatureAvailability(
  apiConfigOptions?: ResolveApiUrlOptions
): Promise<StageFeatureAvailability> {
  if (testAvailabilityOverride) {
    return {
      ...DEFAULT_UNAVAILABLE_STATE,
      checked: true,
      ...testAvailabilityOverride,
    };
  }

  let billingStatusUrl: string;
  let coachStatusUrl: string;
  try {
    billingStatusUrl = resolveApiUrl('/api/billing/status', apiConfigOptions);
    coachStatusUrl = resolveApiUrl('/api/coach/status', apiConfigOptions);
  } catch {
    return {
      ...DEFAULT_UNAVAILABLE_STATE,
      checked: true,
      isStage1OfflineMode: true,
      isBackendConfigured: false,
    };
  }

  let purchasesEnabled = false;
  let aiCoachEnabled = false;
  let billingReason = DEFAULT_UNAVAILABLE_STATE.billingReason;
  let aiCoachReason = DEFAULT_UNAVAILABLE_STATE.aiCoachReason;

  try {
    const billingRes = await fetch(billingStatusUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (billingRes.ok) {
      const billingJson = (await billingRes.json()) as {
        configured?: boolean;
        persistenceReady?: boolean;
      };
      if (billingJson.configured === true && billingJson.persistenceReady === true) {
        purchasesEnabled = true;
        billingReason = 'Google Play Billing server verification active.';
      }
    }
  } catch {
    // Keep fail-closed Stage 1 disabled state
  }

  try {
    const coachRes = await fetch(coachStatusUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (coachRes.ok) {
      const coachJson = (await coachRes.json()) as { available?: boolean };
      // AI Coach requires both verified server-side billing/persistence AND configured Gemini key
      if (coachJson.available === true && purchasesEnabled) {
        aiCoachEnabled = true;
        aiCoachReason = 'AI Spending Coach backend online.';
      }
    }
  } catch {
    // Keep fail-closed Stage 1 disabled state
  }

  return {
    checked: true,
    isStage1OfflineMode: !purchasesEnabled && !aiCoachEnabled,
    isBackendConfigured: true,
    purchasesEnabled,
    aiCoachEnabled,
    cloudSyncEnabled: false,
    billingReason,
    aiCoachReason,
  };
}

/**
 * React hook for UI components to inspect Stage 1 vs Stage 2 readiness safely.
 */
export function useStageAvailability(active: boolean = true): StageFeatureAvailability {
  const [availability, setAvailability] = useState<StageFeatureAvailability>(() =>
    getInitialStageAvailability()
  );

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    resolveStageFeatureAvailability()
      .then((res) => {
        if (!cancelled) {
          setAvailability(res);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAvailability({ ...DEFAULT_UNAVAILABLE_STATE, checked: true });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [active]);

  return availability;
}
