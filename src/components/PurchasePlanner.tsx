import React, { useState, useEffect, useRef, useCallback } from 'react';
import { calculatePurchasePlan } from '../utils/calculations';
import { formatCurrency } from '../utils/formatters';
import { CurrencyCode, SUPPORTED_CURRENCIES, PlanData, CATEGORIES, PurchasePriority } from '../types/expense';
import { loadStoredPlan, saveStoredPlan, StorageReadStatus } from '../utils/storage';
import {
  RotateCcw,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  Save,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  PieChart,
  ShieldAlert,
  Zap,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import { trackEvent } from '../services/analytics';
import { PremiumFeatureId } from '../types/premium';

interface PurchasePlannerProps {
  currency?: CurrencyCode;
  initialPlan?: PlanData;
  onSavePlan?: (plan: PlanData) => boolean;
  planReadStatus?: StorageReadStatus;
  planErrorMessage?: string | null;
  monthlyBudget?: number;
  onOpenUpgrade?: (feature?: PremiumFeatureId) => void;
}

export const PurchasePlanner: React.FC<PurchasePlannerProps> = ({
  currency = 'USD',
  initialPlan,
  onSavePlan,
  planReadStatus = 'success',
  planErrorMessage,
  monthlyBudget = 0,
  onOpenUpgrade,
}) => {
  // Load saved plan from props or storage on initial mount
  const [initialData] = useState<PlanData>(() => initialPlan || loadStoredPlan());

  const [availableMoney, setAvailableMoney] = useState<string>(initialData.availableMoney ?? '500');
  const [upcomingBills, setUpcomingBills] = useState<string>(initialData.upcomingBills ?? '250');
  const [otherExpenses, setOtherExpenses] = useState<string>(initialData.otherExpenses ?? '100');
  const [proposedPurchase, setProposedPurchase] = useState<string>(initialData.proposedPurchase ?? '120');
  const [priority, setPriority] = useState<PurchasePriority>('want');
  const [categoryBudgets, setCategoryBudgets] = useState<Record<string, string>>(
    initialData.categoryBudgets || {}
  );

  const [showCategoryBudgets, setShowCategoryBudgets] = useState<boolean>(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const [showResetConfirm, setShowResetConfirm] = useState<boolean>(false);

  const autosaveTimeoutRef = useRef<number | null>(null);
  const latestPlanRef = useRef<PlanData>({
    availableMoney,
    upcomingBills,
    otherExpenses,
    proposedPurchase,
    categoryBudgets,
  });
  const isDirtyRef = useRef<boolean>(isDirty);
  const onSavePlanRef = useRef(onSavePlan);

  // Keep refs synchronized with current render values without triggering re-renders
  useEffect(() => {
    latestPlanRef.current = {
      availableMoney,
      upcomingBills,
      otherExpenses,
      proposedPurchase,
      categoryBudgets,
      lastSaved: Date.now(),
    };
    isDirtyRef.current = isDirty;
    onSavePlanRef.current = onSavePlan;
  }, [availableMoney, upcomingBills, otherExpenses, proposedPurchase, categoryBudgets, isDirty, onSavePlan]);

  // Synchronize form state when initialPlan is updated from parent (e.g. after Retry Loading or cross-tab sync)
  // Only sync if the user has not made unsaved modifications (not dirty) to preserve active user input.
  useEffect(() => {
    if (initialPlan && !isDirtyRef.current) {
      if (initialPlan.availableMoney !== undefined) setAvailableMoney(initialPlan.availableMoney);
      if (initialPlan.upcomingBills !== undefined) setUpcomingBills(initialPlan.upcomingBills);
      if (initialPlan.otherExpenses !== undefined) setOtherExpenses(initialPlan.otherExpenses);
      if (initialPlan.proposedPurchase !== undefined) setProposedPurchase(initialPlan.proposedPurchase);
      if (initialPlan.categoryBudgets) setCategoryBudgets(initialPlan.categoryBudgets);
    }
  }, [initialPlan]);

  const parsedAvailable = parseFloat(availableMoney) || 0;
  const parsedBills = parseFloat(upcomingBills) || 0;
  const parsedOther = parseFloat(otherExpenses) || 0;
  const parsedPurchase = parseFloat(proposedPurchase) || 0;

  const result = calculatePurchasePlan(
    {
      availableMoney: parsedAvailable,
      upcomingBills: parsedBills,
      otherExpenses: parsedOther,
      proposedPurchase: parsedPurchase,
    },
    currency
  );

  // Percentage breakdown of available funds
  const billsPct = parsedAvailable > 0 ? (parsedBills / parsedAvailable) * 100 : 0;
  const otherPct = parsedAvailable > 0 ? (parsedOther / parsedAvailable) * 100 : 0;
  const purchasePct = parsedAvailable > 0 ? (parsedPurchase / parsedAvailable) * 100 : 0;
  const remainingPct =
    parsedAvailable > 0 && result.isAffordable ? (result.estimatedRemaining / parsedAvailable) * 100 : 0;

  const currencySymbol = SUPPORTED_CURRENCIES.find((c) => c.code === currency)?.symbol || '$';

  // Helper to validate and persist plan
  const executeSave = useCallback(
    (isAutoSave: boolean = false): boolean => {
      // Validate inputs: reject negative numbers
      const numAvailable = parseFloat(availableMoney);
      const numBills = parseFloat(upcomingBills);
      const numOther = parseFloat(otherExpenses);
      const numPurchase = parseFloat(proposedPurchase);

      if (
        (availableMoney !== '' && (isNaN(numAvailable) || numAvailable < 0)) ||
        (upcomingBills !== '' && (isNaN(numBills) || numBills < 0)) ||
        (otherExpenses !== '' && (isNaN(numOther) || numOther < 0)) ||
        (proposedPurchase !== '' && (isNaN(numPurchase) || numPurchase < 0))
      ) {
        if (!isAutoSave) {
          setSaveStatus('error');
          setStatusMessage('Please enter valid, non-negative numbers for your plan.');
        }
        return false;
      }

      // Check category budgets for valid numbers
      for (const [catName, val] of Object.entries(categoryBudgets)) {
        if (val !== '') {
          const num = parseFloat(val);
          if (isNaN(num) || num < 0) {
            if (!isAutoSave) {
              setSaveStatus('error');
              setStatusMessage(`Invalid budget for category: ${catName}`);
            }
            return false;
          }
        }
      }

      const planToSave: PlanData = {
        availableMoney,
        upcomingBills,
        otherExpenses,
        proposedPurchase,
        categoryBudgets,
        lastSaved: Date.now(),
      };

      // Block writes if plan storage had a read failure to prevent overwriting unreadable records
      if (planReadStatus === 'error') {
        if (!isAutoSave) {
          setSaveStatus('error');
          setStatusMessage(
            'Cannot save plan: existing plan data in browser storage could not be read safely. Changes are locked to prevent data loss.'
          );
        }
        return false;
      }

      // Delegate persistence to onSavePlan if provided, otherwise call saveStoredPlan directly.
      // Eliminates redundant duplicate storage writes.
      const success = onSavePlan ? onSavePlan(planToSave) : saveStoredPlan(planToSave);
      if (success) {
        setIsDirty(false);
        if (!isAutoSave) {
          setSaveStatus('saved');
          setStatusMessage('Plan saved successfully.');
          trackEvent('planner_used');
        }
        return true;
      } else {
        if (!isAutoSave) {
          setSaveStatus('error');
          setStatusMessage('Failed to save plan to browser storage. Please try again.');
        }
        return false;
      }
    },
    [availableMoney, upcomingBills, otherExpenses, proposedPurchase, categoryBudgets, onSavePlan, planReadStatus]
  );

  // Background autosave on valid changes to prevent accidental loss
  useEffect(() => {
    if (!isDirty || planReadStatus === 'error') return;

    if (autosaveTimeoutRef.current) {
      window.clearTimeout(autosaveTimeoutRef.current);
    }

    autosaveTimeoutRef.current = window.setTimeout(() => {
      executeSave(true);
    }, 1000);

    return () => {
      if (autosaveTimeoutRef.current) {
        window.clearTimeout(autosaveTimeoutRef.current);
      }
    };
  }, [isDirty, executeSave, planReadStatus]);

  // Ensure current state is saved when component unmounts (e.g. tab navigation)
  useEffect(() => {
    return () => {
      if (isDirtyRef.current && planReadStatus !== 'error') {
        if (onSavePlanRef.current) {
          onSavePlanRef.current(latestPlanRef.current);
        } else {
          saveStoredPlan(latestPlanRef.current);
        }
      }
    };
  }, [planReadStatus]);

  // Auto-dismiss confirmation status banner after 3.5 seconds
  useEffect(() => {
    if (saveStatus === 'saved') {
      const timer = setTimeout(() => {
        setSaveStatus('idle');
      }, 3500);
      return () => clearTimeout(timer);
    }
  }, [saveStatus]);

  const handleManualSave = () => {
    executeSave(false);
  };

  const handleFieldChange = (field: 'available' | 'bills' | 'other' | 'purchase', value: string) => {
    setIsDirty(true);
    if (saveStatus !== 'idle') setSaveStatus('idle');

    if (field === 'available') setAvailableMoney(value);
    else if (field === 'bills') setUpcomingBills(value);
    else if (field === 'other') setOtherExpenses(value);
    else if (field === 'purchase') setProposedPurchase(value);
  };

  const handleCategoryBudgetChange = (category: string, value: string) => {
    setIsDirty(true);
    if (saveStatus !== 'idle') setSaveStatus('idle');
    setCategoryBudgets((prev) => ({
      ...prev,
      [category]: value,
    }));
  };

  const handleConfirmReset = () => {
    setAvailableMoney('');
    setUpcomingBills('');
    setOtherExpenses('');
    setProposedPurchase('');
    setCategoryBudgets({});
    setIsDirty(false);
    setShowResetConfirm(false);

    const emptyPlan: PlanData = {
      availableMoney: '',
      upcomingBills: '',
      otherExpenses: '',
      proposedPurchase: '',
      categoryBudgets: {},
      lastSaved: Date.now(),
    };
    const saved = onSavePlan ? onSavePlan(emptyPlan) : saveStoredPlan(emptyPlan);
    if (saved) {
      setSaveStatus('saved');
      setStatusMessage('Plan reset to defaults.');
      setTimeout(() => {
        setSaveStatus('idle');
        setStatusMessage('');
      }, 3000);
    } else {
      setSaveStatus('error');
      setStatusMessage('Failed to reset plan in storage.');
    }
  };

  // Calculate total allocated category budgets
  const totalCategoryBudget = Object.values(categoryBudgets).reduce((sum, val) => {
    const num = parseFloat(val);
    return isFinite(num) && num > 0 ? sum + num : sum;
  }, 0);

  return (
    <div className="space-y-6 pb-20 md:pb-8">
      {/* Storage Read Failure Warning Banner */}
      {planReadStatus === 'error' && (
        <div
          role="alert"
          className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 shadow-xs flex items-start gap-3 animate-in fade-in"
        >
          <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0 mt-0.5">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-amber-950">
              Warning: Stored purchase plan could not be read safely
            </h3>
            <p className="text-xs text-amber-800 mt-0.5 leading-relaxed">
              {planErrorMessage || 'Your previously saved plan data could not be read or parsed from browser storage.'}{' '}
              Saving is locked to prevent overwriting unreadable records until storage access is restored.
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#142D4E]">
            Plan & Budget
          </h1>
          <p className="text-sm text-[#64748B] mt-0.5">
            Plan budgets, recurring bills, and assess purchase affordability · Currency:{' '}
            <strong className="font-semibold text-teal-700">{currency}</strong>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Primary Save Plan Button */}
          <button
            type="button"
            onClick={handleManualSave}
            disabled={planReadStatus === 'error'}
            id="save-plan-btn"
            className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs sm:text-sm font-semibold rounded-xl transition-all shadow-xs min-h-[40px] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
              saveStatus === 'saved'
                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                : 'bg-teal-600 text-white hover:bg-teal-700 active:scale-[0.98]'
            }`}
          >
            {saveStatus === 'saved' ? (
              <>
                <Check className="w-4 h-4 text-white" />
                <span>Plan Saved</span>
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                <span>Save Plan</span>
              </>
            )}
          </button>

          {/* Reset / Clear Fields Button */}
          <button
            type="button"
            onClick={() => setShowResetConfirm(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 bg-white hover:bg-slate-50 rounded-xl transition-colors border border-slate-200 shadow-2xs min-h-[40px] cursor-pointer"
            title="Clear all plan inputs"
          >
            <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
            <span>Clear</span>
          </button>
        </div>
      </div>

      {/* Confirmation & Status Banners */}
      {saveStatus === 'saved' && (
        <div className="flex items-center justify-between p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl text-xs sm:text-sm font-medium shadow-2xs animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{statusMessage || 'Plan saved successfully.'}</span>
          </div>
          <button
            type="button"
            onClick={() => setSaveStatus('idle')}
            className="text-emerald-700 hover:text-emerald-900 p-1"
            aria-label="Dismiss message"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {saveStatus === 'error' && (
        <div className="flex items-center justify-between p-3.5 bg-rose-50 border border-rose-200 text-rose-900 rounded-xl text-xs sm:text-sm font-medium shadow-2xs animate-in fade-in">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{statusMessage || 'Unable to save plan. Please check inputs.'}</span>
          </div>
          <button
            type="button"
            onClick={() => setSaveStatus('idle')}
            className="text-rose-700 hover:text-rose-900 p-1"
            aria-label="Dismiss message"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Input Form (7 cols on desktop) */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-[#E2E8F0] p-5 sm:p-6 shadow-xs space-y-5">
          <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-[#142D4E]">Financial Parameters ({currency})</h2>
              <p className="text-xs text-[#64748B] mt-0.5">
                Enter your total budget, committed obligations, and planned purchases.
              </p>
            </div>
            {isDirty && (
              <span className="text-[11px] font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
                Unsaved edits
              </span>
            )}
          </div>

          <div className="space-y-4">
            {/* 1. Total Budget / Available Funds */}
            <div>
              <label
                htmlFor="planner-available"
                className="block text-xs font-semibold text-[#142D4E] uppercase tracking-wider mb-1"
              >
                1. Total Budget / Available Funds ({currency})
              </label>
              <div className="relative rounded-xl shadow-2xs">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400 font-bold select-none">
                  {currencySymbol}
                </div>
                <input
                  id="planner-available"
                  type="number"
                  step="any"
                  min="0"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={availableMoney}
                  onChange={(e) => handleFieldChange('available', e.target.value)}
                  className="w-full rounded-xl border border-[#E2E8F0] bg-white py-2.5 pl-10 pr-4 text-base font-semibold text-[#142D4E] tabular-nums focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 transition-all"
                />
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                Total monthly budget, cash on hand, or funds allocated for this period
              </p>
            </div>

            {/* 2. Upcoming Bills */}
            <div>
              <label
                htmlFor="planner-bills"
                className="block text-xs font-semibold text-[#142D4E] uppercase tracking-wider mb-1"
              >
                2. Upcoming Bills ({currency})
              </label>
              <div className="relative rounded-xl shadow-2xs">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400 font-bold select-none">
                  {currencySymbol}
                </div>
                <input
                  id="planner-bills"
                  type="number"
                  step="any"
                  min="0"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={upcomingBills}
                  onChange={(e) => handleFieldChange('bills', e.target.value)}
                  className="w-full rounded-xl border border-[#E2E8F0] bg-white py-2.5 pl-10 pr-4 text-base font-semibold text-[#142D4E] tabular-nums focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 transition-all"
                />
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                Fixed costs due soon (e.g., rent, utilities, insurance, subscriptions)
              </p>
            </div>

            {/* 3. Other Planned Expenses */}
            <div>
              <label
                htmlFor="planner-other"
                className="block text-xs font-semibold text-[#142D4E] uppercase tracking-wider mb-1"
              >
                3. Other Planned Expenses ({currency})
              </label>
              <div className="relative rounded-xl shadow-2xs">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400 font-bold select-none">
                  {currencySymbol}
                </div>
                <input
                  id="planner-other"
                  type="number"
                  step="any"
                  min="0"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={otherExpenses}
                  onChange={(e) => handleFieldChange('other', e.target.value)}
                  className="w-full rounded-xl border border-[#E2E8F0] bg-white py-2.5 pl-10 pr-4 text-base font-semibold text-[#142D4E] tabular-nums focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 transition-all"
                />
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                Estimated variable necessities (e.g., groceries, fuel, transit, medications)
              </p>
            </div>

            {/* 4. Proposed Purchase */}
            <div className="pt-2 border-t border-slate-100">
              <label
                htmlFor="planner-purchase"
                className="block text-xs font-bold text-teal-700 uppercase tracking-wider mb-1"
              >
                4. Proposed Purchase Amount ({currency})
              </label>
              <div className="relative rounded-xl shadow-2xs">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-teal-600 font-bold select-none">
                  {currencySymbol}
                </div>
                <input
                  id="planner-purchase"
                  type="number"
                  step="any"
                  min="0"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={proposedPurchase}
                  onChange={(e) => handleFieldChange('purchase', e.target.value)}
                  className="w-full rounded-xl border-2 border-teal-500 bg-white py-2.5 pl-10 pr-4 text-lg font-bold text-[#142D4E] tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-200 transition-all"
                />
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                The price of the item or experience you are considering purchasing
              </p>

              {/* Purchase Urgency & Priority Selector */}
              <div className="mt-3 pt-2">
                <span className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                  Purchase Priority / Intent
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(
                    [
                      { id: 'need', label: 'Need', desc: 'Essential' },
                      { id: 'want', label: 'Want', desc: 'Discretionary' },
                      { id: 'investment', label: 'Investment', desc: 'Growth / Skill' },
                      { id: 'emergency', label: 'Emergency', desc: 'Urgent' },
                    ] as const
                  ).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPriority(p.id)}
                      className={`p-2 rounded-xl text-left border transition-all cursor-pointer ${
                        priority === p.id
                          ? 'border-teal-600 bg-teal-50/70 ring-1 ring-teal-500 text-teal-950 font-bold'
                          : 'border-slate-200 hover:border-slate-300 bg-white text-slate-700'
                      }`}
                    >
                      <span className="block text-xs font-bold leading-tight">{p.label}</span>
                      <span className="block text-[10px] text-slate-500 font-normal leading-tight mt-0.5">
                        {p.desc}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Optional Category-Specific Budgets Section */}
            <div className="pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowCategoryBudgets(!showCategoryBudgets)}
                className="flex items-center justify-between w-full py-2 text-left text-xs font-semibold text-[#142D4E] hover:text-teal-700 transition-colors"
              >
                <div className="flex items-center gap-1.5">
                  <PieChart className="w-4 h-4 text-teal-600" />
                  <span>Category-Specific Budgets (Optional)</span>
                  {totalCategoryBudget > 0 && (
                    <span className="ml-1 text-[11px] font-normal text-slate-500">
                      ({formatCurrency(totalCategoryBudget, currency)} total)
                    </span>
                  )}
                </div>
                {showCategoryBudgets ? (
                  <ChevronUp className="w-4 h-4 text-slate-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                )}
              </button>

              {showCategoryBudgets && (
                <div className="mt-3 p-4 bg-slate-50 rounded-xl border border-slate-200/80 space-y-3">
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Optionally allocate target budgets to individual expense categories. All category targets are saved with your plan.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    {CATEGORIES.map((cat) => (
                      <div key={cat.name}>
                        <label
                          htmlFor={`cat-budget-${cat.name}`}
                          className="block text-[11px] font-semibold text-slate-700 mb-1 truncate"
                        >
                          {cat.name} ({currency})
                        </label>
                        <div className="relative rounded-lg shadow-2xs">
                          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2.5 text-slate-400 font-bold text-xs select-none">
                            {currencySymbol}
                          </div>
                          <input
                            id={`cat-budget-${cat.name}`}
                            type="number"
                            step="any"
                            min="0"
                            inputMode="decimal"
                            placeholder="0"
                            value={categoryBudgets[cat.name] || ''}
                            onChange={(e) => handleCategoryBudgetChange(cat.name, e.target.value)}
                            className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs font-semibold text-[#142D4E] tabular-nums focus:outline-none focus:border-teal-600 focus:ring-1 focus:ring-teal-200"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Form Actions Footer with Save Button */}
          <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <span className="text-xs text-[#64748B]">
              {isDirty ? 'Unsaved edits pending' : 'All plan values saved and persistent in browser storage'}
            </span>
            <button
              type="button"
              onClick={handleManualSave}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 active:scale-[0.98] rounded-xl shadow-xs transition-all cursor-pointer min-h-[42px]"
            >
              <Save className="w-4 h-4" />
              <span>Save Plan</span>
            </button>
          </div>
        </div>

        {/* Right Column: Calculation Result & Breakdown (5 cols on desktop) */}
        <div className="lg:col-span-5 space-y-4">
          {/* Result Card */}
          <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 sm:p-6 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-[#64748B]">
                  Estimated Remaining ({currency})
                </span>
                {result.isAffordable ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-50 text-green-700 border border-green-200">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Affordable
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-50 text-red-700 border border-red-200">
                    <AlertCircle className="w-3.5 h-3.5" />
                    Deficit
                  </span>
                )}
              </div>

              {/* Big Figure */}
              <div
                className={`text-4xl font-extrabold tracking-tight tabular-nums ${
                  result.isAffordable ? 'text-green-700' : 'text-red-600'
                }`}
              >
                {result.isAffordable
                  ? formatCurrency(result.estimatedRemaining, currency)
                  : `-${formatCurrency(result.deficit, currency)}`}
              </div>

              {/* Calculation Formula Display */}
              <div className="mt-4 p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs font-mono tabular-nums text-slate-700 space-y-1">
                <div className="flex justify-between">
                  <span className="font-sans text-slate-500">Available:</span>
                  <span className="font-semibold">{formatCurrency(parsedAvailable, currency)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span className="font-sans text-slate-500">- Upcoming bills:</span>
                  <span>{formatCurrency(parsedBills, currency)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span className="font-sans text-slate-500">- Other planned:</span>
                  <span>{formatCurrency(parsedOther, currency)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span className="font-sans text-slate-500">- Proposed purchase:</span>
                  <span>{formatCurrency(parsedPurchase, currency)}</span>
                </div>
                <div className="flex justify-between pt-1.5 border-t border-slate-200 font-bold text-[#142D4E]">
                  <span className="font-sans">Estimated Remaining:</span>
                  <span className={result.isAffordable ? 'text-green-700' : 'text-red-600'}>
                    {result.isAffordable
                      ? formatCurrency(result.estimatedRemaining, currency)
                      : `-${formatCurrency(result.deficit, currency)}`}
                  </span>
                </div>
              </div>

              {/* Plain English Explanation */}
              <div className="mt-4 p-3.5 bg-teal-50/60 rounded-xl border border-teal-100">
                <p className="text-xs text-teal-900 leading-relaxed font-medium">
                  {result.explanation}
                </p>
              </div>

              {/* Over-budget and Deficit Alert Banners */}
              {!result.isAffordable && (
                <div className="mt-3 p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-900 text-xs flex items-start gap-2.5">
                  <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold block text-rose-950">
                      Deficit Warning: {formatCurrency(result.deficit, currency)} Shortfall
                    </span>
                    <span className="text-rose-800 text-[11px] leading-relaxed block mt-0.5">
                      {priority === 'want'
                        ? 'Because this is a discretionary Want, delaying this purchase by 30 days protects your cash reserves.'
                        : 'Covering this purchase requires reallocating funds from other categories or postponing obligations.'}
                    </span>
                  </div>
                </div>
              )}

              {monthlyBudget > 0 && parsedPurchase > monthlyBudget && (
                <div className="mt-2.5 p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold block text-amber-950">
                      Exceeds Monthly Budget ({formatCurrency(monthlyBudget, currency)})
                    </span>
                    <span className="text-amber-800 text-[11px] leading-relaxed block mt-0.5">
                      This single transaction is larger than your entire monthly budget. Verify whether this can be split or amortized.
                    </span>
                  </div>
                </div>
              )}

              {/* Fund Allocation Proportional Bar */}
              {parsedAvailable > 0 && (
                <div className="mt-4 space-y-2">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                    Fund Allocation Share
                  </span>
                  <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden flex">
                    <div
                      title={`Bills: ${billsPct.toFixed(0)}%`}
                      className="bg-indigo-500 h-full transition-all"
                      style={{ width: `${Math.min(billsPct, 100)}%` }}
                    />
                    <div
                      title={`Other: ${otherPct.toFixed(0)}%`}
                      className="bg-sky-500 h-full transition-all"
                      style={{ width: `${Math.min(otherPct, 100)}%` }}
                    />
                    <div
                      title={`Proposed: ${purchasePct.toFixed(0)}%`}
                      className="bg-teal-600 h-full transition-all"
                      style={{ width: `${Math.min(purchasePct, 100)}%` }}
                    />
                    {result.isAffordable && (
                      <div
                        title={`Remaining: ${remainingPct.toFixed(0)}%`}
                        className="bg-green-500 h-full transition-all"
                        style={{ width: `${Math.min(remainingPct, 100)}%` }}
                      />
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500 pt-0.5">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-indigo-500 inline-block" /> Bills
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-sky-500 inline-block" /> Planned
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-teal-600 inline-block" /> Purchase
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Leftover
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* AI Purchase Advice (Premium Feature Teaser) */}
          <div className="bg-gradient-to-br from-teal-50/60 to-amber-50/50 rounded-2xl border border-amber-200/80 p-4 text-xs space-y-2.5 shadow-2xs">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 font-bold text-slate-800">
                <Sparkles className="w-4 h-4 text-amber-500 fill-amber-400 shrink-0" />
                <span>AI Spending Coach Advice</span>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-900 bg-amber-100/90 px-2 py-0.5 rounded-full border border-amber-300 shrink-0">
                Premium
              </span>
            </div>
            <p className="text-[11px] text-slate-600 leading-relaxed">
              Want personalized AI reasoning on whether this purchase fits your upcoming cash flow? The conversational AI Spending Coach is an upcoming Premium feature ($14.99/mo or $109.99/yr).
            </p>
            {onOpenUpgrade && (
              <button
                type="button"
                onClick={() => onOpenUpgrade('ai_spending_coach')}
                className="w-full py-2 px-3 bg-white hover:bg-slate-50 active:bg-slate-100 border border-amber-300 rounded-xl text-amber-950 font-bold text-xs transition-all shadow-2xs cursor-pointer flex items-center justify-center gap-1.5"
              >
                <span>Explore AI Spending Coach</span>
                <ArrowRight className="w-3.5 h-3.5 text-amber-600" />
              </button>
            )}
          </div>

          {/* Mandatory Transparent Disclaimer Banner */}
          <div className="bg-slate-50 rounded-2xl border border-slate-200/80 p-4 text-xs text-slate-600 space-y-1.5">
            <div className="flex items-center gap-1.5 font-semibold text-[#142D4E]">
              <Info className="w-4 h-4 text-slate-500 shrink-0" />
              <span>Calculation & Estimation Notice</span>
            </div>
            <p className="text-[11px] leading-relaxed text-slate-500">
              This calculation is an estimate based solely on the information you entered. It is not connected to any bank or financial institution, does not reflect real-time account balances, and does not constitute financial advice.
            </p>
          </div>
        </div>
      </div>

      {/* Reset Confirmation Modal */}
      {showResetConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in"
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-sm bg-white rounded-2xl shadow-xl border border-slate-200 p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-10 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center">
              <RotateCcw className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#142D4E]">Clear Plan Values?</h3>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                This will reset your entered budget and planning amounts to blank. Your expense history and other settings will not be affected.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors min-h-[38px]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmReset}
                className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition-colors shadow-2xs min-h-[38px]"
              >
                Clear Plan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

