export interface CoachChatMessage {
  id: string;
  sender: 'user' | 'coach';
  text: string;
  timestamp: number;
  status?: 'sending' | 'sent' | 'error';
  errorMessage?: string;
}

/**
 * Types & Interfaces for ExpenseFlow AI Personal Spending Coach,
 * AI Recommendations, and Advanced AI Insights & Cash-Flow Forecasts.
 * Enforces strict data minimization (zero raw transactions, IDs, or notes sent to Gemini).
 */

export interface SafeCategorySpendSummary {
  category: string;
  amount: number;
  percentage: number;
}

export interface SafeFinancialSummary {
  currency: string;
  monthlyBudget: number;
  currentMonthTotalSpent: number;
  budgetUtilizationPct: number;
  remainingMonthlyBudget: number;
  recommendedDailyAllowance: number;
  daysRemainingInMonth: number;
  spendingVelocityStatus: "normal" | "caution" | "critical" | "no_budget";
  topCategories: SafeCategorySpendSummary[];
  priorMonthComparison?: {
    priorMonthSpend: number;
    spendChangePct: number;
  };
}

export interface SafeHistoricalMonthSummary {
  yearMonth: string;
  totalSpent: number;
  transactionCount: number;
  topCategories: Array<{
    category: string;
    amount: number;
  }>;
}

export interface SafeRecurringPatternSummary {
  category: string;
  occurrences: number;
  averageAmount: number;
  estimatedMonthlyCost: number;
  cadence: "weekly" | "biweekly" | "monthly" | "irregular";
}

export interface SafeAdvancedAnalyticsContext {
  currentMonth: SafeFinancialSummary;
  historicalMonths: SafeHistoricalMonthSummary[];
  recurringPatterns: SafeRecurringPatternSummary[];
  activeChallengeCount: number;
}

export interface CoachChatRequestPayload {
  message: string;
  history?: Array<{
    role: "user" | "model";
    text: string;
  }>;
  financialSummary?: SafeFinancialSummary;
  entitlementToken?: string;
  deviceId?: string;
}

export type CoachErrorCode =
  | "unauthorized"
  | "configuration_required"
  | "entitlement_required"
  | "rate_limited"
  | "quota_exceeded"
  | "invalid_request"
  | "server_error";

export interface CoachUsageSummary {
  monthlyRequestsUsed: number;
  monthlyQuota: number;
  resetsAt?: string;
}

export interface CoachChatResponsePayload {
  success: boolean;
  reply?: string;
  error?: CoachErrorCode;
  message?: string;
  usage?: CoachUsageSummary;
}

export interface AiRecommendationsRequestPayload {
  analyticsContext: SafeAdvancedAnalyticsContext;
  entitlementToken?: string;
  deviceId?: string;
}

export interface AiAnomalyAlert {
  category: string;
  severity: "info" | "warning" | "critical";
  detail: string;
}

export interface AiRecommendationItem {
  id: string;
  title: string;
  category: string;
  priority: "high" | "medium" | "low";
  potentialMonthlySavings: number;
  actionStep: string;
  rationale: string;
}

export interface AiRecommendationsResponsePayload {
  success: boolean;
  summary?: string;
  anomalyAlerts?: AiAnomalyAlert[];
  recommendations?: AiRecommendationItem[];
  generatedAt?: string;
  error?: CoachErrorCode;
  message?: string;
  usage?: CoachUsageSummary;
}

export interface AdvancedAiInsightsRequestPayload {
  analyticsContext: SafeAdvancedAnalyticsContext;
  entitlementToken?: string;
  deviceId?: string;
}

export interface CashFlowForecastSummary {
  projectedMonthEndSpend: number;
  projectedNextMonthSpend: number;
  projectedBudgetVariance: number;
  cashFlowRiskLevel: "low" | "moderate" | "high";
  confidenceNote: string;
}

export interface RecurringLeakInsight {
  category: string;
  estimatedMonthlyCost: number;
  annualizedCost: number;
  observation: string;
}

export interface AdvancedAiInsightsResponsePayload {
  success: boolean;
  summary?: string;
  forecast?: CashFlowForecastSummary;
  recurringLeaks?: RecurringLeakInsight[];
  strategicGuidance?: string[];
  generatedAt?: string;
  error?: CoachErrorCode;
  message?: string;
  usage?: CoachUsageSummary;
}

export interface CoachBackendStatus {
  available: boolean;
  requiresConfig: boolean;
  model: string;
  features?: {
    chat: boolean;
    recommendations: boolean;
    advancedInsights: boolean;
  };
  costProtection: {
    maxMonthlyRequests: number;
    maxRequestsPerMinute: number;
    maxMessageLength: number;
  };
}

export interface CoachLocalUsage {
  monthKey: string; // e.g. "2026-11"
  requestsCount: number;
  recentTimestamps: number[];
}
