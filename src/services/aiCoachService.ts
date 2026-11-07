/**
 * Client Service for ExpenseFlow AI Personal Spending Coach.
 *
 * Core Principles:
 * 1. Strict Data Minimization: Transmits ONLY aggregated summary metrics.
 *    Individual transactions, notes, merchants, and dates are NEVER sent.
 * 2. Cost Protection: Enforces client-side rate limit & monthly quota checks.
 * 3. Entitlement Boundary: Sends verified subscription token and tier headers.
 * 4. Truthful Error Handling: Accurately reflects unconfigured server or quota limits.
 */

import { Expense, BudgetSettings, CurrencyCode } from '../types/expense';
import {
  SafeFinancialSummary,
  SafeCategorySpendSummary,
  CoachChatRequestPayload,
  CoachChatResponsePayload,
  CoachBackendStatus,
  CoachLocalUsage,
} from '../types/coach';
import { getCurrentUserPlanTier, getStoredEntitlementToken } from '../utils/premium';

const LOCAL_USAGE_KEY = 'expenseflow_ai_local_usage_v1';
const DEVICE_ID_KEY = 'expenseflow_device_id_v1';

export const MAX_MONTHLY_QUOTA = 100;
export const MAX_REQUESTS_PER_MINUTE = 5;

/**
 * Returns or initializes a persistent, anonymous device identifier for rate limiting.
 */
export function getOrCreateDeviceId(): string {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return 'anon_device';
    }
    let id = window.localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = `dev_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
      window.localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return 'anon_device';
  }
}

/**
 * Loads client-side usage statistics for the current month.
 */
export function getCoachLocalUsage(): CoachLocalUsage {
  const currentMonthKey = new Date().toISOString().substring(0, 7); // e.g. "2026-11"
  const defaultUsage: CoachLocalUsage = {
    monthKey: currentMonthKey,
    requestsCount: 0,
    recentTimestamps: [],
  };

  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return defaultUsage;
    }
    const raw = window.localStorage.getItem(LOCAL_USAGE_KEY);
    if (!raw) return defaultUsage;

    const parsed = JSON.parse(raw) as CoachLocalUsage;
    if (parsed.monthKey !== currentMonthKey) {
      return defaultUsage;
    }

    // Filter recent timestamps older than 60s
    const oneMinAgo = Date.now() - 60000;
    parsed.recentTimestamps = (parsed.recentTimestamps || []).filter((ts) => ts > oneMinAgo);
    return parsed;
  } catch {
    return defaultUsage;
  }
}

/**
 * Records a successful AI request in local storage.
 */
export function recordCoachLocalRequest(): CoachLocalUsage {
  const usage = getCoachLocalUsage();
  usage.requestsCount += 1;
  usage.recentTimestamps.push(Date.now());

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(LOCAL_USAGE_KEY, JSON.stringify(usage));
    }
  } catch {
    // Ignore storage quota errors
  }

  return usage;
}

/**
 * Builds the Safe Financial Summary with strict data minimization.
 * Converts local transactions and budget into aggregated metrics only.
 */
export function buildSafeFinancialSummary(
  transactions: Expense[],
  budget: BudgetSettings,
  currency: CurrencyCode,
  referenceDateStr?: string
): SafeFinancialSummary {
  const refDate = referenceDateStr ? new Date(referenceDateStr) : new Date();
  const year = refDate.getFullYear();
  const month = refDate.getMonth(); // 0-indexed

  // Month boundary formatting: YYYY-MM
  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;

  // Prior month boundary formatting
  const priorDate = new Date(year, month - 1, 1);
  const priorMonthPrefix = `${priorDate.getFullYear()}-${String(priorDate.getMonth() + 1).padStart(2, '0')}`;

  // Days in current month and days remaining
  const totalDaysInMonth = new Date(year, month + 1, 0).getDate();
  const currentDay = refDate.getDate();
  const daysRemainingInMonth = Math.max(1, totalDaysInMonth - currentDay + 1);

  // Aggregate current month transactions
  let currentMonthSpend = 0;
  const categoryTotals: Record<string, number> = {};

  // Aggregate prior month spend
  let priorMonthSpend = 0;

  for (const tx of transactions) {
    if (tx.date.startsWith(monthPrefix)) {
      currentMonthSpend += tx.amount;
      categoryTotals[tx.category] = (categoryTotals[tx.category] || 0) + tx.amount;
    } else if (tx.date.startsWith(priorMonthPrefix)) {
      priorMonthSpend += tx.amount;
    }
  }

  const monthlyBudget = budget.monthlyBudget > 0 ? budget.monthlyBudget : 0;
  const remainingBudget = Math.max(0, monthlyBudget - currentMonthSpend);
  const budgetUtilizationPct =
    monthlyBudget > 0 ? Math.round((currentMonthSpend * 1000) / monthlyBudget) / 10 : 0;
  const recommendedDailyAllowance = daysRemainingInMonth > 0 ? remainingBudget / daysRemainingInMonth : 0;

  // Determine velocity status
  let spendingVelocityStatus: 'normal' | 'caution' | 'critical' | 'no_budget' = 'normal';
  if (monthlyBudget === 0) {
    spendingVelocityStatus = 'no_budget';
  } else {
    const elapsedDays = Math.max(1, currentDay);
    const expectedSpendPace = (monthlyBudget / totalDaysInMonth) * elapsedDays;
    if (currentMonthSpend > monthlyBudget) {
      spendingVelocityStatus = 'critical';
    } else if (currentMonthSpend > expectedSpendPace * 1.15) {
      spendingVelocityStatus = 'caution';
    } else {
      spendingVelocityStatus = 'normal';
    }
  }

  // Convert top categories into percentage summaries
  const topCategories: SafeCategorySpendSummary[] = Object.entries(categoryTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, amt]) => ({
      category: cat,
      amount: Math.round(amt * 100) / 100,
      percentage: currentMonthSpend > 0 ? Math.round(((amt / currentMonthSpend) * 100 + Number.EPSILON) * 10) / 10 : 0,
    }));

  const priorMonthComparison =
    priorMonthSpend > 0
      ? {
          priorMonthSpend: Math.round(priorMonthSpend * 100) / 100,
          spendChangePct:
            Math.round((((currentMonthSpend - priorMonthSpend) / priorMonthSpend) * 100 + Number.EPSILON) * 10) / 10,
        }
      : undefined;

  return {
    currency,
    monthlyBudget: Math.round(monthlyBudget * 100) / 100,
    currentMonthTotalSpent: Math.round(currentMonthSpend * 100) / 100,
    budgetUtilizationPct,
    remainingMonthlyBudget: Math.round(remainingBudget * 100) / 100,
    recommendedDailyAllowance: Math.round(recommendedDailyAllowance * 100) / 100,
    daysRemainingInMonth,
    spendingVelocityStatus,
    topCategories,
    priorMonthComparison,
  };
}

/**
 * Checks the status of the server-side AI Coach route.
 */
export async function checkCoachBackendStatus(): Promise<CoachBackendStatus> {
  try {
    const res = await fetch('/api/coach/status', {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!res.ok) {
      return {
        available: false,
        requiresConfig: true,
        model: 'gemini-3.8-flash',
        costProtection: {
          maxMonthlyRequests: MAX_MONTHLY_QUOTA,
          maxRequestsPerMinute: MAX_REQUESTS_PER_MINUTE,
          maxMessageLength: 500,
        },
      };
    }

    return (await res.json()) as CoachBackendStatus;
  } catch {
    return {
      available: false,
      requiresConfig: true,
      model: 'gemini-3.8-flash',
      costProtection: {
        maxMonthlyRequests: MAX_MONTHLY_QUOTA,
        maxRequestsPerMinute: MAX_REQUESTS_PER_MINUTE,
        maxMessageLength: 500,
      },
    };
  }
}

/**
 * Sends a chat query to the server-side Gemini AI Spending Coach proxy.
 */
export async function sendCoachChatMessage(
  message: string,
  history: Array<{ role: 'user' | 'model'; text: string }>,
  financialSummary: SafeFinancialSummary
): Promise<CoachChatResponsePayload> {
  // 1. Client-side Cost Protection & Throttle Check
  const localUsage = getCoachLocalUsage();
  if (localUsage.recentTimestamps.length >= MAX_REQUESTS_PER_MINUTE) {
    return {
      success: false,
      error: 'rate_limited',
      message: 'Rate limit reached: Maximum 5 coach queries per minute. Please pause for a moment before asking again.',
    };
  }

  if (localUsage.requestsCount >= MAX_MONTHLY_QUOTA) {
    return {
      success: false,
      error: 'quota_exceeded',
      message: `Monthly AI query quota reached (${MAX_MONTHLY_QUOTA} queries/month). Your quota resets at the start of next month.`,
      usage: {
        monthlyRequestsUsed: localUsage.requestsCount,
        monthlyQuota: MAX_MONTHLY_QUOTA,
      },
    };
  }

  // 2. Prepare payload & headers
  const deviceId = getOrCreateDeviceId();
  const userTier = getCurrentUserPlanTier();
  const token = getStoredEntitlementToken() || '';

  const payload: CoachChatRequestPayload = {
    message,
    history,
    financialSummary,
    deviceId,
    entitlementToken: token || undefined,
  };

  try {
    const response = await fetch('/api/coach/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ExpenseFlow-Entitlement-Tier': userTier,
        'X-Client-Device-ID': deviceId,
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    });

    const data = (await response.json()) as CoachChatResponsePayload;

    if (response.ok && data.success) {
      recordCoachLocalRequest();
    }

    return data;
  } catch (err) {
    return {
      success: false,
      error: 'server_error',
      message: 'Network connection error. Unable to reach ExpenseFlow AI Coach service.',
    };
  }
}
