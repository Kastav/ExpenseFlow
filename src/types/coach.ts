/**
 * Types for ExpenseFlow AI Personal Spending Coach.
 * Strict data minimization, rate limiting, and cost protection.
 */

export interface CoachChatMessage {
  id: string;
  sender: 'user' | 'coach';
  text: string;
  timestamp: number;
  status?: 'sending' | 'sent' | 'error';
  errorMessage?: string;
}

export interface SafeCategorySpendSummary {
  category: string;
  amount: number;
  percentage: number;
}

/**
 * Data Minimization Contract:
 * Only aggregate financial health metrics are shared with the AI.
 * Individual transactions, notes, merchants, and timestamps are NEVER included.
 */
export interface SafeFinancialSummary {
  currency: string;
  monthlyBudget: number;
  currentMonthTotalSpent: number;
  budgetUtilizationPct: number;
  remainingMonthlyBudget: number;
  recommendedDailyAllowance: number;
  daysRemainingInMonth: number;
  spendingVelocityStatus: 'normal' | 'caution' | 'critical' | 'no_budget';
  topCategories: SafeCategorySpendSummary[];
  priorMonthComparison?: {
    priorMonthSpend: number;
    spendChangePct: number;
  };
}

export interface CoachChatRequestPayload {
  message: string;
  history?: Array<{
    role: 'user' | 'model';
    text: string;
  }>;
  financialSummary?: SafeFinancialSummary;
  entitlementToken?: string;
  deviceId?: string;
}

export interface CoachChatResponsePayload {
  success: boolean;
  reply?: string;
  error?: 'configuration_required' | 'entitlement_required' | 'rate_limited' | 'quota_exceeded' | 'invalid_request' | 'server_error';
  message?: string;
  usage?: {
    monthlyRequestsUsed: number;
    monthlyQuota: number;
    resetsAt?: string;
  };
}

export interface CoachBackendStatus {
  available: boolean;
  requiresConfig: boolean;
  model: string;
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
