/**
 * Premium Packaging, Entitlement & Monetization Types for ExpenseFlow.
 * Enforces strict boundaries between zero-marginal-cost Free features
 * and ongoing cost-incurring Premium features.
 */

export type PlanTier = 'free' | 'premium';

export type BillingCycle = 'monthly' | 'annual';

export interface PlanPricing {
  id: BillingCycle;
  name: string;
  price: number;
  periodLabel: string;
  billingText: string;
  savingsBadge?: string;
  equivalentMonthlyPrice?: number;
}

export const PRICING_TIERS: Record<BillingCycle, PlanPricing> = {
  monthly: {
    id: 'monthly',
    name: 'Premium Monthly',
    price: 14.99,
    periodLabel: '/month',
    billingText: '$14.99 billed monthly',
  },
  annual: {
    id: 'annual',
    name: 'Premium Annual',
    price: 109.99,
    periodLabel: '/year',
    billingText: '$109.99 billed annually (~$9.16/mo)',
    savingsBadge: 'Save 38% ($69.89/yr)',
    equivalentMonthlyPrice: 9.16,
  },
};

/**
 * Free Features: strictly zero or negligible marginal operating costs.
 * These run 100% locally on the user's device without incurring per-user API,
 * cloud, database, or server costs.
 */
export type FreeFeatureId =
  | 'local_expense_tracking'
  | 'local_transaction_history'
  | 'basic_local_budgets'
  | 'basic_local_calculations'
  | 'basic_local_insights'
  | 'csv_export'
  | 'currency_preferences';

/**
 * Premium Features: all features that create ongoing, per-user, API, AI,
 * cloud, server, storage, licensing, or third-party usage costs.
 */
export type PremiumFeatureId =
  | 'ai_spending_coach'
  | 'ai_recommendations'
  | 'advanced_ai_insights'
  | 'cloud_sync_backup'
  | 'paid_bank_integrations';

export interface FeatureSpecification {
  id: FreeFeatureId | PremiumFeatureId;
  name: string;
  description: string;
  isCostIncurring: boolean;
  requiredTier: PlanTier;
  costCategory: 'zero_marginal' | 'ai_llm_api' | 'cloud_database' | 'banking_aggregation';
  status: 'active' | 'planned_preview';
}

export interface EntitlementCheckResult {
  hasAccess: boolean;
  requiredTier: PlanTier;
  feature: FeatureSpecification;
  reason?: string;
}

export interface CostProtectionPolicy {
  maxAiRequestsPerMonth: number;
  maxRequestsPerMinute: number;
  serverValidationRequired: boolean;
  notes: string;
}
