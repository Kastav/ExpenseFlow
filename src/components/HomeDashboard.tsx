import React, { useState } from 'react';
import { Expense, BudgetSettings, ActiveTab, ExpenseCategory, CATEGORIES, CurrencyCode } from '../types/expense';
import {
  calculateMonthlyOverview,
  calculateCategoryBreakdown,
  calculateSpendingVelocity,
  getCurrentYearMonth,
  shiftYearMonth,
  formatYearMonthDisplay,
} from '../utils/calculations';
import { formatCurrency, formatRelativeDate } from '../utils/formatters';
import { AddExpenseForm } from './AddExpenseForm';
import {
  History,
  Calculator,
  ArrowRight,
  Target,
  Pencil,
  Tag,
  Receipt,
  Sparkles,
  X,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Calendar,
} from 'lucide-react';

interface HomeDashboardProps {
  transactions: Expense[];
  budget: BudgetSettings;
  currency: CurrencyCode;
  onSaveExpense: (expenseData: {
    amount: number;
    category: ExpenseCategory;
    date: string;
    paymentMethod?: string;
    notes?: string;
  }) => boolean;
  onOpenEditExpense: (expense: Expense) => void;
  onOpenBudgetModal: () => void;
  onSelectTab: (tab: ActiveTab) => void;
}

export const HomeDashboard: React.FC<HomeDashboardProps> = ({
  transactions,
  budget,
  currency,
  onSaveExpense,
  onOpenEditExpense,
  onOpenBudgetModal,
  onSelectTab,
}) => {
  const [showOnboarding, setShowOnboarding] = useState<boolean>(true);
  const currentRealYM = getCurrentYearMonth();
  const [selectedYearMonth, setSelectedYearMonth] = useState<string>(() => currentRealYM);
  const isCurrentMonth = selectedYearMonth === currentRealYM;

  const overview = calculateMonthlyOverview(transactions, budget.monthlyBudget, selectedYearMonth, currency);
  const categories = calculateCategoryBreakdown(transactions, selectedYearMonth);
  const velocityReport = calculateSpendingVelocity(transactions, selectedYearMonth, budget.monthlyBudget);
  const recentTransactions = transactions.slice(0, 5);

  const handleSaveExpenseWithSync = (expenseData: {
    amount: number;
    category: ExpenseCategory;
    date: string;
    paymentMethod?: string;
    notes?: string;
  }): boolean => {
    const success = onSaveExpense(expenseData);
    if (success && expenseData.date) {
      const expenseYM = expenseData.date.slice(0, 7);
      if (expenseYM !== selectedYearMonth) {
        setSelectedYearMonth(expenseYM);
      }
    }
    return success;
  };

  // Determine budget status colors
  let progressColor = 'bg-teal-600';
  let badgeColor = 'text-teal-700 bg-teal-50';
  let statusText = 'On Track';

  if (overview.isOverBudget) {
    progressColor = 'bg-red-600';
    badgeColor = 'text-red-700 bg-red-50';
    statusText = 'Over Budget';
  } else if (overview.percentageUsed >= 80) {
    progressColor = 'bg-amber-600';
    badgeColor = 'text-amber-700 bg-amber-50';
    statusText = 'Near Limit';
  }

  return (
    <div className="space-y-6 pb-20 md:pb-8">
      {/* First-Use Onboarding Guide (Shown when no transactions exist) */}
      {transactions.length === 0 && showOnboarding && (
        <section
          aria-labelledby="onboarding-heading"
          className="bg-linear-to-br from-teal-900 to-[#142D4E] text-white rounded-2xl p-5 sm:p-6 shadow-md relative overflow-hidden animate-in fade-in"
        >
          <div className="flex items-start justify-between gap-4 mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-teal-500/20 text-teal-300 flex items-center justify-center border border-teal-400/30 shrink-0">
                <Sparkles className="w-5 h-5 text-teal-300" />
              </div>
              <div>
                <h2 id="onboarding-heading" className="text-base sm:text-lg font-bold text-white">
                  Welcome to ExpenseFlow
                </h2>
                <p className="text-xs text-teal-100/80 mt-0.5">
                  Three simple steps to establish your financial control in {currency}
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowOnboarding(false)}
              className="text-slate-300 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
              aria-label="Dismiss onboarding guide"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
            <div className="bg-white/10 backdrop-blur-xs rounded-xl p-4 border border-white/15 flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-teal-300 block mb-1">
                  Step 1 · Target Limit
                </span>
                <p className="text-sm font-bold text-white">Set Monthly Budget</p>
                <p className="text-xs text-slate-200 mt-1 leading-relaxed">
                  Your baseline spending ceiling is currently {formatCurrency(budget.monthlyBudget, currency)}.
                </p>
              </div>
              <button
                onClick={onOpenBudgetModal}
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-teal-200 hover:text-white transition-colors cursor-pointer self-start"
              >
                <span>Customize Budget</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="bg-white/10 backdrop-blur-xs rounded-xl p-4 border border-white/15 flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-teal-300 block mb-1">
                  Step 2 · Data Entry
                </span>
                <p className="text-sm font-bold text-white">Log Your First Expense</p>
                <p className="text-xs text-slate-200 mt-1 leading-relaxed">
                  Record daily purchases or recurring bills using the instant form below.
                </p>
              </div>
              <button
                onClick={() => {
                  const input = document.getElementById('inline-expense-amount');
                  if (input) {
                    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    input.focus();
                  }
                }}
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-teal-200 hover:text-white transition-colors cursor-pointer self-start"
              >
                <span>Jump to Add Form</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="bg-white/10 backdrop-blur-xs rounded-xl p-4 border border-white/15 flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-teal-300 block mb-1">
                  Step 3 · Decision Tool
                </span>
                <p className="text-sm font-bold text-white">Test Purchase Affordability</p>
                <p className="text-xs text-slate-200 mt-1 leading-relaxed">
                  Evaluate whether an upcoming item fits before swiping your card.
                </p>
              </div>
              <button
                onClick={() => onSelectTab('plan')}
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-teal-200 hover:text-white transition-colors cursor-pointer self-start"
              >
                <span>Open Planner</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </section>
      )}
      {/* Welcome & Month Banner with Month Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#142D4E]">
            Financial Overview
          </h1>
          <p className="text-sm text-[#64748B] mt-0.5">
            {overview.transactionCount} transaction{overview.transactionCount === 1 ? '' : 's'} in {overview.displayMonth} · Currency: <strong className="font-semibold text-teal-700">{currency}</strong>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Month Selector Controls */}
          <div className="inline-flex items-center bg-white border border-[#E2E8F0] rounded-xl p-1 shadow-2xs">
            <button
              type="button"
              onClick={() => setSelectedYearMonth((prev) => shiftYearMonth(prev, -1))}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition-colors cursor-pointer"
              title="Previous month"
              aria-label="Previous month"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-2.5 text-xs font-bold text-[#142D4E] min-w-[110px] text-center select-none">
              {formatYearMonthDisplay(selectedYearMonth)}
            </span>
            <button
              type="button"
              onClick={() => setSelectedYearMonth((prev) => shiftYearMonth(prev, 1))}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition-colors cursor-pointer"
              title="Next month"
              aria-label="Next month"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {!isCurrentMonth && (
            <button
              type="button"
              onClick={() => setSelectedYearMonth(currentRealYM)}
              className="px-2.5 py-2 text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-xl transition-colors cursor-pointer min-h-[38px]"
            >
              Current Month
            </button>
          )}

          <button
            onClick={onOpenBudgetModal}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-[#E2E8F0] hover:bg-slate-50 rounded-xl transition-colors shadow-2xs min-h-[38px] cursor-pointer"
          >
            <Target className="w-4 h-4 text-teal-600" />
            <span>Edit Monthly Budget</span>
          </button>
        </div>
      </div>

      {/* Main Budget Card */}
      <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 sm:p-6 shadow-xs">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-[#64748B]">
              {isCurrentMonth ? "This Month's Spending" : `${formatYearMonthDisplay(selectedYearMonth)} Spending`} ({currency})
            </span>
            <div className="text-3xl sm:text-4xl font-extrabold text-[#142D4E] tabular-nums tracking-tight mt-1">
              {formatCurrency(overview.totalSpending, currency)}
            </div>
          </div>
          <div className="text-right">
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${badgeColor}`}>
              {statusText}
            </span>
            <p className="text-xs text-slate-500 mt-1 tabular-nums">
              {overview.percentageUsed.toFixed(1)}% of budget
            </p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="space-y-1.5 mb-5">
          <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${progressColor}`}
              style={{ width: `${Math.min(overview.percentageUsed, 100)}%` }}
            />
          </div>
          <div className="flex justify-between items-center text-xs text-[#64748B] tabular-nums pt-1">
            <span>Spent: {formatCurrency(overview.totalSpending, currency)}</span>
            <span>Target: {formatCurrency(overview.monthlyBudget, currency)}</span>
          </div>
        </div>

        {/* Stat Breakdown Grid: Remaining Budget vs Recommended / Day vs Monthly Budget vs Transactions */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 border-t border-slate-100">
          <div className="bg-slate-50/80 rounded-xl p-3 border border-slate-100">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
              Remaining Budget
            </span>
            <p
              className={`text-lg font-bold tabular-nums mt-0.5 ${
                overview.isOverBudget ? 'text-red-600' : 'text-teal-700'
              }`}
            >
              {overview.isOverBudget
                ? `-${formatCurrency(Math.abs(overview.remainingBudget), currency)}`
                : formatCurrency(overview.remainingBudget, currency)}
            </p>
            <span className="text-[10px] text-slate-400 block mt-0.5 truncate">
              {overview.isOverBudget ? 'Over monthly ceiling' : 'Available this month'}
            </span>
          </div>

          <div className="bg-slate-50/80 rounded-xl p-3 border border-slate-100">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
              Recommended / Day
            </span>
            <p className="text-lg font-bold text-[#142D4E] tabular-nums mt-0.5">
              {formatCurrency(velocityReport.recommendedDailyAllowance, currency)}
            </p>
            <span className="text-[10px] text-slate-400 block mt-0.5 truncate">
              {velocityReport.daysRemaining > 0
                ? `${velocityReport.daysRemaining} day${velocityReport.daysRemaining === 1 ? '' : 's'} remaining`
                : 'Month concluded'}
            </span>
          </div>

          <div className="bg-slate-50/80 rounded-xl p-3 border border-slate-100">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
              Monthly Budget
            </span>
            <p className="text-lg font-bold text-[#142D4E] tabular-nums mt-0.5">
              {formatCurrency(overview.monthlyBudget, currency)}
            </p>
            <span className="text-[10px] text-slate-400 block mt-0.5 truncate">Target spending limit</span>
          </div>

          <div className="bg-slate-50/80 rounded-xl p-3 border border-slate-100">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
              Transactions
            </span>
            <p className="text-lg font-bold text-[#142D4E] tabular-nums mt-0.5">
              {overview.transactionCount}
            </p>
            <span className="text-[10px] text-slate-400 block mt-0.5 truncate">
              {overview.transactionCount === 1 ? '1 entry' : `${overview.transactionCount} entries`}
            </span>
          </div>
        </div>
      </div>

      {/* Add Expense Form Displayed Prominently on Home */}
      <AddExpenseForm onSave={handleSaveExpenseWithSync} currency={currency} />

      {/* Quick Navigation Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          onClick={() => onSelectTab('history')}
          className="flex items-center justify-between p-4 bg-white hover:bg-slate-50 border border-[#E2E8F0] rounded-2xl shadow-2xs transition-all active:scale-[0.99] text-left group min-h-[64px] cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
              <History className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-bold text-[#142D4E]">Transaction History</p>
              <p className="text-xs text-[#64748B]">View, filter & manage all recorded entries</p>
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
        </button>

        <button
          onClick={() => onSelectTab('plan')}
          className="flex items-center justify-between p-4 bg-white hover:bg-slate-50 border border-[#E2E8F0] rounded-2xl shadow-2xs transition-all active:scale-[0.99] text-left group min-h-[64px] cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
              <Calculator className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-bold text-[#142D4E]">Purchase Planner</p>
              <p className="text-xs text-[#64748B]">Check affordability before spending</p>
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
        </button>
      </div>

      {/* 2-Column Desktop Grid for Category Breakdown & Recent Transactions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Spending By Category */}
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 sm:p-6 shadow-xs flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-[#142D4E]">Category Spending ({currency})</h2>
            <button
              onClick={() => onSelectTab('insights')}
              className="text-xs font-semibold text-teal-600 hover:text-teal-700 transition-colors cursor-pointer"
            >
              Detailed Insights →
            </button>
          </div>

          {categories.length === 0 ? (
            <div className="my-auto py-8 text-center">
              <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
                <Receipt className="w-6 h-6" />
              </div>
              <p className="text-sm font-semibold text-[#142D4E]">No category data yet</p>
              <p className="text-xs text-[#64748B] mt-1 max-w-xs mx-auto">
                Transactions you log using the form above will appear here with automatic category breakdowns.
              </p>
            </div>
          ) : (
            <div className="space-y-3.5 my-auto">
              {categories.slice(0, 5).map((item) => {
                const catDef = CATEGORIES.find((c) => c.name === item.category);
                const color = catDef?.color || '#0D9488';
                return (
                  <div key={item.category} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-[#142D4E]">{item.category}</span>
                      <div className="text-right tabular-nums">
                        <span className="font-bold text-[#142D4E]">{formatCurrency(item.total, currency)}</span>
                        <span className="text-slate-400 text-[11px] ml-1.5">({item.percentage.toFixed(0)}%)</span>
                      </div>
                    </div>
                    <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.min(item.percentage, 100)}%`,
                          backgroundColor: color,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
              {categories.length > 5 && (
                <p className="text-xs text-slate-500 text-center pt-2">
                  + {categories.length - 5} other categories active
                </p>
              )}
            </div>
          )}
        </div>

        {/* Recent Transactions */}
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 sm:p-6 shadow-xs flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-[#142D4E]">Recent Transactions</h2>
            <button
              onClick={() => onSelectTab('history')}
              className="text-xs font-semibold text-teal-600 hover:text-teal-700 transition-colors cursor-pointer"
            >
              View All ({transactions.length}) →
            </button>
          </div>

          {recentTransactions.length === 0 ? (
            <div className="my-auto py-8 text-center">
              <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
                <Tag className="w-6 h-6" />
              </div>
              <p className="text-sm font-semibold text-[#142D4E]">No transactions recorded</p>
              <p className="text-xs text-[#64748B] mt-1 max-w-xs mx-auto">
                Ready to track your expenses? Use the form above to record your first transaction.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 -mx-2">
              {recentTransactions.map((tx) => {
                const catDef = CATEGORIES.find((c) => c.name === tx.category);

                return (
                  <div
                    key={tx.id}
                    onClick={() => onOpenEditExpense(tx)}
                    className="px-3 py-3 rounded-xl hover:bg-slate-50 transition-colors flex items-center justify-between gap-3 cursor-pointer group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                        style={{
                          backgroundColor: catDef ? `${catDef.color}15` : '#0D948815',
                          color: catDef?.color || '#0D9488',
                        }}
                      >
                        <Tag className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        {/* Display Category prominently as primary title */}
                        <p className="text-sm font-bold text-[#142D4E] truncate">
                          {tx.category}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#64748B] mt-0.5">
                          <span>{formatRelativeDate(tx.date)}</span>
                          {tx.paymentMethod && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-medium text-slate-700">{tx.paymentMethod}</span>
                            </>
                          )}
                          {tx.notes && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="italic truncate max-w-[120px] sm:max-w-[180px]">{tx.notes}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 text-right">
                      <div className="text-sm font-bold text-[#142D4E] tabular-nums">
                        {formatCurrency(tx.amount, currency)}
                      </div>
                      <Pencil className="w-3.5 h-3.5 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
