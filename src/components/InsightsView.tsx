import React, { useState, useMemo } from 'react';
import { Expense, BudgetSettings, CATEGORIES, CurrencyCode } from '../types/expense';
import {
  calculateCategoryBreakdown,
  calculateMonthlyTrends,
  calculateTrendsForDateRange,
  calculateAllTimeMonthlyTrends,
  calculatePaymentMethodBreakdown,
  calculateMonthOverMonthComparison,
  calculateSpendingVelocity,
  getCurrentYearMonth,
  formatYearMonthDisplay,
  getRollingDaysRange,
  get90DayPacingRanges,
  formatLocalDate,
} from '../utils/calculations';
import { formatCurrency, formatDate } from '../utils/formatters';
import {
  PieChart,
  BarChart3,
  Info,
  CreditCard,
  TrendingUp,
  Activity,
  Gauge,
  Trophy,
  ArrowUpRight,
  ArrowDownRight,
  Calendar,
  Layers,
  Clock,
  Sparkles,
  Bot,
  ArrowRight,
} from 'lucide-react';
import { SavingsChallenges } from './SavingsChallenges';
import { PremiumFeatureId } from '../types/premium';

interface InsightsViewProps {
  transactions: Expense[];
  budget: BudgetSettings;
  currency: CurrencyCode;
  onOpenBudgetModal: () => void;
  onOpenUpgrade?: (feature?: PremiumFeatureId) => void;
  onOpenAiCoach?: () => void;
}

type InsightPeriod = 'this-month' | 'last-month' | 'last-90' | 'all-time';
type InsightsSubTab = 'analytics' | 'challenges';

export const InsightsView: React.FC<InsightsViewProps> = ({
  transactions,
  budget,
  currency,
  onOpenBudgetModal,
  onOpenUpgrade,
  onOpenAiCoach,
}) => {
  const [subTab, setSubTab] = useState<InsightsSubTab>('analytics');
  const [period, setPeriod] = useState<InsightPeriod>('this-month');

  const currentYM = useMemo(() => getCurrentYearMonth(), []);
  const prevYM = useMemo(() => {
    const today = new Date();
    const prevDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const prevYear = prevDate.getFullYear();
    const prevMonth = String(prevDate.getMonth() + 1).padStart(2, '0');
    return `${prevYear}-${prevMonth}`;
  }, []);

  const rolling90 = useMemo(() => getRollingDaysRange(90), []);

  // Filter transactions strictly based on selected period
  const filteredTransactions = useMemo(() => {
    if (period === 'this-month') {
      return transactions.filter((t) => t.date && t.date.startsWith(currentYM));
    }

    if (period === 'last-month') {
      return transactions.filter((t) => t.date && t.date.startsWith(prevYM));
    }

    if (period === 'last-90') {
      return transactions.filter(
        (t) => t.date && t.date >= rolling90.startDate && t.date <= rolling90.endDate
      );
    }

    // 'all-time': Every valid transaction in the user's complete history
    return [...transactions].sort((a, b) => b.date.localeCompare(a.date));
  }, [transactions, period, currentYM, prevYM, rolling90]);

  // Calculations on filtered transactions
  const totalSpent = useMemo(() => {
    return filteredTransactions.reduce((acc, t) => acc + (t.amount || 0), 0);
  }, [filteredTransactions]);

  const categories = useMemo(() => {
    return calculateCategoryBreakdown(filteredTransactions);
  }, [filteredTransactions]);

  const paymentMethods = useMemo(() => {
    return calculatePaymentMethodBreakdown(filteredTransactions);
  }, [filteredTransactions]);

  // Check how many distinct months contain data in complete history
  const distinctMonthsWithData = useMemo(() => {
    const set = new Set(transactions.map((t) => t.date.substring(0, 7)));
    return set.size;
  }, [transactions]);

  // Monthly trends dynamically adapted to the selected timeframe
  const monthlyTrends = useMemo(() => {
    if (period === 'last-90') {
      return calculateTrendsForDateRange(transactions, rolling90.startDate, rolling90.endDate);
    }
    if (period === 'all-time') {
      return calculateAllTimeMonthlyTrends(transactions);
    }
    if (period === 'last-month') {
      return calculateMonthlyTrends(transactions, 6, prevYM);
    }
    return calculateMonthlyTrends(transactions, 6, currentYM);
  }, [transactions, period, rolling90, prevYM, currentYM]);

  const averagePerTransaction =
    filteredTransactions.length > 0 ? totalSpent / filteredTransactions.length : 0;

  const highestTransaction = useMemo(() => {
    if (filteredTransactions.length === 0) return null;
    return [...filteredTransactions].sort((a, b) => b.amount - a.amount)[0];
  }, [filteredTransactions]);

  // Find max monthly trend for SVG scale
  const maxTrendTotal = useMemo(() => {
    const max = Math.max(...monthlyTrends.map((m) => m.total), 0);
    return max > 0 ? max : 1000;
  }, [monthlyTrends]);

  const highestAmount = highestTransaction ? highestTransaction.amount : 0;

  // Month-over-Month spending comparison for monthly views
  const momReport = useMemo(() => {
    if (period === 'last-month') {
      return calculateMonthOverMonthComparison(transactions, prevYM);
    }
    return calculateMonthOverMonthComparison(transactions, currentYM);
  }, [transactions, period, prevYM, currentYM]);

  // Daily Spending Velocity and pacing for current month
  const velocityReport = useMemo(() => {
    return calculateSpendingVelocity(transactions, currentYM, budget.monthlyBudget);
  }, [transactions, currentYM, budget.monthlyBudget]);

  const currentMonthTotal = momReport.currentTotal;
  const budgetUtilization = budget.monthlyBudget > 0 ? (currentMonthTotal / budget.monthlyBudget) * 100 : 0;

  // 90-Day Pacing calculation (Recent 45 Days vs Previous 45 Days)
  const pacing90 = useMemo(() => {
    if (period !== 'last-90') return null;
    const ranges = get90DayPacingRanges();

    const recent45Transactions = filteredTransactions.filter(
      (t) => t.date >= ranges.recent45Start && t.date <= ranges.recent45End
    );
    const recent45Spent = recent45Transactions.reduce((acc, t) => acc + (t.amount || 0), 0);

    const prior45Transactions = filteredTransactions.filter(
      (t) => t.date >= ranges.previous45Start && t.date <= ranges.previous45End
    );
    const prior45Spent = prior45Transactions.reduce((acc, t) => acc + (t.amount || 0), 0);

    const delta = recent45Spent - prior45Spent;
    const percentage = prior45Spent > 0 ? Math.round((delta / prior45Spent) * 100) : 0;
    const direction: 'up' | 'down' | 'flat' = delta > 0.01 ? 'up' : delta < -0.01 ? 'down' : 'flat';

    const quarterlyBenchmark = budget.monthlyBudget > 0 ? budget.monthlyBudget * 3 : 0;
    const utilization = quarterlyBenchmark > 0 ? (totalSpent / quarterlyBenchmark) * 100 : 0;
    const dailyAverage = totalSpent / 90;

    return {
      ranges,
      recent45Spent,
      prior45Spent,
      delta,
      percentage,
      direction,
      quarterlyBenchmark,
      utilization,
      dailyAverage,
    };
  }, [period, filteredTransactions, budget.monthlyBudget, totalSpent]);

  // All-time metrics (strictly grounded in verified transaction records)
  const allTimeMetrics = useMemo(() => {
    if (period !== 'all-time') return null;
    const distinctMonths = Math.max(1, distinctMonthsWithData);
    const monthlyAverage = totalSpent / distinctMonths;

    return {
      distinctMonths,
      monthlyAverage,
    };
  }, [period, totalSpent, distinctMonthsWithData]);

  return (
    <div className="space-y-6 pb-20 md:pb-8">
      {/* Top Header & Sub-Tab Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#142D4E]">
            Financial Insights & Habits
          </h1>
          <p className="text-sm text-[#64748B] mt-0.5">
            Real-time analytics, pacing velocity, and habit challenges · Currency:{' '}
            <strong className="font-semibold text-teal-700">{currency}</strong>
          </p>
        </div>

        {/* View Switcher: Analytics vs Challenges */}
        <div className="flex items-center gap-1.5 p-1 bg-white border border-[#E2E8F0] rounded-xl shadow-2xs self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setSubTab('analytics')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer min-h-[34px] ${
              subTab === 'analytics'
                ? 'bg-teal-600 text-white shadow-2xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Spending Analytics</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('challenges')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer min-h-[34px] ${
              subTab === 'challenges'
                ? 'bg-teal-600 text-white shadow-2xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <Trophy className="w-3.5 h-3.5" />
            <span>Savings Challenges</span>
          </button>
        </div>
      </div>

      {/* Render Savings Challenges Tab */}
      {subTab === 'challenges' ? (
        <SavingsChallenges
          transactions={transactions}
          currency={currency}
          monthlyBudget={budget.monthlyBudget}
        />
      ) : (
        <>
          {/* Period Selector Tabs */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Filter Timeframe
            </span>
            <div className="flex items-center gap-1 p-1 bg-white border border-[#E2E8F0] rounded-xl shadow-2xs overflow-x-auto max-w-full">
              {(
                [
                  { id: 'this-month', label: 'This Month' },
                  { id: 'last-month', label: 'Previous Month' },
                  { id: 'last-90', label: 'Last 90 Days' },
                  { id: 'all-time', label: 'All Time' },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  onClick={() => setPeriod(item.id)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap min-h-[32px] cursor-pointer ${
                    period === item.id
                      ? 'bg-teal-600 text-white shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* Dynamic Spotlight Row - Adapts accurately to selected timeframe */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Case A: This Month Spotlight */}
            {period === 'this-month' && (
              <>
                {/* 1. Month-over-Month Comparison Card */}
                <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-xs flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center">
                          <TrendingUp className="w-4 h-4" />
                        </div>
                        <div>
                          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                            Month-over-Month Trend
                          </h3>
                          <p className="text-xs text-slate-400">vs Previous Calendar Month</p>
                        </div>
                      </div>

                      {momReport.hasPreviousMonthData ? (
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${
                            momReport.direction === 'down'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : momReport.direction === 'up'
                              ? 'bg-rose-50 text-rose-700 border border-rose-200'
                              : 'bg-slate-100 text-slate-700 border border-slate-200'
                          }`}
                        >
                          {momReport.direction === 'down' ? (
                            <ArrowDownRight className="w-3.5 h-3.5 text-emerald-600" />
                          ) : momReport.direction === 'up' ? (
                            <ArrowUpRight className="w-3.5 h-3.5 text-rose-600" />
                          ) : null}
                          <span>
                            {momReport.percentageChange > 0
                              ? `+${momReport.percentageChange}%`
                              : `${momReport.percentageChange}%`}
                          </span>
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-400 font-medium">Baseline building</span>
                      )}
                    </div>

                    <div className="mt-2 space-y-1">
                      <div className="text-3xl font-extrabold text-[#142D4E] tabular-nums">
                        {formatCurrency(totalSpent, currency)}
                      </div>
                      <p className="text-xs text-slate-500">
                        {momReport.hasPreviousMonthData ? (
                          <>
                            Previous month like-for-like was{' '}
                            <strong className="text-slate-700">
                              {formatCurrency(momReport.equivalentPreviousTotal ?? momReport.previousTotal, currency)}
                            </strong>{' '}
                            ({momReport.direction === 'down' ? 'saved ' : 'spent an extra '}
                            <span className="font-semibold">
                              {formatCurrency(Math.abs(momReport.difference), currency)}
                            </span>
                            )
                          </>
                        ) : (
                          'Log expenses across consecutive months to unlock deep comparative trends.'
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
                    <span>Active Month: {formatYearMonthDisplay(currentYM)}</span>
                    <span className="font-medium text-slate-600">
                      {momReport.direction === 'down'
                        ? 'Spending is below last month'
                        : momReport.direction === 'up'
                        ? 'Spending is higher than last month'
                        : 'Pacing evenly'}
                    </span>
                  </div>
                </div>

                {/* 2. Daily Spending Velocity & Budget Pacing */}
                <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-xs flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center">
                          <Gauge className="w-4 h-4" />
                        </div>
                        <div>
                          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                            Daily Spending Velocity
                          </h3>
                          <p className="text-xs text-slate-400">
                            {velocityReport.daysRemaining} days remaining in month
                          </p>
                        </div>
                      </div>

                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${
                          velocityReport.budgetStatus === 'on-track'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : velocityReport.budgetStatus === 'caution'
                            ? 'bg-amber-50 text-amber-700 border border-amber-200'
                            : 'bg-rose-50 text-rose-700 border border-rose-200'
                        }`}
                      >
                        {velocityReport.budgetStatus === 'on-track' && 'On Track'}
                        {velocityReport.budgetStatus === 'caution' && 'Pacing Caution'}
                        {velocityReport.budgetStatus === 'exceeded' && 'Budget Exceeded'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mt-3">
                      <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                        <span className="block text-[11px] font-semibold text-slate-500 uppercase">
                          Burn Rate / Day
                        </span>
                        <span className="text-xl font-bold text-[#142D4E] tabular-nums mt-0.5 block">
                          {formatCurrency(velocityReport.averageDailySpend, currency)}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          across {velocityReport.daysElapsed} day{velocityReport.daysElapsed === 1 ? '' : 's'}
                        </span>
                      </div>

                      <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                        <span className="block text-[11px] font-semibold text-slate-500 uppercase">
                          Recommended / Day
                        </span>
                        <span className="text-xl font-bold text-teal-700 tabular-nums mt-0.5 block">
                          {formatCurrency(velocityReport.recommendedDailyAllowance, currency)}
                        </span>
                        <span className="text-[10px] text-slate-400">to stay within budget</span>
                      </div>
                    </div>

                    {/* Progress bar towards budget */}
                    {budget.monthlyBudget > 0 && (
                      <div className="mt-4 space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-500 font-medium">
                            Budget Utilization ({budgetUtilization.toFixed(0)}%)
                          </span>
                          <span className="font-semibold text-slate-700 tabular-nums">
                            {formatCurrency(totalSpent, currency)} / {formatCurrency(budget.monthlyBudget, currency)}
                          </span>
                        </div>
                        <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${
                              budgetUtilization > 100
                                ? 'bg-rose-500'
                                : budgetUtilization > 85
                                ? 'bg-amber-500'
                                : 'bg-teal-600'
                            }`}
                            style={{ width: `${Math.min(budgetUtilization, 100)}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
                    <span>
                      Projected Month-End:{' '}
                      <strong className="text-slate-700 font-bold tabular-nums">
                        {formatCurrency(velocityReport.projectedMonthEndSpend, currency)}
                      </strong>
                    </span>
                    <button
                      type="button"
                      onClick={onOpenBudgetModal}
                      className="font-medium text-teal-600 hover:text-teal-700 cursor-pointer"
                    >
                      Adjust Budget
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* Case B: Previous Month Spotlight */}
            {period === 'last-month' && (
              <>
                <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-xs flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center">
                          <TrendingUp className="w-4 h-4" />
                        </div>
                        <div>
                          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                            Previous Month Spending
                          </h3>
                          <p className="text-xs text-slate-400">{formatYearMonthDisplay(prevYM)} (Completed)</p>
                        </div>
                      </div>

                      {momReport.hasPreviousMonthData && (
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${
                            momReport.direction === 'down'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : momReport.direction === 'up'
                              ? 'bg-rose-50 text-rose-700 border border-rose-200'
                              : 'bg-slate-100 text-slate-700 border border-slate-200'
                          }`}
                        >
                          {momReport.direction === 'down' ? (
                            <ArrowDownRight className="w-3.5 h-3.5 text-emerald-600" />
                          ) : momReport.direction === 'up' ? (
                            <ArrowUpRight className="w-3.5 h-3.5 text-rose-600" />
                          ) : null}
                          <span>
                            {momReport.percentageChange > 0
                              ? `+${momReport.percentageChange}%`
                              : `${momReport.percentageChange}%`}
                          </span>
                        </span>
                      )}
                    </div>

                    <div className="mt-2 space-y-1">
                      <div className="text-3xl font-extrabold text-[#142D4E] tabular-nums">
                        {formatCurrency(totalSpent, currency)}
                      </div>
                      <p className="text-xs text-slate-500">
                        {momReport.hasPreviousMonthData
                          ? `Month prior total was ${formatCurrency(momReport.previousTotal, currency)}.`
                          : 'Full completed calendar month performance.'}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
                    <span>Month Status: Completed</span>
                    <span className="font-medium text-slate-600">
                      {budget.monthlyBudget > 0
                        ? totalSpent <= budget.monthlyBudget
                          ? 'Finished Under Budget'
                          : 'Exceeded Monthly Budget'
                        : 'No Budget Defined'}
                    </span>
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-xs flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center">
                          <Gauge className="w-4 h-4" />
                        </div>
                        <div>
                          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                            Monthly Budget Performance
                          </h3>
                          <p className="text-xs text-slate-400">Full month audit</p>
                        </div>
                      </div>

                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${
                          totalSpent <= budget.monthlyBudget
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-rose-50 text-rose-700 border border-rose-200'
                        }`}
                      >
                        {totalSpent <= budget.monthlyBudget ? 'Budget Met' : 'Over Budget'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mt-3">
                      <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                        <span className="block text-[11px] font-semibold text-slate-500 uppercase">
                          Total Spent
                        </span>
                        <span className="text-xl font-bold text-[#142D4E] tabular-nums mt-0.5 block">
                          {formatCurrency(totalSpent, currency)}
                        </span>
                        <span className="text-[10px] text-slate-400">final total</span>
                      </div>

                      <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                        <span className="block text-[11px] font-semibold text-slate-500 uppercase">
                          Remaining Cushion
                        </span>
                        <span className="text-xl font-bold text-teal-700 tabular-nums mt-0.5 block">
                          {formatCurrency(Math.max(0, budget.monthlyBudget - totalSpent), currency)}
                        </span>
                        <span className="text-[10px] text-slate-400">unspent budget</span>
                      </div>
                    </div>

                    {budget.monthlyBudget > 0 && (
                      <div className="mt-4 space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-500 font-medium">
                            Budget Utilization ({((totalSpent / budget.monthlyBudget) * 100).toFixed(0)}%)
                          </span>
                          <span className="font-semibold text-slate-700 tabular-nums">
                            {formatCurrency(totalSpent, currency)} / {formatCurrency(budget.monthlyBudget, currency)}
                          </span>
                        </div>
                        <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${
                              totalSpent > budget.monthlyBudget ? 'bg-rose-500' : 'bg-teal-600'
                            }`}
                            style={{ width: `${Math.min((totalSpent / budget.monthlyBudget) * 100, 100)}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
                    <span>Period: {formatYearMonthDisplay(prevYM)}</span>
                    <button
                      type="button"
                      onClick={onOpenBudgetModal}
                      className="font-medium text-teal-600 hover:text-teal-700 cursor-pointer"
                    >
                      Adjust Budget
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* Case C: Last 90 Days Spotlight */}
            {period === 'last-90' && pacing90 && (
              <>
                <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-xs flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center">
                          <Clock className="w-4 h-4" />
                        </div>
                        <div>
                          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                            90-Day Spending & Pacing
                          </h3>
                          <p className="text-xs text-slate-400">Rolling 90 calendar days</p>
                        </div>
                      </div>

                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${
                          pacing90.direction === 'down'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : pacing90.direction === 'up'
                            ? 'bg-rose-50 text-rose-700 border border-rose-200'
                            : 'bg-slate-100 text-slate-700 border border-slate-200'
                        }`}
                      >
                        {pacing90.direction === 'down' ? (
                          <ArrowDownRight className="w-3.5 h-3.5 text-emerald-600" />
                        ) : pacing90.direction === 'up' ? (
                          <ArrowUpRight className="w-3.5 h-3.5 text-rose-600" />
                        ) : null}
                        <span>
                          {pacing90.percentage > 0 ? `+${pacing90.percentage}%` : `${pacing90.percentage}%`} vs Previous 45 Days
                        </span>
                      </span>
                    </div>

                    <div className="mt-2 space-y-1">
                      <div className="text-3xl font-extrabold text-[#142D4E] tabular-nums">
                        {formatCurrency(totalSpent, currency)}
                      </div>
                      <p className="text-xs text-slate-500 leading-relaxed">
                        Recent 45 Days:{' '}
                        <strong className="text-slate-700">
                          {formatCurrency(pacing90.recent45Spent, currency)}
                        </strong>{' '}
                        · Previous 45 Days:{' '}
                        <strong className="text-slate-700">
                          {formatCurrency(pacing90.prior45Spent, currency)}
                        </strong>
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
                    <span className="truncate pr-2">
                      Window: {formatDate(rolling90.startDate)} – {formatDate(rolling90.endDate)}
                    </span>
                    <span className="font-medium text-slate-600 shrink-0">
                      {pacing90.direction === 'down'
                        ? 'Spending cooled off'
                        : pacing90.direction === 'up'
                        ? 'Spending accelerated'
                        : 'Pacing evenly'}
                    </span>
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-xs flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center">
                          <Gauge className="w-4 h-4" />
                        </div>
                        <div>
                          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                            90-Day Budget Benchmark
                          </h3>
                          <p className="text-xs text-slate-400">3-month quarterly spending cap</p>
                        </div>
                      </div>

                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${
                          pacing90.quarterlyBenchmark === 0 || totalSpent <= pacing90.quarterlyBenchmark
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-rose-50 text-rose-700 border border-rose-200'
                        }`}
                      >
                        {pacing90.quarterlyBenchmark === 0 || totalSpent <= pacing90.quarterlyBenchmark
                          ? 'On Track'
                          : 'Budget Exceeded'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mt-3">
                      <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                        <span className="block text-[11px] font-semibold text-slate-500 uppercase">
                          Daily Burn Rate
                        </span>
                        <span className="text-xl font-bold text-[#142D4E] tabular-nums mt-0.5 block">
                          {formatCurrency(pacing90.dailyAverage, currency)}
                        </span>
                        <span className="text-[10px] text-slate-400">across 90 days</span>
                      </div>

                      <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                        <span className="block text-[11px] font-semibold text-slate-500 uppercase">
                          Quarterly Cushion
                        </span>
                        <span className="text-xl font-bold text-teal-700 tabular-nums mt-0.5 block">
                          {pacing90.quarterlyBenchmark > 0
                            ? formatCurrency(Math.max(0, pacing90.quarterlyBenchmark - totalSpent), currency)
                            : 'N/A'}
                        </span>
                        <span className="text-[10px] text-slate-400">3x monthly budget</span>
                      </div>
                    </div>

                    {pacing90.quarterlyBenchmark > 0 && (
                      <div className="mt-4 space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-500 font-medium">
                            Quarterly Utilization ({pacing90.utilization.toFixed(0)}%)
                          </span>
                          <span className="font-semibold text-slate-700 tabular-nums">
                            {formatCurrency(totalSpent, currency)} / {formatCurrency(pacing90.quarterlyBenchmark, currency)}
                          </span>
                        </div>
                        <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${
                              pacing90.utilization > 100 ? 'bg-rose-500' : 'bg-teal-600'
                            }`}
                            style={{ width: `${Math.min(pacing90.utilization, 100)}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
                    <span>Benchmark: 3x Monthly Limit</span>
                    <button
                      type="button"
                      onClick={onOpenBudgetModal}
                      className="font-medium text-teal-600 hover:text-teal-700 cursor-pointer"
                    >
                      Adjust Budget
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* Case D: All Time Spotlight */}
            {period === 'all-time' && allTimeMetrics && (
              <>
                <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-xs flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center">
                          <Layers className="w-4 h-4" />
                        </div>
                        <div>
                          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                            All-Time Spending History
                          </h3>
                          <p className="text-xs text-slate-400">Complete transaction ledger</p>
                        </div>
                      </div>

                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-teal-50 text-teal-700 border border-teal-200">
                        {allTimeMetrics.distinctMonths} Active Month{allTimeMetrics.distinctMonths === 1 ? '' : 's'}
                      </span>
                    </div>

                    <div className="mt-2 space-y-1">
                      <div className="text-3xl font-extrabold text-[#142D4E] tabular-nums">
                        {formatCurrency(totalSpent, currency)}
                      </div>
                      <p className="text-xs text-slate-500 leading-relaxed">
                        Cumulative expenses recorded across{' '}
                        <strong className="text-slate-700">{filteredTransactions.length}</strong> transactions.
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
                    <span>History Span: Complete Ledger</span>
                    <span className="font-medium text-slate-600">
                      Average Expense: {formatCurrency(averagePerTransaction, currency)}
                    </span>
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-xs flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center">
                          <TrendingUp className="w-4 h-4" />
                        </div>
                        <div>
                          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                            Historical Spending Cadence
                          </h3>
                          <p className="text-xs text-slate-400">Normalized active month burn rate</p>
                        </div>
                      </div>

                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">
                        {allTimeMetrics.distinctMonths} Active Months
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mt-3">
                      <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                        <span className="block text-[11px] font-semibold text-slate-500 uppercase">
                          Average Spending per Active Month
                        </span>
                        <span className="text-xl font-bold text-[#142D4E] tabular-nums mt-0.5 block">
                          {formatCurrency(allTimeMetrics.monthlyAverage, currency)}
                        </span>
                        <span className="text-[10px] text-slate-400">across {allTimeMetrics.distinctMonths} active month{allTimeMetrics.distinctMonths === 1 ? '' : 's'}</span>
                      </div>

                      <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                        <span className="block text-[11px] font-semibold text-slate-500 uppercase">
                          Average / Expense
                        </span>
                        <span className="text-xl font-bold text-teal-700 tabular-nums mt-0.5 block">
                          {formatCurrency(averagePerTransaction, currency)}
                        </span>
                        <span className="text-[10px] text-slate-400">across {filteredTransactions.length} entries</span>
                      </div>
                    </div>

                    <div className="mt-4 p-2.5 bg-slate-50 rounded-xl border border-slate-100 text-[11px] text-slate-500 flex items-start gap-2 leading-relaxed">
                      <Info className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                      <span>
                        Average spending reflects actual historical burn rate across calendar months with recorded transactions. Past months evaluate verified cash flow without assuming current budget limits applied historically.
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
                    <span>Current Monthly Target: {budget.monthlyBudget > 0 ? formatCurrency(budget.monthlyBudget, currency) : 'None set'}</span>
                    <button
                      type="button"
                      onClick={onOpenBudgetModal}
                      className="font-medium text-teal-600 hover:text-teal-700 cursor-pointer"
                    >
                      Adjust Budget
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Overview Metric Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4 shadow-xs">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                Total Spending ({currency})
              </span>
              <p className="text-2xl font-extrabold text-[#142D4E] tabular-nums mt-1">
                {formatCurrency(totalSpent, currency)}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                {filteredTransactions.length} transaction{filteredTransactions.length === 1 ? '' : 's'}
              </p>
            </div>

            <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4 shadow-xs">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                Average / Expense ({currency})
              </span>
              <p className="text-2xl font-extrabold text-[#142D4E] tabular-nums mt-1">
                {formatCurrency(averagePerTransaction, currency)}
              </p>
              <p className="text-xs text-slate-400 mt-1">Per recorded transaction</p>
            </div>

            <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4 shadow-xs">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                Highest Expense ({currency})
              </span>
              <p className="text-2xl font-extrabold text-[#142D4E] tabular-nums mt-1 truncate">
                {highestTransaction ? formatCurrency(highestAmount, currency) : formatCurrency(0, currency)}
              </p>
              <p className="text-xs text-slate-400 mt-1 truncate">
                {highestTransaction ? `${highestTransaction.category} · ${formatDate(highestTransaction.date)}` : 'None'}
              </p>
            </div>

            <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4 shadow-xs">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                Top Category
              </span>
              <p className="text-2xl font-extrabold text-teal-700 mt-1 truncate">
                {categories.length > 0 ? categories[0].category : 'None'}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                {categories.length > 0 ? `${categories[0].percentage.toFixed(0)}% of total` : 'No data'}
              </p>
            </div>
          </div>

          {/* 2-Column Grid for Category Breakdown & Trend Chart */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Category Breakdown Card */}
            <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 sm:p-6 shadow-xs">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold text-[#142D4E] flex items-center gap-2">
                  <PieChart className="w-4 h-4 text-teal-600" />
                  <span>Category Distribution ({currency})</span>
                </h2>
                <span className="text-xs font-semibold text-slate-500 tabular-nums">
                  {categories.length} categories
                </span>
              </div>

              {categories.length === 0 ? (
                <div className="py-12 text-center text-slate-400">
                  <p className="text-sm font-semibold text-slate-700">No category data for this period</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Log expenses during this timeframe to see your spending distribution.
                  </p>
                </div>
              ) : (
                <div className="space-y-3.5">
                  {categories.map((cat) => {
                    const catDef = CATEGORIES.find((c) => c.name === cat.category);
                    const color = catDef?.color || '#0D9488';
                    return (
                      <div key={cat.category} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-[#142D4E]">{cat.category}</span>
                          <div className="text-right tabular-nums">
                            <span className="font-bold text-[#142D4E]">{formatCurrency(cat.total, currency)}</span>
                            <span className="text-slate-500 text-[11px] ml-1.5 font-medium">
                              ({cat.percentage.toFixed(1)}%)
                            </span>
                          </div>
                        </div>
                        <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-300"
                            style={{
                              width: `${Math.min(cat.percentage, 100)}%`,
                              backgroundColor: color,
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Monthly Spending Trends */}
            <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 sm:p-6 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-bold text-[#142D4E] flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-teal-600" />
                    <span>
                      {period === 'last-90'
                        ? `Monthly Spending in 90-Day Window (${currency})`
                        : period === 'all-time'
                        ? `All-Time Monthly Spending Trends (${currency})`
                        : `6-Month Spending Trends (${currency})`}
                    </span>
                  </h2>
                  <span className="text-xs text-slate-500 font-medium">{currency}</span>
                </div>

                {monthlyTrends.length === 0 || monthlyTrends.every((m) => m.total === 0) ? (
                  <div className="p-5 bg-slate-50 rounded-xl border border-slate-200 text-center my-6">
                    <Info className="w-6 h-6 text-slate-400 mx-auto mb-2" />
                    <p className="text-xs font-semibold text-[#142D4E]">
                      No historical spending recorded
                    </p>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed max-w-sm mx-auto">
                      Log expenses across multiple months to unlock long-term comparative trend visualizations.
                    </p>
                  </div>
                ) : (
                  <div className="my-4">
                    {/* Responsive SVG Bar Chart */}
                    <div className="h-48 flex items-end justify-between gap-2 pt-6 pb-2 px-2 border-b border-slate-200">
                      {monthlyTrends.map((trend) => {
                        const heightPct = maxTrendTotal > 0 ? (trend.total / maxTrendTotal) * 100 : 0;
                        return (
                          <div
                            key={trend.yearMonth}
                            className="flex-1 flex flex-col items-center h-full justify-end group"
                          >
                            {/* Hover Tooltip / Label */}
                            <div className="text-[10px] font-bold text-slate-600 tabular-nums mb-1 opacity-80 group-hover:opacity-100 transition-opacity">
                              {trend.total > 0
                                ? formatCurrency(trend.total, currency, false)
                                : formatCurrency(0, currency, false)}
                            </div>
                            {/* Bar */}
                            <div className="w-full max-w-[42px] bg-slate-100 rounded-t-lg overflow-hidden flex flex-col justify-end h-full">
                              <div
                                className="w-full bg-teal-600 rounded-t-lg transition-all duration-500 group-hover:bg-teal-700"
                                style={{ height: `${Math.max(heightPct, 4)}%` }}
                              />
                            </div>
                            {/* Month Label */}
                            <span className="text-[11px] font-medium text-slate-500 mt-2 truncate w-full text-center">
                              {trend.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-[11px] text-slate-400 text-right mt-2">
                      {period === 'last-90'
                        ? `Monthly totals in 90-day window · Total: ${formatCurrency(totalSpent, currency)}`
                        : period === 'all-time'
                        ? `All recorded monthly totals · Total: ${formatCurrency(totalSpent, currency)}`
                        : `Showing spending recorded per month in ${currency}`}
                    </p>
                  </div>
                )}
              </div>

              {/* Payment Method Breakdown Strip */}
              <div className="mt-4 pt-4 border-t border-slate-100">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2.5 flex items-center gap-1.5">
                  <CreditCard className="w-3.5 h-3.5" />
                  <span>Spending by Payment Method ({currency})</span>
                </h3>
                {paymentMethods.length === 0 ? (
                  <p className="text-xs text-slate-400">No payment method records available for this period.</p>
                ) : (
                  <div className="space-y-2">
                    {paymentMethods.map((pm, idx) => (
                      <div
                        key={pm.method}
                        className="flex items-center justify-between text-xs py-1"
                      >
                        <div className="flex items-center gap-2 truncate pr-2">
                          <span className="text-slate-400 font-mono w-4">{idx + 1}.</span>
                          <span className="font-semibold text-[#142D4E] truncate">
                            {pm.method}
                          </span>
                          <span className="text-slate-400">({pm.count} tx)</span>
                        </div>
                        <div className="text-right tabular-nums shrink-0">
                          <span className="font-bold text-[#142D4E]">
                            {formatCurrency(pm.total, currency)}
                          </span>
                          <span className="text-slate-400 text-[11px] ml-1.5">
                            ({pm.percentage.toFixed(0)}%)
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* AI Personal Spending Coach (Premium Feature Teaser) */}
          <div className="bg-gradient-to-r from-teal-950 via-[#142D4E] to-[#1E3E66] rounded-2xl p-5 sm:p-6 text-white shadow-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border border-teal-800/60">
            <div className="space-y-1.5 max-w-xl">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-400 text-slate-950 uppercase tracking-wider">
                  <Sparkles className="w-3 h-3 fill-current" />
                  Premium Feature
                </span>
                <span className="text-xs text-teal-200 font-semibold">$14.99/mo or $109.99/yr</span>
              </div>
              <h3 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                <Bot className="w-5 h-5 text-amber-400 shrink-0" />
                <span>AI Personal Spending Coach</span>
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Receive personalized guidance on spending velocity, category burn rates, and daily allowances powered by Gemini 3.8 Flash. Strictly gated behind Premium entitlement with data minimization and rate protection.
              </p>
            </div>

            <div className="flex items-center gap-2.5 shrink-0 self-start sm:self-auto">
              <button
                type="button"
                onClick={() => {
                  if (onOpenAiCoach) {
                    onOpenAiCoach();
                  } else {
                    onOpenUpgrade?.('ai_spending_coach');
                  }
                }}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-400 active:bg-teal-600 text-slate-950 font-bold text-xs shadow-sm transition-all cursor-pointer active:scale-[0.98]"
              >
                <Bot className="w-3.5 h-3.5" />
                <span>Open AI Coach</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
