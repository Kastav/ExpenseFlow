/**
 * Centralized Premium Entitlement, Cost Protection & Monetization Engine
 * for ExpenseFlow.
 *
 * MONETIZATION RULE:
 * Every feature that creates ongoing, per-user, API, AI, cloud, server,
 * storage, licensing, or third-party usage costs MUST be Premium-only.
 * Free must contain only features with negligible or zero marginal operating costs.
 */

import {
  PlanTier,
  BillingCycle,
  PRICING_TIERS,
  FreeFeatureId,
  PremiumFeatureId,
  FeatureSpecification,
  EntitlementCheckResult,
  CostProtectionPolicy,
} from '../types/premium';

export { PRICING_TIERS };
export type { PlanTier, BillingCycle, FreeFeatureId, PremiumFeatureId, FeatureSpecification };

/**
 * Master Feature Registry detailing operating costs and tier boundaries.
 */
export const FEATURE_REGISTRY: Record<FreeFeatureId | PremiumFeatureId, FeatureSpecification> = {
  // ZERO-MARGINAL-COST FEATURES (100% Free Forever)
  local_expense_tracking: {
    id: 'local_expense_tracking',
    name: 'Local Expense Tracking',
    description: 'Fast, client-side expense logging using browser local storage with zero server overhead.',
    isCostIncurring: false,
    requiredTier: 'free',
    costCategory: 'zero_marginal',
    status: 'active',
  },
  local_transaction_history: {
    id: 'local_transaction_history',
    name: 'Local Transaction History',
    description: 'Search, filter, and inspect past transactions locally on device.',
    isCostIncurring: false,
    requiredTier: 'free',
    costCategory: 'zero_marginal',
    status: 'active',
  },
  basic_local_budgets: {
    id: 'basic_local_budgets',
    name: 'Monthly Budget & Velocity',
    description: 'Client-side daily spending burn rate and recommended daily allowance calculations.',
    isCostIncurring: false,
    requiredTier: 'free',
    costCategory: 'zero_marginal',
    status: 'active',
  },
  basic_local_calculations: {
    id: 'basic_local_calculations',
    name: 'Purchase Affordability Planner',
    description: 'Deterministic mathematical calculation of upcoming purchase affordability and cash buffer.',
    isCostIncurring: false,
    requiredTier: 'free',
    costCategory: 'zero_marginal',
    status: 'active',
  },
  basic_local_insights: {
    id: 'basic_local_insights',
    name: 'Local Spending Insights',
    description: 'Visual category breakdown, 90-day pacing trends, and habit challenges computed locally.',
    isCostIncurring: false,
    requiredTier: 'free',
    costCategory: 'zero_marginal',
    status: 'active',
  },
  csv_export: {
    id: 'csv_export',
    name: 'Universal CSV Export',
    description: 'Direct browser generation and download of transaction records with zero server bandwidth.',
    isCostIncurring: false,
    requiredTier: 'free',
    costCategory: 'zero_marginal',
    status: 'active',
  },
  currency_preferences: {
    id: 'currency_preferences',
    name: 'Worldwide Currency Display',
    description: 'Display formatting for 150+ ISO 4217 currencies and country selectors.',
    isCostIncurring: false,
    requiredTier: 'free',
    costCategory: 'zero_marginal',
    status: 'active',
  },

  // ONGOING COST-INCURRING FEATURES (Premium Only)
  ai_spending_coach: {
    id: 'ai_spending_coach',
    name: 'AI Personal Spending Coach (Text)',
    description: 'Conversational financial reasoning powered by Gemini LLM tokens. Strictly gated by Premium entitlement and rate limits.',
    isCostIncurring: true,
    requiredTier: 'premium',
    costCategory: 'ai_llm_api',
    status: 'active',
  },
  ai_recommendations: {
    id: 'ai_recommendations',
    name: 'AI-Generated Financial Recommendations',
    description: 'Automated anomaly detection and personalized budget optimizations via cloud AI APIs.',
    isCostIncurring: true,
    requiredTier: 'premium',
    costCategory: 'ai_llm_api',
    status: 'planned_preview',
  },
  advanced_ai_insights: {
    id: 'advanced_ai_insights',
    name: 'Advanced AI Insights & Cash-Flow Forecasts',
    description: 'Deep predictive forecasting and recurring subscription leak analysis requiring cloud compute.',
    isCostIncurring: true,
    requiredTier: 'premium',
    costCategory: 'ai_llm_api',
    status: 'planned_preview',
  },
  cloud_sync_backup: {
    id: 'cloud_sync_backup',
    name: 'Multi-Device Cloud Sync & Encrypted Backup',
    description: 'Real-time database replication, cross-device sync, and off-device cloud storage.',
    isCostIncurring: true,
    requiredTier: 'premium',
    costCategory: 'cloud_database',
    status: 'planned_preview',
  },
  paid_bank_integrations: {
    id: 'paid_bank_integrations',
    name: 'Automated Bank Feeds & Account Sync',
    description: 'Third-party financial data aggregator connections (Plaid / Open Banking API licensing).',
    isCostIncurring: true,
    requiredTier: 'premium',
    costCategory: 'banking_aggregation',
    status: 'planned_preview',
  },
};

/**
 * Cost Protection Policy Configuration.
 * Enforces architectural requirements for any future cost-incurring service.
 */
export const COST_PROTECTION_POLICY: CostProtectionPolicy = {
  maxAiRequestsPerMonth: 100,
  maxRequestsPerMinute: 5,
  serverValidationRequired: true,
  notes:
    'Client-side checks are for UX gating only. Paid APIs must be authenticated server-side with verified subscriber tokens to prevent cost runaway.',
};

export const ENTITLEMENT_TOKEN_KEY = 'expenseflow_entitlement_token_v1';

/**
 * Returns stored verified entitlement token (e.g. from Google Play Billing).
 */
export function getStoredEntitlementToken(): string | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage.getItem(ENTITLEMENT_TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * Stores verified entitlement token upon confirmed subscription or clears it upon expiry.
 */
export function setStoredEntitlementToken(token: string | null): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    if (token) {
      window.localStorage.setItem(ENTITLEMENT_TOKEN_KEY, token);
    } else {
      window.localStorage.removeItem(ENTITLEMENT_TOKEN_KEY);
    }
  } catch {
    // Ignore storage failure
  }
}

/**
 * Returns current user entitlement tier.
 * In free mode without an active entitlement token, returns 'free'.
 * When a verified Google Play entitlement token is present, resolves to 'premium'.
 */
export function getCurrentUserPlanTier(): PlanTier {
  const token = getStoredEntitlementToken();
  if (token && (token === 'premium' || token.startsWith('play_sub_') || token.startsWith('gplay_'))) {
    return 'premium';
  }
  return 'free';
}

/**
 * Evaluates whether a feature is permitted under the current user's entitlement tier.
 */
export function checkFeatureEntitlement(featureId: FreeFeatureId | PremiumFeatureId): EntitlementCheckResult {
  const feature = FEATURE_REGISTRY[featureId];
  if (!feature) {
    throw new Error(`Unknown feature ID: ${featureId}`);
  }

  // Zero-marginal cost features are unconditionally granted to Free tier
  if (!feature.isCostIncurring || feature.requiredTier === 'free') {
    return {
      hasAccess: true,
      requiredTier: 'free',
      feature,
    };
  }

  // Cost-incurring features are strictly Premium-only
  const userTier = getCurrentUserPlanTier();
  if (userTier === 'premium') {
    return {
      hasAccess: true,
      requiredTier: 'premium',
      feature,
    };
  }

  return {
    hasAccess: false,
    requiredTier: 'premium',
    feature,
    reason: `${feature.name} is a Premium feature because it incurs ongoing AI/cloud operating costs.`,
  };
}

/**
 * Returns all Premium features for comparison tables and marketing displays.
 */
export function getPremiumFeaturesList(): FeatureSpecification[] {
  return Object.values(FEATURE_REGISTRY).filter((f) => f.isCostIncurring);
}

/**
 * Returns all Free features for comparison tables.
 */
export function getFreeFeaturesList(): FeatureSpecification[] {
  return Object.values(FEATURE_REGISTRY).filter((f) => !f.isCostIncurring);
}
