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
  SafeAdvancedAnalyticsContext,
  SafeHistoricalMonthSummary,
  SafeRecurringPatternSummary,
  AiRecommendationsRequestPayload,
  AiRecommendationsResponsePayload,
  AdvancedAiInsightsRequestPayload,
  AdvancedAiInsightsResponsePayload,
} from '../types/coach';
import { getCurrentUserPlanTier, getStoredEntitlementToken } from '../utils/premium';
import { ApiConfigurationError, resolveApiUrl, ResolveApiUrlOptions } from '../utils/apiConfig';

const LOCAL_USAGE_KEY = 'expenseflow_ai_local_usage_v1';
const DEVICE_ID_KEY = 'expenseflow_device_id_v1';

export const MAX_MONTHLY_QUOTA = 100;
export const MAX_REQUESTS_PER_MINUTE = 5;

let coachAuthTokenProvider: (() => Promise<string | null> | string | null) | null = null;

/**
 * Registers the active customer authentication token provider (Firebase ID token)
 * attached as Authorization: Bearer <idToken> on AI Coach requests.
 */
export function setCoachAuthTokenProvider(
  provider: (() => Promise<string | null> | string | null) | null
): void {
  coachAuthTokenProvider = provider;
}

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
export async function checkCoachBackendStatus(
  apiConfigOptions?: ResolveApiUrlOptions
): Promise<CoachBackendStatus> {
  const unavailableResponse: CoachBackendStatus = {
    available: false,
    requiresConfig: true,
    model: 'gemini-4-hydrogen',
    costProtection: {
      maxMonthlyRequests: MAX_MONTHLY_QUOTA,
      maxRequestsPerMinute: MAX_REQUESTS_PER_MINUTE,
      maxMessageLength: 500,
    },
  };

  try {
    const url = resolveApiUrl('/api/coach/status', apiConfigOptions);
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!res.ok) {
      return unavailableResponse;
    }

    return (await res.json()) as CoachBackendStatus;
  } catch {
    return unavailableResponse;
  }
}

export interface SendCoachChatOptions {
  authToken?: string | null;
  apiConfigOptions?: ResolveApiUrlOptions;
}

/**
 * Sends a chat query to the server-side Gemini AI Spending Coach proxy.
 */
export async function sendCoachChatMessage(
  message: string,
  history: Array<{ role: 'user' | 'model'; text: string }>,
  financialSummary: SafeFinancialSummary,
  options?: ResolveApiUrlOptions | SendCoachChatOptions
): Promise<CoachChatResponsePayload> {
  const resolvedOpts: SendCoachChatOptions =
    options && ('apiConfigOptions' in options || 'authToken' in options)
      ? (options as SendCoachChatOptions)
      : { apiConfigOptions: options as ResolveApiUrlOptions | undefined };

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

  // 2. Resolve backend API endpoint (enforces explicit HTTPS VITE_API_BASE_URL on Android)
  let targetUrl: string;
  try {
    targetUrl = resolveApiUrl('/api/coach/chat', resolvedOpts.apiConfigOptions);
  } catch (err) {
    if (err instanceof ApiConfigurationError) {
      return {
        success: false,
        error: 'configuration_required',
        message: err.message,
      };
    }
    throw err;
  }

  // 3. Prepare payload & headers (Firebase ID token in Authorization Bearer, Play entitlement token in body)
  const deviceId = getOrCreateDeviceId();
  const userTier = getCurrentUserPlanTier();
  const entitlementToken = getStoredEntitlementToken() || '';
  const authToken =
    resolvedOpts.authToken !== undefined
      ? resolvedOpts.authToken
      : coachAuthTokenProvider
      ? await coachAuthTokenProvider()
      : null;

  const payload: CoachChatRequestPayload = {
    message,
    history,
    financialSummary,
    deviceId,
    entitlementToken: entitlementToken || undefined,
  };

  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ExpenseFlow-Entitlement-Tier': userTier,
        'X-Client-Device-ID': deviceId,
        ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify(payload),
    });

    let data: CoachChatResponsePayload;
    try {
      data = (await response.json()) as CoachChatResponsePayload;
    } catch {
      return {
        success: false,
        error:
          response.status === 401
            ? 'unauthorized'
            : response.status === 503
            ? 'configuration_required'
            : 'server_error',
        message: `AI Coach service returned an unreadable response (HTTP ${response.status}).`,
      };
    }

    if (response.ok && data.success) {
      recordCoachLocalRequest();
    }

    return data;
  } catch {
    return {
      success: false,
      error: 'server_error',
      message: 'Network connection error. Unable to reach ExpenseFlow AI Coach service.',
    };
  }
}


/**
 * Builds an extended, strictly data-minimized context across up to 6 recent months
 * and category recurring cadence signals (NEVER sends raw IDs, dates, notes, or merchants).
 */
export function buildSafeAdvancedAnalyticsContext(
  transactions: Expense[],
  budget: BudgetSettings,
  currency: CurrencyCode,
  activeChallengeCount: number = 0,
  referenceDateStr?: string
): SafeAdvancedAnalyticsContext {
  const currentMonth = buildSafeFinancialSummary(
    transactions,
    budget,
    currency,
    referenceDateStr
  );

  const refDate = referenceDateStr ? new Date(referenceDateStr) : new Date();
  const currentYm = `${refDate.getFullYear()}-${String(refDate.getMonth() + 1).padStart(2, '0')}`;

  // Group prior months cleanly (up to 6 most recent months excluding currentYm)
  const monthBuckets = new Map<
    string,
    { total: number; count: number; categories: Record<string, number> }
  >();
  // Group recurring candidates by category + 10% rounded amount bucket without preserving raw IDs or notes
  const recurringBuckets = new Map<
    string,
    { category: string; amounts: number[]; months: Set<string>; dates: Set<string> }
  >();

  for (const tx of transactions) {
    if (!tx || typeof tx.date !== 'string' || tx.date.length < 7) continue;
    const ym = tx.date.substring(0, 7);

    if (ym < currentYm) {
      const entry = monthBuckets.get(ym) || { total: 0, count: 0, categories: {} };
      entry.total += tx.amount;
      entry.count += 1;
      entry.categories[tx.category] = (entry.categories[tx.category] || 0) + tx.amount;
      monthBuckets.set(ym, entry);
    }

    const bucketMagnitude = Math.max(1, Math.round(tx.amount / Math.max(5, tx.amount * 0.15)));
    const recKey = `${tx.category}::${bucketMagnitude}`;
    const rec = recurringBuckets.get(recKey) || {
      category: tx.category,
      amounts: [],
      months: new Set<string>(),
      dates: new Set<string>(),
    };
    rec.amounts.push(tx.amount);
    rec.months.add(ym);
    rec.dates.add(tx.date);
    recurringBuckets.set(recKey, rec);
  }

  const historicalMonths: SafeHistoricalMonthSummary[] = Array.from(monthBuckets.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 6)
    .map(([yearMonth, data]) => ({
      yearMonth,
      totalSpent: Math.round(data.total * 100) / 100,
      transactionCount: data.count,
      topCategories: Object.entries(data.categories)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([category, amount]) => ({
          category,
          amount: Math.round(amount * 100) / 100,
        })),
    }));

  const recurringPatterns: SafeRecurringPatternSummary[] = [];
  for (const bucket of recurringBuckets.values()) {
    if (bucket.amounts.length < 2 || bucket.dates.size < 2) continue;
    const avg =
      bucket.amounts.reduce((sum, val) => sum + val, 0) / bucket.amounts.length;
    const monthSpan = Math.max(1, bucket.months.size);
    const freqPerMonth = bucket.amounts.length / monthSpan;
    const cadence: SafeRecurringPatternSummary['cadence'] =
      freqPerMonth >= 3.2
        ? 'weekly'
        : freqPerMonth >= 1.6
        ? 'biweekly'
        : bucket.months.size >= 2
        ? 'monthly'
        : 'irregular';
    recurringPatterns.push({
      category: bucket.category,
      occurrences: bucket.amounts.length,
      averageAmount: Math.round(avg * 100) / 100,
      estimatedMonthlyCost: Math.round(avg * freqPerMonth * 100) / 100,
      cadence,
    });
  }
  recurringPatterns.sort((a, b) => b.estimatedMonthlyCost - a.estimatedMonthlyCost);

  return {
    currentMonth,
    historicalMonths,
    recurringPatterns: recurringPatterns.slice(0, 8),
    activeChallengeCount,
  };
}

async function postCoachAnalyticsEndpoint<TRes extends { success: boolean; error?: string; message?: string }>(
  endpointPath: '/api/coach/recommendations' | '/api/coach/insights',
  analyticsContext: SafeAdvancedAnalyticsContext,
  options?: ResolveApiUrlOptions | SendCoachChatOptions
): Promise<TRes> {
  const resolvedOpts: SendCoachChatOptions =
    options && ('apiConfigOptions' in options || 'authToken' in options)
      ? (options as SendCoachChatOptions)
      : { apiConfigOptions: options as ResolveApiUrlOptions | undefined };

  const localUsage = getCoachLocalUsage();
  if (localUsage.recentTimestamps.length >= MAX_REQUESTS_PER_MINUTE) {
    return {
      success: false,
      error: 'rate_limited',
      message: 'Rate limit reached: Maximum 5 AI requests per minute. Please pause briefly before retrying.',
    } as TRes;
  }
  if (localUsage.requestsCount >= MAX_MONTHLY_QUOTA) {
    return {
      success: false,
      error: 'quota_exceeded',
      message: `Monthly AI query quota reached (${MAX_MONTHLY_QUOTA} queries/month).`,
    } as TRes;
  }

  let targetUrl: string;
  try {
    targetUrl = resolveApiUrl(endpointPath, resolvedOpts.apiConfigOptions);
  } catch (err) {
    if (err instanceof ApiConfigurationError) {
      return {
        success: false,
        error: 'configuration_required',
        message: err.message,
      } as TRes;
    }
    throw err;
  }

  const deviceId = getOrCreateDeviceId();
  const userTier = getCurrentUserPlanTier();
  const entitlementToken = getStoredEntitlementToken() || '';
  const authToken =
    resolvedOpts.authToken !== undefined
      ? resolvedOpts.authToken
      : coachAuthTokenProvider
      ? await coachAuthTokenProvider()
      : null;

  const payload: AiRecommendationsRequestPayload | AdvancedAiInsightsRequestPayload = {
    analyticsContext,
    deviceId,
    entitlementToken: entitlementToken || undefined,
  };

  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ExpenseFlow-Entitlement-Tier': userTier,
        'X-Client-Device-ID': deviceId,
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify(payload),
    });

    let data: TRes;
    try {
      data = (await response.json()) as TRes;
    } catch {
      return {
        success: false,
        error:
          response.status === 401
            ? 'unauthorized'
            : response.status === 503
            ? 'configuration_required'
            : 'server_error',
        message: `ExpenseFlow AI service returned an unreadable response (HTTP ${response.status}).`,
      } as TRes;
    }

    if (response.ok && data.success) {
      recordCoachLocalRequest();
    }
    return data;
  } catch {
    return {
      success: false,
      error: 'server_error',
      message: 'Network connection error. Unable to reach ExpenseFlow AI service.',
    } as TRes;
  }
}

/**
 * Generates AI-driven anomaly alerts and personalized budget optimization recommendations (Premium).
 */
export async function requestAiRecommendations(
  analyticsContext: SafeAdvancedAnalyticsContext,
  options?: ResolveApiUrlOptions | SendCoachChatOptions
): Promise<AiRecommendationsResponsePayload> {
  return postCoachAnalyticsEndpoint<AiRecommendationsResponsePayload>(
    '/api/coach/recommendations',
    analyticsContext,
    options
  );
}

/**
 * Generates Advanced AI Insights: predictive cash-flow forecasts & recurring leak analysis (Premium).
 */
export async function requestAdvancedAiInsights(
  analyticsContext: SafeAdvancedAnalyticsContext,
  options?: ResolveApiUrlOptions | SendCoachChatOptions
): Promise<AdvancedAiInsightsResponsePayload> {
  return postCoachAnalyticsEndpoint<AdvancedAiInsightsResponsePayload>(
    '/api/coach/insights',
    analyticsContext,
    options
  );
}
