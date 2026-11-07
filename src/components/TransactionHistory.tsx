import React, { useState, useMemo } from 'react';
import { Expense, ExpenseCategory, CATEGORIES, CurrencyCode } from '../types/expense';
import { formatCurrency, formatDate } from '../utils/formatters';
import { getCurrentYearMonth, getRollingDaysRange } from '../utils/calculations';
import {
  Search,
  Filter,
  ArrowUpDown,
  Pencil,
  Trash2,
  Calendar,
  X,
  FileQuestion,
  Plus,
} from 'lucide-react';

interface TransactionHistoryProps {
  transactions: Expense[];
  currency: CurrencyCode;
  onEditExpense: (expense: Expense) => void;
  onRequestDeleteExpense: (expense: Expense) => void;
  onOpenAddExpense: () => void;
}

type SortOption = 'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc';
type DateRangeOption = 'all' | 'this-month' | 'last-month' | 'last-30' | 'last-90' | 'custom';

export const TransactionHistory: React.FC<TransactionHistoryProps> = ({
  transactions,
  currency,
  onEditExpense,
  onRequestDeleteExpense,
  onOpenAddExpense,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [dateRange, setDateRange] = useState<DateRangeOption>('all');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('date-desc');

  // Filter and Sort Logic
  const filteredAndSortedTransactions = useMemo(() => {
    let result = [...transactions];

    // 1. Search Query Filter (Category, Payment Method, Notes, or legacy description)
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (t) =>
          t.category.toLowerCase().includes(q) ||
          (t.paymentMethod && t.paymentMethod.toLowerCase().includes(q)) ||
          (t.notes && t.notes.toLowerCase().includes(q)) ||
          (t.description && t.description.toLowerCase().includes(q))
      );
    }

    // 2. Category Filter
    if (selectedCategory !== 'all') {
      result = result.filter((t) => t.category === selectedCategory);
    }

    // 3. Date Range Filter
    const today = new Date();
    const currentYM = getCurrentYearMonth();

    if (dateRange === 'this-month') {
      result = result.filter((t) => t.date.startsWith(currentYM));
    } else if (dateRange === 'last-month') {
      const prevDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const prevYM = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
      result = result.filter((t) => t.date.startsWith(prevYM));
    } else if (dateRange === 'last-30') {
      const range30 = getRollingDaysRange(30);
      result = result.filter((t) => t.date >= range30.startDate && t.date <= range30.endDate);
    } else if (dateRange === 'last-90') {
      const range90 = getRollingDaysRange(90);
      result = result.filter((t) => t.date >= range90.startDate && t.date <= range90.endDate);
    } else if (dateRange === 'custom') {
      if (customStartDate) {
        result = result.filter((t) => t.date >= customStartDate);
      }
      if (customEndDate) {
        result = result.filter((t) => t.date <= customEndDate);
      }
    }

    // 4. Sort
    result.sort((a, b) => {
      switch (sortBy) {
        case 'date-asc':
          return a.date.localeCompare(b.date) || (a.createdAt || 0) - (b.createdAt || 0);
        case 'amount-desc':
          return b.amount - a.amount;
        case 'amount-asc':
          return a.amount - b.amount;
        case 'date-desc':
        default:
          return b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0);
      }
    });

    return result;
  }, [
    transactions,
    searchQuery,
    selectedCategory,
    dateRange,
    customStartDate,
    customEndDate,
    sortBy,
  ]);

  const totalFilteredAmount = useMemo(() => {
    return filteredAndSortedTransactions.reduce((acc, t) => acc + (t.amount || 0), 0);
  }, [filteredAndSortedTransactions]);

  const hasActiveFilters =
    Boolean(searchQuery.trim()) ||
    selectedCategory !== 'all' ||
    dateRange !== 'all' ||
    Boolean(customStartDate) ||
    Boolean(customEndDate);

  const handleResetFilters = () => {
    setSearchQuery('');
    setSelectedCategory('all');
    setDateRange('all');
    setCustomStartDate('');
    setCustomEndDate('');
    setSortBy('date-desc');
  };

  return (
    <div className="space-y-5 pb-20 md:pb-8">
      {/* Title & Stats */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#142D4E]">
            Transaction History
          </h1>
          <p className="text-sm text-[#64748B] mt-0.5">
            {transactions.length} total recorded · {filteredAndSortedTransactions.length} shown · Currency: {currency}
          </p>
        </div>
        <button
          onClick={onOpenAddExpense}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-semibold shadow-2xs transition-colors self-start sm:self-auto min-h-[40px] cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Add Expense</span>
        </button>
      </div>

      {/* Filter and Search Controls */}
      <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4 sm:p-5 shadow-xs space-y-4">
        {/* Search Bar */}
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400">
            <Search className="w-4 h-4" />
          </div>
          <input
            type="text"
            placeholder="Search by category, payment method, or notes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-[#E2E8F0] bg-white py-2.5 pl-10 pr-9 text-sm text-[#142D4E] placeholder:text-slate-400 focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600"
              aria-label="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Filter Dropdowns Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Category Dropdown */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
              Category
            </label>
            <div className="relative">
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full appearance-none rounded-xl border border-[#E2E8F0] bg-white py-2 pl-3 pr-8 text-xs font-medium text-[#142D4E] focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 transition-all cursor-pointer min-h-[38px]"
              >
                <option value="all">All Categories</option>
                {CATEGORIES.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2.5 text-slate-400">
                <Filter className="w-3.5 h-3.5" />
              </div>
            </div>
          </div>

          {/* Timeframe Dropdown */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
              Timeframe
            </label>
            <div className="relative">
              <select
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value as DateRangeOption)}
                className="w-full appearance-none rounded-xl border border-[#E2E8F0] bg-white py-2 pl-3 pr-8 text-xs font-medium text-[#142D4E] focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 transition-all cursor-pointer min-h-[38px]"
              >
                <option value="all">All Time</option>
                <option value="this-month">This Month</option>
                <option value="last-month">Last Month</option>
                <option value="last-30">Last 30 Days</option>
                <option value="last-90">Last 90 Days</option>
                <option value="custom">Custom Date Range</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2.5 text-slate-400">
                <Calendar className="w-3.5 h-3.5" />
              </div>
            </div>
          </div>

          {/* Sort By Dropdown */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
              Sort By
            </label>
            <div className="relative">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className="w-full appearance-none rounded-xl border border-[#E2E8F0] bg-white py-2 pl-3 pr-8 text-xs font-medium text-[#142D4E] focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 transition-all cursor-pointer min-h-[38px]"
              >
                <option value="date-desc">Date (Newest First)</option>
                <option value="date-asc">Date (Oldest First)</option>
                <option value="amount-desc">Amount ({currency}) - Highest</option>
                <option value="amount-asc">Amount ({currency}) - Lowest</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2.5 text-slate-400">
                <ArrowUpDown className="w-3.5 h-3.5" />
              </div>
            </div>
          </div>
        </div>

        {/* Custom Date Pickers (if Custom is chosen) */}
        {dateRange === 'custom' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100 animate-in fade-in">
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">
                From Date
              </label>
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="w-full rounded-xl border border-[#E2E8F0] bg-white py-2 px-3 text-xs text-[#142D4E] focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">
                To Date
              </label>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="w-full rounded-xl border border-[#E2E8F0] bg-white py-2 px-3 text-xs text-[#142D4E] focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
              />
            </div>
          </div>
        )}

        {/* Active Filters Summary Strip */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-xs">
          <div className="text-slate-600">
            Filtered Total ({currency}):{' '}
            <span className="font-bold text-[#142D4E] tabular-nums">
              {formatCurrency(totalFilteredAmount, currency)}
            </span>{' '}
            ({filteredAndSortedTransactions.length} transaction
            {filteredAndSortedTransactions.length === 1 ? '' : 's'})
          </div>

          {hasActiveFilters && (
            <button
              onClick={handleResetFilters}
              className="text-xs font-semibold text-teal-600 hover:text-teal-700 underline underline-offset-2 transition-colors cursor-pointer"
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Transactions List */}
      <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-xs overflow-hidden">
        {filteredAndSortedTransactions.length === 0 ? (
          <div className="p-8 sm:p-12 text-center">
            <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
              <FileQuestion className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-[#142D4E]">
              {transactions.length === 0 ? 'No transactions yet' : 'No matching transactions'}
            </h3>
            <p className="text-xs text-[#64748B] mt-1 max-w-sm mx-auto">
              {transactions.length === 0
                ? 'Your transaction history will appear here once you log your first expense.'
                : 'No transactions match your current search and filter settings. Try adjusting your parameters.'}
            </p>

            <div className="mt-4">
              {transactions.length === 0 ? (
                <button
                  onClick={onOpenAddExpense}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add First Expense</span>
                </button>
              ) : (
                <button
                  onClick={handleResetFilters}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                >
                  <span>Reset All Filters</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredAndSortedTransactions.map((tx) => {
              return (
                <div
                  key={tx.id}
                  className="p-4 sm:px-6 hover:bg-slate-50/70 transition-colors flex items-center justify-between gap-3"
                >
                  {/* Transaction Details */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-[#142D4E] truncate">
                        {tx.category}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#64748B] mt-0.5">
                      <span>{formatDate(tx.date)}</span>
                      {tx.paymentMethod && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-semibold text-slate-700">{tx.paymentMethod}</span>
                        </>
                      )}
                      {tx.notes && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="italic truncate max-w-[140px] sm:max-w-xs">{tx.notes}</span>
                        </>
                      )}
                      {!tx.notes && tx.description && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="italic truncate max-w-[140px] sm:max-w-xs">{tx.description}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Amount & Actions */}
                  <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                    <div className="text-right">
                      <div className="text-base font-extrabold text-[#142D4E] tabular-nums">
                        {formatCurrency(tx.amount, currency)}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 ml-1 sm:ml-2">
                      <button
                        onClick={() => onEditExpense(tx)}
                        className="p-2.5 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-xl transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer"
                        title="Edit expense"
                        aria-label={`Edit ${tx.category} expense on ${tx.date} for ${formatCurrency(tx.amount, currency)}`}
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => onRequestDeleteExpense(tx)}
                        className="p-2.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer"
                        title="Delete expense"
                        aria-label={`Delete ${tx.category} expense on ${tx.date} for ${formatCurrency(tx.amount, currency)}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
