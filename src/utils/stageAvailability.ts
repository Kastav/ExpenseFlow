import { useState, useEffect } from 'react';
import { ApiConfigurationError, resolveApiUrl, ResolveApiUrlOptions } from './apiConfig';

export interface StageFeatureAvailability {
  checked: boolean;
  isStage1OfflineMode: boolean;
  isBackendConfigured: boolean;
  purchasesEnabled: boolean;
  aiCoachEnabled: boolean;
  aiRecommendationsEnabled: boolean;
  advancedAiInsightsEnabled: boolean;
  cloudSyncEnabled: boolean;
  billingReason: string;
  aiCoachReason: string;
  cloudSyncReason: string;
}

const DEFAULT_UNAVAILABLE_STATE: StageFeatureAvailability = {
  checked: false,
  isStage1OfflineMode: true,
  isBackendConfigured: false,
  purchasesEnabled: false,
  aiCoachEnabled: false,
  aiRecommendationsEnabled: false,
  advancedAiInsightsEnabled: false,
  cloudSyncEnabled: false,
  billingReason:
    'In-app subscription verification requires an online ExpenseFlow backend connection. All offline tracking and budgeting remain 100% active.',
  aiCoachReason:
    'AI Personal Spending Coach, AI Recommendations, and Advanced AI Insights require an online ExpenseFlow AI backend connection.',
  cloudSyncReason:
    'Multi-Device Cloud Sync requires an online ExpenseFlow backend and Firestore database connection. Local CSV export remains 100% available.',
};

let testAvailabilityOverride: Partial<StageFeatureAvailability> | null = null;

/**
 * Allows automated tests to deterministically override backend feature availability.
 */
export function setStageAvailabilityForTests(
  override: Partial<StageFeatureAvailability> | null
): void {
  testAvailabilityOverride = override;
}

/**
 * Synchronous initial assessment based strictly on compiled client configuration.
 * Ensures native Android builds without VITE_API_BASE_URL default immediately to
 * offline-first mode without firing dead network requests.
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
 * Play Billing, Gemini AI features, and Cloud Sync are genuinely active on the server.
 * Always fails closed if unconfigured or unreachable.
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
  let cloudSyncStatusUrl: string;
  try {
    billingStatusUrl = resolveApiUrl('/api/billing/status', apiConfigOptions);
    coachStatusUrl = resolveApiUrl('/api/coach/status', apiConfigOptions);
    cloudSyncStatusUrl = resolveApiUrl('/api/cloud-sync/status', apiConfigOptions);
  } catch {
    return {
      ...DEFAULT_UNAVAILABLE_STATE,
      checked: true,
      isStage1OfflineMode: true,
      isBackendConfigured: false,
    };
  }

  let purchasesEnabled = false;
  let persistenceReady = false;
  let aiCoachEnabled = false;
  let aiRecommendationsEnabled = false;
  let advancedAiInsightsEnabled = false;
  let cloudSyncEnabled = false;
  let billingReason = DEFAULT_UNAVAILABLE_STATE.billingReason;
  let aiCoachReason = DEFAULT_UNAVAILABLE_STATE.aiCoachReason;
  let cloudSyncReason = DEFAULT_UNAVAILABLE_STATE.cloudSyncReason;

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
      persistenceReady = Boolean(billingJson.persistenceReady);
      if (billingJson.configured === true && persistenceReady) {
        purchasesEnabled = true;
        billingReason = 'Google Play Billing server verification active.';
      } else if (persistenceReady && !billingJson.configured) {
        billingReason =
          'Subscription verification backend is online, awaiting Google Play service credentials.';
      }
    }
  } catch {
    // Fail closed
  }

  try {
    const coachRes = await fetch(coachStatusUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (coachRes.ok) {
      const coachJson = (await coachRes.json()) as {
        available?: boolean;
        features?: {
          chat?: boolean;
          recommendations?: boolean;
          advancedInsights?: boolean;
        };
      };
      if (coachJson.available === true && purchasesEnabled) {
        aiCoachEnabled = coachJson.features?.chat ?? true;
        aiRecommendationsEnabled = coachJson.features?.recommendations ?? true;
        advancedAiInsightsEnabled = coachJson.features?.advancedInsights ?? true;
        aiCoachReason = 'ExpenseFlow Gemini AI backend online.';
      } else if (!purchasesEnabled && coachJson.available === true) {
        aiCoachReason =
          'AI backend requires active subscription verification and Firestore persistence.';
      }
    }
  } catch {
    // Fail closed
  }

  try {
    const syncRes = await fetch(cloudSyncStatusUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (syncRes.ok) {
      const syncJson = (await syncRes.json()) as { available?: boolean };
      if (syncJson.available === true && persistenceReady) {
        cloudSyncEnabled = true;
        cloudSyncReason = 'Multi-Device Cloud Sync backend online.';
      }
    }
  } catch {
    // Fail closed
  }

  return {
    checked: true,
    isStage1OfflineMode:
      !purchasesEnabled && !aiCoachEnabled && !cloudSyncEnabled,
    isBackendConfigured: true,
    purchasesEnabled,
    aiCoachEnabled,
    aiRecommendationsEnabled,
    advancedAiInsightsEnabled,
    cloudSyncEnabled,
    billingReason,
    aiCoachReason,
    cloudSyncReason,
  };
}

/**
 * React hook for UI components to inspect live backend vs offline readiness safely.
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
