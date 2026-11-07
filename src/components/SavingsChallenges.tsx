import React, { useState, useEffect, useMemo } from 'react';
import { Expense, CurrencyCode, SavingsChallenge, CATEGORIES } from '../types/expense';
import {
  loadStoredChallenges,
  saveStoredChallenges,
  clearStoredChallenges,
} from '../utils/storage';
import { evaluateChallengeProgress, formatLocalDate } from '../utils/calculations';
import { formatCurrency } from '../utils/formatters';
import {
  Trophy,
  Target,
  Flame,
  CheckCircle2,
  Play,
  Pause,
  RotateCcw,
  Trash2,
  Sparkles,
  ShieldAlert,
  ArrowRight,
  TrendingDown,
  Calendar,
  Info,
} from 'lucide-react';

interface SavingsChallengesProps {
  transactions: Expense[];
  currency: CurrencyCode;
  monthlyBudget: number;
}

export const SavingsChallenges: React.FC<SavingsChallengesProps> = ({
  transactions,
  currency,
  monthlyBudget,
}) => {
  const [challenges, setChallenges] = useState<SavingsChallenge[]>(() => {
    const stored = loadStoredChallenges();
    if (stored.length > 0) return stored;

    // Seed default pre-configured challenges with safe dates and budgets
    const today = new Date();
    const todayStr = formatLocalDate(today);
    const endOfWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7);
    const endOfWeekStr = formatLocalDate(endOfWeek);

    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    const endOfMonthStr = formatLocalDate(endOfMonth);
    const end14Days = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 14);
    const end14DaysStr = formatLocalDate(end14Days);

    const budgetBase = monthlyBudget > 0 ? monthlyBudget : 2500;
    const diningTarget = Math.max(75, Math.round(budgetBase * 0.15));
    const groceryTarget = Math.max(100, Math.round(budgetBase * 0.25));

    const defaults: SavingsChallenge[] = [
      {
        id: 'challenge-no-spend-5',
        title: '5 No-Spend Days',
        description: 'Complete 5 days with zero discretionary spending this month. Essential costs (groceries, utilities) are permitted.',
        type: 'no_spend_days',
        targetValue: 5,
        currentProgress: 0,
        unit: 'days',
        startDate: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`,
        endDate: endOfMonthStr,
        status: 'available',
        badgeIcon: 'flame',
      },
      {
        id: 'challenge-dining-cap',
        title: 'Dining Out Under 15%',
        description: `Keep restaurant & takeout spending below 15% of your monthly budget (${formatCurrency(diningTarget, currency)} cap).`,
        type: 'category_cap',
        category: 'Dining Out',
        targetValue: diningTarget,
        currentProgress: 0,
        unit: currency,
        startDate: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`,
        endDate: endOfMonthStr,
        status: 'available',
        badgeIcon: 'trophy',
      },
      {
        id: 'challenge-grocery-discipline',
        title: 'Weekly Grocery Cap',
        description: `Limit grocery spending to ${formatCurrency(groceryTarget, currency)} over a 7-day period.`,
        type: 'category_cap',
        category: 'Groceries',
        targetValue: groceryTarget,
        currentProgress: 0,
        unit: currency,
        startDate: todayStr,
        endDate: endOfWeekStr,
        status: 'available',
        badgeIcon: 'target',
      },
      {
        id: 'challenge-entertainment-pause',
        title: 'Entertainment Fast',
        description: `Keep entertainment spending under ${formatCurrency(50, currency)} for 14 days.`,
        type: 'category_cap',
        category: 'Entertainment',
        targetValue: 50,
        currentProgress: 0,
        unit: currency,
        startDate: todayStr,
        endDate: end14DaysStr,
        status: 'available',
        badgeIcon: 'sparkles',
      },
    ];

    saveStoredChallenges(defaults);
    return defaults;
  });

  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('all');

  // Evaluate dynamic progress from transactions with strict lifecycle rules
  const evaluatedChallenges = useMemo(() => {
    return challenges.map((ch) => {
      const evalResult = evaluateChallengeProgress(ch, transactions);
      return {
        ...ch,
        calculatedProgress: evalResult.currentProgress,
        isCompleted: evalResult.isCompleted,
        percentProgress: evalResult.percentProgress,
        displayStatus: evalResult.displayStatus,
        statusBadgeText: evalResult.statusBadgeText,
        cushionOrDeficit: evalResult.cushionOrDeficit,
        progressExplanation: evalResult.progressExplanation,
      };
    });
  }, [challenges, transactions]);

  const handleStartChallenge = (id: string) => {
    const today = new Date();
    const todayStr = formatLocalDate(today);
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    const endOfMonthStr = formatLocalDate(endOfMonth);
    const endOfWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7);
    const endOfWeekStr = formatLocalDate(endOfWeek);
    const end14Days = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 14);
    const end14DaysStr = formatLocalDate(end14Days);

    const updated = challenges.map((ch) => {
      if (ch.id === id) {
        let endDate = ch.endDate;
        if (ch.id === 'challenge-grocery-discipline') {
          endDate = endOfWeekStr;
        } else if (ch.id === 'challenge-entertainment-pause') {
          endDate = end14DaysStr;
        } else if (ch.id === 'challenge-no-spend-5' || ch.id === 'challenge-dining-cap') {
          endDate = endOfMonthStr;
        }
        return {
          ...ch,
          status: 'active' as const,
          startDate: todayStr,
          endDate,
          currentProgress: 0,
          completedAt: undefined,
        };
      }
      return ch;
    });
    setChallenges(updated);
    saveStoredChallenges(updated);
  };

  const handlePauseResume = (id: string) => {
    const updated = challenges.map((ch) => {
      if (ch.id === id) {
        return {
          ...ch,
          status: ch.status === 'active' ? ('paused' as const) : ('active' as const),
        };
      }
      return ch;
    });
    setChallenges(updated);
    saveStoredChallenges(updated);
  };

  const handleResetChallenge = (id: string) => {
    const updated = challenges.map((ch) => {
      if (ch.id === id) {
        return {
          ...ch,
          status: 'available' as const,
          currentProgress: 0,
          completedAt: undefined,
        };
      }
      return ch;
    });
    setChallenges(updated);
    saveStoredChallenges(updated);
  };

  const handleClearAllChallenges = () => {
    clearStoredChallenges();
    setChallenges([]);
    setConfirmClearOpen(false);
  };

  const filteredChallenges = evaluatedChallenges.filter((ch) => {
    if (filter === 'active') return ch.status === 'active' && ch.displayStatus !== 'completed';
    if (filter === 'completed') return ch.displayStatus === 'completed' || ch.isCompleted;
    return true;
  });

  const activeCount = evaluatedChallenges.filter(
    (c) => c.status === 'active' && c.displayStatus !== 'completed'
  ).length;
  const completedCount = evaluatedChallenges.filter(
    (c) => c.displayStatus === 'completed' || c.isCompleted
  ).length;

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-gradient-to-r from-teal-900 to-[#142D4E] text-white p-6 rounded-2xl shadow-sm">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-teal-800/80 text-teal-200 border border-teal-700">
            <Trophy className="w-3.5 h-3.5 text-teal-300" />
            <span>Habit & Savings Challenges</span>
          </div>
          <h2 className="text-xl font-bold tracking-tight text-white">
            Build Long-Term Financial Discipline
          </h2>
          <p className="text-xs text-teal-100/80 max-w-xl">
            Gamify your budget with realistic savings goals. Challenge progress is calculated
            automatically from your logged transactions without transmitting your data.
          </p>
        </div>

        {/* Stats summary badge */}
        <div className="flex items-center gap-3 bg-white/10 backdrop-blur-xs rounded-xl p-3 border border-white/15 self-start sm:self-auto">
          <div className="text-center px-2">
            <span className="block text-xl font-extrabold text-white">{activeCount}</span>
            <span className="text-[10px] text-teal-200 font-semibold uppercase tracking-wider">Active</span>
          </div>
          <div className="h-8 w-px bg-white/20" />
          <div className="text-center px-2">
            <span className="block text-xl font-extrabold text-teal-300">{completedCount}</span>
            <span className="text-[10px] text-teal-200 font-semibold uppercase tracking-wider">Won</span>
          </div>
        </div>
      </div>

      {/* Filter Tabs & Isolated Management Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-white border border-[#E2E8F0] rounded-xl shadow-2xs self-start">
          {(
            [
              { id: 'all', label: 'All Challenges' },
              { id: 'active', label: `Active (${activeCount})` },
              { id: 'completed', label: `Completed (${completedCount})` },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setFilter(t.id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer min-h-[32px] ${
                filter === t.id
                  ? 'bg-teal-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setConfirmClearOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100/70 border border-rose-200 rounded-xl transition-colors cursor-pointer self-start sm:self-auto"
          title="Reset or remove challenge data cleanly"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Clear Challenge Data</span>
        </button>
      </div>

      {/* Challenges Grid */}
      {filteredChallenges.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-12 text-center text-slate-400 space-y-2">
          <Target className="w-8 h-8 text-slate-300 mx-auto" />
          <p className="text-sm font-semibold text-slate-700">No challenges in this view</p>
          <p className="text-xs text-slate-500">
            Switch filters or start a new challenge from the list above.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredChallenges.map((ch) => {
            const isCompleted = ch.displayStatus === 'completed' || ch.isCompleted;
            const isExceeded = ch.displayStatus === 'exceeded';
            const isOnTrack = ch.displayStatus === 'on-track';
            const isActive = ch.status === 'active' && !isCompleted && !isExceeded;
            const isPaused = ch.status === 'paused';
            const isExpired = ch.displayStatus === 'expired';

            return (
              <div
                key={ch.id}
                className={`bg-white rounded-2xl border p-5 transition-all shadow-xs flex flex-col justify-between ${
                  isCompleted
                    ? 'border-emerald-300 ring-2 ring-emerald-100 bg-gradient-to-b from-emerald-50/30 to-white'
                    : isExceeded
                    ? 'border-rose-300 ring-2 ring-rose-50 bg-gradient-to-b from-rose-50/20 to-white'
                    : isActive || isOnTrack
                    ? 'border-teal-400 ring-2 ring-teal-50'
                    : 'border-[#E2E8F0]'
                }`}
              >
                <div>
                  {/* Card Top Pill & Badges */}
                  <div className="flex items-center justify-between gap-2 mb-2.5">
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                          isCompleted
                            ? 'bg-emerald-100 text-emerald-700'
                            : isExceeded
                            ? 'bg-rose-100 text-rose-700'
                            : isActive || isOnTrack
                            ? 'bg-teal-100 text-teal-700'
                            : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {ch.badgeIcon === 'flame' && <Flame className="w-4 h-4" />}
                        {ch.badgeIcon === 'trophy' && <Trophy className="w-4 h-4" />}
                        {ch.badgeIcon === 'target' && <Target className="w-4 h-4" />}
                        {ch.badgeIcon === 'sparkles' && <Sparkles className="w-4 h-4" />}
                      </div>
                      <span className="text-xs font-bold text-[#142D4E]">{ch.title}</span>
                    </div>

                    {isCompleted ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        Target Achieved
                      </span>
                    ) : isExceeded ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-300">
                        <ShieldAlert className="w-3 h-3 text-rose-600" />
                        Cap Exceeded
                      </span>
                    ) : isOnTrack ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-teal-100 text-teal-800 border border-teal-300">
                        <span className="w-1.5 h-1.5 rounded-full bg-teal-600 animate-pulse" />
                        On Track
                      </span>
                    ) : isActive ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-teal-100 text-teal-800 border border-teal-300">
                        <span className="w-1.5 h-1.5 rounded-full bg-teal-600 animate-pulse" />
                        In Progress
                      </span>
                    ) : isPaused ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
                        Paused
                      </span>
                    ) : isExpired ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-800 border border-amber-200">
                        Incomplete
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
                        Ready
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-slate-600 leading-relaxed mb-3">
                    {ch.description}
                  </p>

                  {/* Progress Bar & Metric */}
                  <div className="space-y-1.5 mb-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500 font-medium">
                        {ch.type === 'no_spend_days' ? 'Days without discretionary spend' : 'Current spending / Cap'}
                      </span>
                      <span className="font-bold text-[#142D4E] tabular-nums">
                        {ch.type === 'no_spend_days'
                          ? `${ch.calculatedProgress} / ${ch.targetValue} days`
                          : `${formatCurrency(ch.calculatedProgress, currency)} / ${formatCurrency(
                              ch.targetValue,
                              currency
                            )}`}
                      </span>
                    </div>

                    <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          isCompleted
                            ? 'bg-emerald-600'
                            : isExceeded
                            ? 'bg-rose-500'
                            : ch.percentProgress >= 80
                            ? 'bg-amber-500'
                            : 'bg-teal-600'
                        }`}
                        style={{ width: `${Math.min(ch.percentProgress, 100)}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span className="flex items-center gap-1 truncate pr-2">
                        <Calendar className="w-3 h-3 shrink-0" />
                        <span className="truncate">Window: {ch.startDate} – {ch.endDate}</span>
                      </span>
                      <span className="font-semibold text-slate-600 shrink-0">
                        {ch.type === 'category_cap'
                          ? `${ch.percentProgress}% cap used`
                          : `${ch.percentProgress}% target`}
                      </span>
                    </div>

                    {/* Explanatory feedback banner */}
                    <div className="text-[11px] text-slate-600 mt-2 bg-slate-50 rounded-xl p-2.5 border border-slate-100 leading-relaxed">
                      {ch.progressExplanation}
                    </div>

                    {/* Category Classification Transparency for No-Spend Days */}
                    {ch.type === 'no_spend_days' && (
                      <div className="mt-2 text-[11px] text-slate-600 bg-teal-50/40 rounded-xl p-2.5 border border-teal-100/60 leading-relaxed space-y-1">
                        <div className="font-semibold text-teal-900 flex items-center gap-1">
                          <Info className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                          <span>Category Transparency Rules</span>
                        </div>
                        <p>
                          <strong className="text-slate-800">Discretionary (Breaks day):</strong> Dining Out, Entertainment, Shopping, Travel, Personal Care, and Other.
                        </p>
                        <p>
                          <strong className="text-slate-800">Essential (Permitted):</strong> Groceries, Housing, Utilities, Healthcare, Transportation.
                        </p>
                        <p className="text-[10px] text-slate-500 italic">
                          &apos;Other&apos; is classified conservatively as discretionary to prevent unrecorded spending leaks.
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions Toolbar */}
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    {ch.status === 'available' ? (
                      <button
                        type="button"
                        onClick={() => handleStartChallenge(ch.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 active:scale-[0.98] rounded-xl shadow-2xs transition-all cursor-pointer min-h-[34px]"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Start Challenge</span>
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => handlePauseResume(ch.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer min-h-[30px]"
                        >
                          {isActive ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                          <span>{isActive ? 'Pause' : 'Resume'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleResetChallenge(ch.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer min-h-[30px]"
                          title="Reset progress to 0"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Reset</span>
                        </button>
                      </>
                    )}
                  </div>

                  {ch.category && (
                    <span className="text-[11px] font-semibold text-slate-500 bg-slate-50 px-2 py-0.5 rounded-md border border-slate-200 truncate max-w-[120px]">
                      {ch.category}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Confirmation Modal to Clear Challenge Data */}
      {confirmClearOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in"
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-10 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#142D4E]">Clear Challenge Data?</h3>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                This will delete your active challenges, progress records, and earned badges from
                isolated challenge storage.
              </p>
              <div className="mt-2.5 p-3 rounded-xl bg-teal-50 border border-teal-200 text-teal-900 text-xs">
                <strong>Financial Data Safe:</strong> Your logged expenses, monthly budgets, and purchase
                plans will <em>never</em> be modified or deleted.
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmClearOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors min-h-[38px] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleClearAllChallenges}
                className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition-colors shadow-2xs min-h-[38px] cursor-pointer"
              >
                Clear Challenge Data
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
