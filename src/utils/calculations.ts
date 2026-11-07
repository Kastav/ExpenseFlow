import {
  Expense,
  ExpenseCategory,
  PlannerInputs,
  PlannerResult,
  CurrencyCode,
  MonthOverMonthReport,
  DailySpendingVelocity,
  SavingsChallenge,
} from '../types/expense';
import { formatCurrency } from './formatters';

export interface MonthlyOverview {
  yearMonth: string; // "YYYY-MM"
  displayMonth: string;
  totalSpending: number;
  monthlyBudget: number;
  remainingBudget: number;
  percentageUsed: number;
  transactionCount: number;
  isOverBudget: boolean;
  currency: CurrencyCode;
  recommendedDailyAllowance: number;
  daysRemaining: number;
}

export interface CategorySummaryItem {
  category: ExpenseCategory;
  total: number;
  percentage: number;
  count: number;
}

/**
 * Discretionary expense categories that break a "No-Spend Day".
 * 'Other' is classified conservatively as discretionary to prevent unrecorded spending leaks.
 */
export const DISCRETIONARY_CATEGORIES = new Set<ExpenseCategory>([
  'Dining Out',
  'Entertainment',
  'Shopping',
  'Travel',
  'Personal Care',
  'Other',
]);

/**
 * Essential expense categories that are permitted during discretionary no-spend challenges.
 */
export const ESSENTIAL_CATEGORIES = new Set<ExpenseCategory>([
  'Housing',
  'Groceries',
  'Transportation',
  'Utilities',
  'Healthcare',
]);

export function isDiscretionaryCategory(category: ExpenseCategory): boolean {
  return DISCRETIONARY_CATEGORIES.has(category);
}

/**
 * Parse a Date or YYYY-MM-DD string into a local midnight Date object safely without UTC offset shift.
 */
export function parseLocalCalendarDate(refDate?: Date | string): Date {
  if (!refDate) {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  if (typeof refDate === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(refDate)) {
      const parts = refDate.slice(0, 10).split('-').map(Number);
      return new Date(parts[0], parts[1] - 1, parts[2]);
    }
    const d = new Date(refDate);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  return new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate());
}

/**
 * Get current Year-Month string (e.g., "2026-10")
 */
export function getCurrentYearMonth(refDate?: Date): string {
  const now = refDate || new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Shift a Year-Month string by delta months (e.g. "2026-10" with delta -1 -> "2026-09")
 */
export function shiftYearMonth(yearMonth: string, deltaMonths: number): string {
  const [yearStr, monthStr] = yearMonth.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const date = new Date(year, month - 1 + deltaMonths, 1);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * Format a Date object to YYYY-MM-DD in local timezone safely.
 */
export function formatLocalDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get exact rolling days range (e.g. 90 days) inclusive of today and the preceding N-1 days.
 * Safe across month, year, leap year, and local timezone boundaries.
 */
export function getRollingDaysRange(
  days: number,
  refDate: Date | string = new Date()
): { startDate: string; endDate: string; totalDays: number } {
  const base = parseLocalCalendarDate(refDate);
  const end = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate() - Math.max(0, days - 1));
  return {
    startDate: formatLocalDate(start),
    endDate: formatLocalDate(end),
    totalDays: days,
  };
}

export interface PacingRanges90 {
  windowStart: string;     // referenceDate - 89 days
  windowEnd: string;       // referenceDate
  previous45Start: string; // referenceDate - 89 days
  previous45End: string;   // referenceDate - 45 days
  recent45Start: string;   // referenceDate - 44 days
  recent45End: string;     // referenceDate
}

/**
 * Computes an exact 45-day / 45-day partition of an inclusive 90-calendar-day window.
 *
 * For a 90-day window defined as [referenceDate - 89 days through referenceDate, inclusive]:
 * - Previous 45 Days: referenceDate - 89 days through referenceDate - 45 days, inclusive (45 calendar days)
 * - Recent 45 Days:   referenceDate - 44 days through referenceDate, inclusive (45 calendar days)
 *
 * Mutually exclusive, collectively exhaustive, and timezone-safe in local calendar time.
 */
export function get90DayPacingRanges(refDate: Date | string = new Date()): PacingRanges90 {
  const base = parseLocalCalendarDate(refDate);

  const windowEnd = formatLocalDate(base);
  const recent45End = windowEnd;

  const recentStartObj = new Date(base.getFullYear(), base.getMonth(), base.getDate() - 44);
  const recent45Start = formatLocalDate(recentStartObj);

  const prevEndObj = new Date(base.getFullYear(), base.getMonth(), base.getDate() - 45);
  const previous45End = formatLocalDate(prevEndObj);

  const windowStartObj = new Date(base.getFullYear(), base.getMonth(), base.getDate() - 89);
  const windowStart = formatLocalDate(windowStartObj);
  const previous45Start = windowStart;

  return {
    windowStart,
    windowEnd,
    previous45Start,
    previous45End,
    recent45Start,
    recent45End,
  };
}

/**
 * Format a Year-Month string into a human display label (e.g. "2026-10" -> "October 2026")
 */
export function formatYearMonthDisplay(yearMonth: string): string {
  const [yearStr, monthStr] = yearMonth.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const dateObj = new Date(year, month - 1, 1);
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(dateObj);
}

/**
 * Calculate Monthly Overview metrics based on saved transactions and budget in the chosen currency.
 * Evaluates all valid expenses whose transaction date falls within targetYearMonth.
 */
export function calculateMonthlyOverview(
  transactions: Expense[],
  monthlyBudget: number,
  targetYearMonth: string = getCurrentYearMonth(),
  currency: CurrencyCode = 'USD',
  referenceDate?: Date | string
): MonthlyOverview {
  const monthTransactions = transactions.filter((t) => t.date.startsWith(targetYearMonth));

  const totalSpending = monthTransactions.reduce((acc, t) => acc + (t.amount || 0), 0);
  const remainingBudget = monthlyBudget - totalSpending;
  const percentageUsed = monthlyBudget > 0 ? (totalSpending / monthlyBudget) * 100 : 0;
  const isOverBudget = remainingBudget < 0;

  const [year, month] = targetYearMonth.split('-').map(Number);
  const dateObj = new Date(year, month - 1, 1);
  const displayMonth = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(dateObj);

  const velocity = calculateSpendingVelocity(transactions, targetYearMonth, monthlyBudget, referenceDate);

  return {
    yearMonth: targetYearMonth,
    displayMonth,
    totalSpending,
    monthlyBudget,
    remainingBudget,
    percentageUsed,
    transactionCount: monthTransactions.length,
    isOverBudget,
    currency,
    recommendedDailyAllowance: velocity.recommendedDailyAllowance,
    daysRemaining: velocity.daysRemaining,
  };
}

/**
 * Calculate Category Breakdown for a given subset or month of transactions.
 */
export function calculateCategoryBreakdown(
  transactions: Expense[],
  targetYearMonth?: string
): CategorySummaryItem[] {
  const filtered = targetYearMonth
    ? transactions.filter((t) => t.date.startsWith(targetYearMonth))
    : transactions;

  const categoryMap = new Map<ExpenseCategory, { total: number; count: number }>();

  let totalSpent = 0;
  filtered.forEach((t) => {
    const amt = t.amount || 0;
    totalSpent += amt;

    const existing = categoryMap.get(t.category) || { total: 0, count: 0 };
    categoryMap.set(t.category, {
      total: existing.total + amt,
      count: existing.count + 1,
    });
  });

  const summaries: CategorySummaryItem[] = [];
  categoryMap.forEach((val, category) => {
    summaries.push({
      category,
      total: val.total,
      count: val.count,
      percentage: totalSpent > 0 ? (val.total / totalSpent) * 100 : 0,
    });
  });

  // Sort highest spending first
  return summaries.sort((a, b) => b.total - a.total);
}

/**
 * Purchase Planner calculation.
 * Formula:
 * Estimated remaining money = Available money - Upcoming bills - Other planned expenses - Proposed purchase amount
 */
export function calculatePurchasePlan(
  inputs: PlannerInputs,
  currency: CurrencyCode = 'USD'
): PlannerResult {
  const available = Math.max(0, isFinite(inputs.availableMoney) ? inputs.availableMoney : 0);
  const bills = Math.max(0, isFinite(inputs.upcomingBills) ? inputs.upcomingBills : 0);
  const other = Math.max(0, isFinite(inputs.otherExpenses) ? inputs.otherExpenses : 0);
  const purchase = Math.max(0, isFinite(inputs.proposedPurchase) ? inputs.proposedPurchase : 0);

  const totalCommitted = bills + other + purchase;
  const estimatedRemaining = available - totalCommitted;
  const isAffordable = estimatedRemaining >= 0;
  const deficit = isAffordable ? 0 : Math.abs(estimatedRemaining);

  let explanation = '';
  if (isAffordable) {
    explanation = `After covering your upcoming bills (${formatCurrency(bills, currency)}) and other planned expenses (${formatCurrency(other, currency)}), proceeding with this proposed purchase of ${formatCurrency(purchase, currency)} leaves you with an estimated ${formatCurrency(estimatedRemaining, currency)} remaining.`;
  } else {
    explanation = `This proposed purchase of ${formatCurrency(purchase, currency)} would exceed your available money by ${formatCurrency(deficit, currency)} after accounting for upcoming bills (${formatCurrency(bills, currency)}) and planned expenses (${formatCurrency(other, currency)}).`;
  }

  return {
    estimatedRemaining,
    totalCommitted,
    isAffordable,
    deficit,
    explanation,
  };
}

/**
 * Monthly trend analysis for the last N months.
 */
export interface MonthTrend {
  yearMonth: string;
  label: string; // e.g. "May", "Jun"
  fullLabel: string; // e.g. "May 2026"
  total: number;
  count: number;
}

export function calculateMonthlyTrends(
  transactions: Expense[],
  monthsCount: number = 6,
  endYearMonth?: string
): MonthTrend[] {
  let endYear: number;
  let endMonth: number;

  if (endYearMonth) {
    const [yStr, mStr] = endYearMonth.split('-');
    endYear = parseInt(yStr, 10);
    endMonth = parseInt(mStr, 10);
  } else {
    const now = new Date();
    endYear = now.getFullYear();
    endMonth = now.getMonth() + 1;
  }

  const trends: MonthTrend[] = [];

  for (let i = monthsCount - 1; i >= 0; i--) {
    const d = new Date(endYear, endMonth - 1 - i, 1);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const ym = `${year}-${month}`;

    const monthTransactions = transactions.filter((t) => t.date.startsWith(ym));
    const total = monthTransactions.reduce((acc, t) => acc + (t.amount || 0), 0);

    const label = new Intl.DateTimeFormat('en-US', { month: 'short' }).format(d);
    const fullLabel = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(d);

    trends.push({
      yearMonth: ym,
      label,
      fullLabel,
      total,
      count: monthTransactions.length,
    });
  }

  return trends;
}

/**
 * Monthly trend analysis for transactions within a specific date range (e.g. rolling 90 days).
 * Ensures sum of trend bars directly reconciles with totalSpent within the range.
 */
export function calculateTrendsForDateRange(
  transactions: Expense[],
  startDate: string,
  endDate: string
): MonthTrend[] {
  const inRange = transactions.filter((t) => t.date >= startDate && t.date <= endDate);
  const startYM = startDate.substring(0, 7);
  const endYM = endDate.substring(0, 7);

  const [startY, startM] = startYM.split('-').map(Number);
  const [endY, endM] = endYM.split('-').map(Number);

  const startObj = new Date(startY, startM - 1, 1);
  const endObj = new Date(endY, endM - 1, 1);

  const trends: MonthTrend[] = [];
  const cur = new Date(startObj);

  while (cur <= endObj) {
    const year = cur.getFullYear();
    const month = String(cur.getMonth() + 1).padStart(2, '0');
    const ym = `${year}-${month}`;

    const monthTransactions = inRange.filter((t) => t.date.startsWith(ym));
    const total = monthTransactions.reduce((acc, t) => acc + (t.amount || 0), 0);

    const label = new Intl.DateTimeFormat('en-US', { month: 'short' }).format(cur);
    const fullLabel = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(cur);

    trends.push({
      yearMonth: ym,
      label,
      fullLabel,
      total,
      count: monthTransactions.length,
    });

    cur.setMonth(cur.getMonth() + 1);
  }

  return trends;
}

/**
 * Monthly trends across all recorded history.
 * Aggregates all transactions by month from earliest to latest.
 */
export function calculateAllTimeMonthlyTrends(transactions: Expense[]): MonthTrend[] {
  if (transactions.length === 0) return [];

  const monthMap = new Map<string, { total: number; count: number }>();
  transactions.forEach((t) => {
    if (t.date && t.date.length >= 7) {
      const ym = t.date.substring(0, 7);
      const existing = monthMap.get(ym) || { total: 0, count: 0 };
      monthMap.set(ym, {
        total: existing.total + (t.amount || 0),
        count: existing.count + 1,
      });
    }
  });

  const sortedYMs = Array.from(monthMap.keys()).sort();
  if (sortedYMs.length === 0) return [];

  const [firstY, firstM] = sortedYMs[0].split('-').map(Number);
  const [lastY, lastM] = sortedYMs[sortedYMs.length - 1].split('-').map(Number);

  const startObj = new Date(firstY, firstM - 1, 1);
  const endObj = new Date(lastY, lastM - 1, 1);

  const trends: MonthTrend[] = [];
  const cur = new Date(startObj);

  while (cur <= endObj) {
    const year = cur.getFullYear();
    const month = String(cur.getMonth() + 1).padStart(2, '0');
    const ym = `${year}-${month}`;
    const data = monthMap.get(ym) || { total: 0, count: 0 };

    const label = new Intl.DateTimeFormat('en-US', { month: 'short' }).format(cur);
    const fullLabel = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(cur);

    trends.push({
      yearMonth: ym,
      label,
      fullLabel,
      total: data.total,
      count: data.count,
    });

    cur.setMonth(cur.getMonth() + 1);
  }

  return trends;
}

/**
 * Payment method breakdown summary.
 */
export interface PaymentMethodSummary {
  method: string;
  total: number;
  count: number;
  percentage: number;
}

export function calculatePaymentMethodBreakdown(
  transactions: Expense[]
): PaymentMethodSummary[] {
  const map = new Map<string, { total: number; count: number }>();
  let grandTotal = 0;

  transactions.forEach((t) => {
    const amt = t.amount || 0;
    grandTotal += amt;

    const key = t.paymentMethod?.trim() || 'Unspecified';
    const existing = map.get(key) || { total: 0, count: 0 };
    map.set(key, {
      total: existing.total + amt,
      count: existing.count + 1,
    });
  });

  const list: PaymentMethodSummary[] = [];
  map.forEach((val, method) => {
    list.push({
      method,
      total: val.total,
      count: val.count,
      percentage: grandTotal > 0 ? (val.total / grandTotal) * 100 : 0,
    });
  });

  return list.sort((a, b) => b.total - a.total);
}

/**
 * Calculates Month-over-Month (MoM) spending comparison between target month and previous month.
 */
export function calculateMonthOverMonthComparison(
  transactions: Expense[],
  targetYearMonth: string = getCurrentYearMonth()
): MonthOverMonthReport {
  const [yearStr, monthStr] = targetYearMonth.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);

  // Calculate previous month string
  const prevDate = new Date(year, month - 2, 1);
  const prevYear = prevDate.getFullYear();
  const prevMonth = String(prevDate.getMonth() + 1).padStart(2, '0');
  const prevYearMonth = `${prevYear}-${prevMonth}`;

  const currentMonthTransactions = transactions.filter((t) => t.date.startsWith(targetYearMonth));
  const prevMonthTransactions = transactions.filter((t) => t.date.startsWith(prevYearMonth));

  const currentTotal = currentMonthTransactions.reduce((acc, t) => acc + (t.amount || 0), 0);
  const previousTotal = prevMonthTransactions.reduce((acc, t) => acc + (t.amount || 0), 0);

  // Determine if target month is currently in progress (incomplete month)
  const isCurrentOngoingMonth = targetYearMonth === getCurrentYearMonth();
  const daysInCurrentMonth = new Date(year, month, 0).getDate();
  const currentDay = isCurrentOngoingMonth ? Math.min(new Date().getDate(), daysInCurrentMonth) : daysInCurrentMonth;

  // Filter previous month transactions to equivalent elapsed date range (e.g. days 1 through currentDay)
  const prevMonthEquivalentTransactions = prevMonthTransactions.filter((t) => {
    const day = parseInt(t.date.split('-')[2], 10);
    return isFinite(day) && day <= currentDay;
  });
  const equivalentPreviousTotal = prevMonthEquivalentTransactions.reduce((acc, t) => acc + (t.amount || 0), 0);

  // For in-progress current month, compare like-for-like through today's day of month
  const baselinePrev = isCurrentOngoingMonth ? equivalentPreviousTotal : previousTotal;
  const difference = currentTotal - baselinePrev;
  const hasPreviousMonthData = prevMonthTransactions.length > 0;

  let percentageChange = 0;
  if (baselinePrev > 0) {
    percentageChange = ((currentTotal - baselinePrev) / baselinePrev) * 100;
  } else if (currentTotal > 0) {
    percentageChange = 100;
  }

  let direction: 'up' | 'down' | 'flat' = 'flat';
  if (difference > 0.001) direction = 'up';
  else if (difference < -0.001) direction = 'down';

  return {
    currentTotal,
    previousTotal,
    equivalentPreviousTotal,
    difference,
    percentageChange: Math.round(percentageChange * 10) / 10,
    direction,
    hasPreviousMonthData,
    isEquivalentDateRange: isCurrentOngoingMonth,
    daysCompared: currentDay,
  };
}

/**
 * Calculates daily spending velocity, projected month-end spend, and recommended daily allowance.
 * Gracefully handles zero budgets, future dates, and month boundaries.
 *
 * DEFINITION OF REMAINING DAYS:
 * For the active month, planning allowance extends from the reference day (today) through the final day of the month:
 * daysRemaining = totalDaysInMonth - currentDay + 1.
 * - Day 1: 31 days remaining (full month allowance: budget / 31)
 * - Day 22: 10 days remaining (days 22..31 inclusive) -> remainingBudget / 10
 * - Day 31: 1 day remaining -> remainingBudget / 1
 * - Past months: 0 days remaining -> allowance = 0
 * - Exceeded or 0 budget: allowance = 0
 */
export function calculateSpendingVelocity(
  transactions: Expense[],
  targetYearMonth: string = getCurrentYearMonth(),
  monthlyBudget: number = 0,
  referenceDate?: Date | string
): DailySpendingVelocity {
  const [yearStr, monthStr] = targetYearMonth.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);

  // Total days in target month (leap-year safe)
  const totalDaysInMonth = new Date(year, month, 0).getDate();

  const refDateObj = referenceDate ? new Date(referenceDate) : new Date();
  const currentRealYM = getCurrentYearMonth(refDateObj);

  let daysElapsed = totalDaysInMonth;
  let daysRemaining = 0;

  if (targetYearMonth === currentRealYM) {
    const currentDay = Math.max(1, Math.min(refDateObj.getDate(), totalDaysInMonth));
    daysElapsed = currentDay;
    // Current day is included in the daily spending allowance to cover today through month end
    daysRemaining = Math.max(1, totalDaysInMonth - currentDay + 1);
  } else if (targetYearMonth > currentRealYM) {
    // Future month: not yet started
    daysElapsed = 0;
    daysRemaining = totalDaysInMonth;
  } else {
    // Past completed month: all days elapsed, 0 remaining
    daysElapsed = totalDaysInMonth;
    daysRemaining = 0;
  }

  const monthTransactions = transactions.filter((t) => t.date.startsWith(targetYearMonth));
  const currentSpent = monthTransactions.reduce((acc, t) => acc + (t.amount || 0), 0);

  const averageDailySpend = daysElapsed > 0 ? currentSpent / daysElapsed : 0;
  const projectedMonthEndSpend =
    targetYearMonth === currentRealYM
      ? currentSpent + averageDailySpend * Math.max(0, daysRemaining - 1)
      : targetYearMonth > currentRealYM
      ? 0
      : currentSpent;

  const validBudget = isFinite(monthlyBudget) && monthlyBudget > 0 ? monthlyBudget : 0;
  const remainingBudget = validBudget > 0 ? validBudget - currentSpent : 0;

  let recommendedDailyAllowance = 0;
  if (validBudget > 0 && remainingBudget > 0 && daysRemaining > 0) {
    recommendedDailyAllowance = remainingBudget / daysRemaining;
  }

  let budgetStatus: 'on-track' | 'caution' | 'exceeded' = 'on-track';
  if (validBudget > 0) {
    if (currentSpent > validBudget) {
      budgetStatus = 'exceeded';
    } else if (projectedMonthEndSpend > validBudget) {
      budgetStatus = 'caution';
    }
  }

  return {
    daysElapsed,
    totalDaysInMonth,
    daysRemaining,
    averageDailySpend: Math.round(averageDailySpend * 100) / 100,
    projectedMonthEndSpend: Math.round(projectedMonthEndSpend * 100) / 100,
    recommendedDailyAllowance: Math.round(recommendedDailyAllowance * 100) / 100,
    budgetStatus,
  };
}

export type ChallengeDisplayStatus =
  | 'ready'
  | 'active'
  | 'on-track'
  | 'completed'
  | 'exceeded'
  | 'expired'
  | 'paused';

export interface EvaluatedChallengeResult {
  currentProgress: number;
  isCompleted: boolean;
  percentProgress: number;
  displayStatus: ChallengeDisplayStatus;
  statusBadgeText: string;
  cushionOrDeficit: number;
  progressExplanation: string;
}

/**
 * Dynamically evaluates progress and completion state of a savings challenge against recorded expenses.
 *
 * CRITICAL BUSINESS LOGIC:
 * 1. A challenge must NOT be marked completed ("Target Achieved") simply because spending is zero or low while the evaluation period is still running.
 * 2. For category caps (e.g. Dining Out Under 15%, Weekly Grocery Cap, Entertainment Fast):
 *    - If total spent > cap: status is 'exceeded' ("Cap Exceeded"), progress > 100%, isCompleted is false.
 *    - If total spent <= cap AND duration is ongoing (today < endDate): status is 'on-track' ("On Track"), isCompleted is false.
 *    - If total spent <= cap AND duration has elapsed (today >= endDate): status is 'completed' ("Target Achieved"), isCompleted is true.
 * 3. For No-Spend Days:
 *    - Count qualifying elapsed days with zero discretionary spending.
 *    - Essential categories (Housing, Utilities, Healthcare, Groceries, Transportation) or days with zero spending qualify.
 *    - Future dates are strictly excluded.
 *    - If qualifying days >= targetValue: status is 'completed' ("Target Achieved"), isCompleted is true.
 *    - If qualifying days < targetValue AND ongoing: status is 'active' ("In Progress"), isCompleted is false.
 *    - If qualifying days < targetValue AND ended: status is 'expired' ("Incomplete"), isCompleted is false.
 * 4. Available/unstarted challenges remain 'ready' ("Ready"), never 'completed'.
 * 5. Paused challenges remain 'paused' ("Paused").
 */
export function evaluateChallengeProgress(
  challenge: SavingsChallenge,
  transactions: Expense[],
  referenceDate?: Date | string
): EvaluatedChallengeResult {
  const todayStr = referenceDate
    ? typeof referenceDate === 'string'
      ? referenceDate
      : formatLocalDate(referenceDate)
    : formatLocalDate(new Date());

  // 1. Available / unstarted challenge
  if (challenge.status === 'available') {
    return {
      currentProgress: 0,
      isCompleted: false,
      percentProgress: 0,
      displayStatus: 'ready',
      statusBadgeText: 'Ready',
      cushionOrDeficit: challenge.targetValue,
      progressExplanation: 'Ready to start. Tap "Start Challenge" to begin tracking.',
    };
  }

  // 2. Paused challenge
  if (challenge.status === 'paused') {
    return {
      currentProgress: challenge.currentProgress || 0,
      isCompleted: false,
      percentProgress: 0,
      displayStatus: 'paused',
      statusBadgeText: 'Paused',
      cushionOrDeficit: 0,
      progressExplanation: 'Challenge is currently paused. Resume to continue tracking.',
    };
  }

  // 3. Explicitly completed challenge
  if (challenge.status === 'completed') {
    return {
      currentProgress: challenge.targetValue,
      isCompleted: true,
      percentProgress: 100,
      displayStatus: 'completed',
      statusBadgeText: 'Target Achieved',
      cushionOrDeficit: 0,
      progressExplanation: 'Target achieved! Challenge successfully completed.',
    };
  }

  // 4. Active challenge evaluation
  const isDurationFinished = todayStr >= challenge.endDate;

  // Filter expenses strictly within challenge window
  const inRange = transactions.filter(
    (t) => t.date >= challenge.startDate && t.date <= challenge.endDate
  );

  if (challenge.type === 'no_spend_days') {
    // Evaluate elapsed dates from challenge.startDate to min(challenge.endDate, todayStr)
    const effectiveEndStr = challenge.endDate < todayStr ? challenge.endDate : todayStr;
    const [sY, sM, sD] = challenge.startDate.split('-').map(Number);
    const [eY, eM, eD] = effectiveEndStr.split('-').map(Number);

    const startObj = new Date(sY, sM - 1, sD);
    const endObj = new Date(eY, eM - 1, eD);

    // Group transactions by date
    const discretionaryByDate = new Map<string, number>();
    inRange.forEach((t) => {
      if (DISCRETIONARY_CATEGORIES.has(t.category)) {
        discretionaryByDate.set(t.date, (discretionaryByDate.get(t.date) || 0) + (t.amount || 0));
      }
    });

    let noSpendCount = 0;
    const isDiscretionaryRule =
      challenge.description.toLowerCase().includes('non-essential') ||
      challenge.description.toLowerCase().includes('discretionary');

    const allExpensesByDate = new Set(inRange.map((t) => t.date));

    const cur = new Date(startObj);
    while (cur <= endObj) {
      const curStr = formatLocalDate(cur);
      if (isDiscretionaryRule) {
        const discretionarySpent = discretionaryByDate.get(curStr) || 0;
        if (discretionarySpent === 0) {
          noSpendCount++;
        }
      } else {
        if (!allExpensesByDate.has(curStr)) {
          noSpendCount++;
        }
      }
      cur.setDate(cur.getDate() + 1);
    }

    const target = Math.max(1, challenge.targetValue);
    const isCompleted = noSpendCount >= target;
    const percent = Math.min(100, Math.round((noSpendCount / target) * 100));

    if (isCompleted) {
      return {
        currentProgress: noSpendCount,
        isCompleted: true,
        percentProgress: 100,
        displayStatus: 'completed',
        statusBadgeText: 'Target Achieved',
        cushionOrDeficit: noSpendCount - target,
        progressExplanation: `Target achieved! Completed ${noSpendCount} of ${target} no-spend days.`,
      };
    }

    if (isDurationFinished) {
      return {
        currentProgress: noSpendCount,
        isCompleted: false,
        percentProgress: percent,
        displayStatus: 'expired',
        statusBadgeText: 'Incomplete',
        cushionOrDeficit: target - noSpendCount,
        progressExplanation: `Challenge window ended. Completed ${noSpendCount} of ${target} target days.`,
      };
    }

    return {
      currentProgress: noSpendCount,
      isCompleted: false,
      percentProgress: percent,
      displayStatus: 'active',
      statusBadgeText: 'In Progress',
      cushionOrDeficit: target - noSpendCount,
      progressExplanation: `${noSpendCount} of ${target} days completed. ${target - noSpendCount} more needed by ${challenge.endDate}.`,
    };
  }

  if (challenge.type === 'category_cap') {
    const categoryExpenses = challenge.category
      ? inRange.filter((t) => t.category === challenge.category)
      : inRange;
    const totalSpent = categoryExpenses.reduce((sum, t) => sum + (t.amount || 0), 0);
    const roundedSpent = Math.round(totalSpent * 100) / 100;
    const cap = challenge.targetValue;
    const percentUsed = cap > 0 ? (roundedSpent / cap) * 100 : 0;
    const cushion = Math.round((cap - roundedSpent) * 100) / 100;

    if (roundedSpent > cap) {
      return {
        currentProgress: roundedSpent,
        isCompleted: false,
        percentProgress: Math.min(100, Math.round(percentUsed)),
        displayStatus: 'exceeded',
        statusBadgeText: 'Cap Exceeded',
        cushionOrDeficit: cushion,
        progressExplanation: `Cap exceeded by ${Math.abs(cushion).toFixed(2)} (${roundedSpent.toFixed(2)} spent vs ${cap.toFixed(2)} cap).`,
      };
    }

    // Within cap: Only completed if evaluation window has finished
    if (isDurationFinished) {
      return {
        currentProgress: roundedSpent,
        isCompleted: true,
        percentProgress: 100,
        displayStatus: 'completed',
        statusBadgeText: 'Target Achieved',
        cushionOrDeficit: cushion,
        progressExplanation: `Goal achieved! Kept spending under ${cap.toFixed(2)} cap throughout the full period.`,
      };
    }

    // In-progress: On track, NOT yet achieved!
    return {
      currentProgress: roundedSpent,
      isCompleted: false,
      percentProgress: Math.min(100, Math.round(percentUsed)),
      displayStatus: 'on-track',
      statusBadgeText: 'On Track',
      cushionOrDeficit: cushion,
      progressExplanation: `On track: ${cushion.toFixed(2)} cushion remaining under cap through ${challenge.endDate}.`,
    };
  }

  if (challenge.type === 'daily_budget') {
    const dayTotals = new Map<string, number>();
    inRange.forEach((t) => {
      dayTotals.set(t.date, (dayTotals.get(t.date) || 0) + (t.amount || 0));
    });

    let compliantDays = 0;
    dayTotals.forEach((total) => {
      if (total <= challenge.targetValue) compliantDays++;
    });

    const isCompleted = compliantDays >= 7;
    const percent = Math.min(100, Math.round((compliantDays / 7) * 100));

    return {
      currentProgress: compliantDays,
      isCompleted: isCompleted && isDurationFinished,
      percentProgress: percent,
      displayStatus: isCompleted ? 'completed' : isDurationFinished ? 'expired' : 'active',
      statusBadgeText: isCompleted ? 'Target Achieved' : isDurationFinished ? 'Incomplete' : 'In Progress',
      cushionOrDeficit: compliantDays - 7,
      progressExplanation: `${compliantDays} compliant days recorded.`,
    };
  }

  // Fallback
  const total = inRange.reduce((sum, t) => sum + (t.amount || 0), 0);
  const rounded = Math.round(total * 100) / 100;
  const isCompleted = isDurationFinished && rounded <= challenge.targetValue;
  const percent = challenge.targetValue > 0 ? Math.round((rounded / challenge.targetValue) * 100) : 0;
  return {
    currentProgress: rounded,
    isCompleted,
    percentProgress: Math.min(100, percent),
    displayStatus: isCompleted ? 'completed' : rounded > challenge.targetValue ? 'exceeded' : isDurationFinished ? 'expired' : 'on-track',
    statusBadgeText: isCompleted ? 'Target Achieved' : rounded > challenge.targetValue ? 'Cap Exceeded' : 'On Track',
    cushionOrDeficit: challenge.targetValue - rounded,
    progressExplanation: `${rounded.toFixed(2)} spent against ${challenge.targetValue.toFixed(2)} target.`,
  };
}
