import React, { useState, useEffect } from 'react';
import { X, Target, AlertCircle, AlertTriangle } from 'lucide-react';
import { formatCurrency } from '../utils/formatters';
import { CurrencyCode, SUPPORTED_CURRENCIES } from '../types/expense';
import { StorageReadStatus } from '../utils/storage';

interface BudgetModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentBudget: number;
  onSaveBudget: (newBudget: number) => boolean;
  currency: CurrencyCode;
  readStatus?: StorageReadStatus;
  errorMessage?: string | null;
}

export const BudgetModal: React.FC<BudgetModalProps> = ({
  isOpen,
  onClose,
  currentBudget,
  onSaveBudget,
  currency,
  readStatus = 'success',
  errorMessage,
}) => {
  const [budgetInput, setBudgetInput] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [saveError, setSaveError] = useState<string | null>(null);

  const currInfo = SUPPORTED_CURRENCIES.find((c) => c.code === currency);
  const symbol = currInfo?.symbol || '$';

  useEffect(() => {
    if (isOpen) {
      setBudgetInput(currentBudget > 0 ? currentBudget.toString() : '2500');
      setError('');
      setSaveError(null);
    }
  }, [isOpen, currentBudget]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(budgetInput.trim());

    if (!budgetInput.trim()) {
      setError('Please enter a monthly budget amount.');
      return;
    }

    if (isNaN(val) || !isFinite(val)) {
      setError('Please enter a valid numeric amount.');
      return;
    }

    if (val <= 0) {
      setError('Monthly budget must be greater than 0.');
      return;
    }

    if (val > 100000000) {
      setError('Budget exceeds maximum allowable threshold.');
      return;
    }

    const cleanVal = Math.round(val * 100) / 100;
    const success = onSaveBudget(cleanVal);
    if (!success) {
      setSaveError(
        readStatus === 'error'
          ? 'Cannot save budget: existing budget data in browser storage could not be read safely. Changes are locked to prevent data loss.'
          : 'Failed to save budget to browser storage. Your changes could not be persisted.'
      );
      return;
    }

    setSaveError(null);
    onClose();
  };

  const presetAmounts = [1500, 2500, 3500, 5000];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="budget-modal-title"
    >
      <div
        className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-[#E2E8F0] overflow-hidden my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E2E8F0] bg-slate-50/50">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center">
              <Target className="w-4 h-4" />
            </div>
            <h2 id="budget-modal-title" className="text-lg font-bold text-[#142D4E]">
              Monthly Spending Budget
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <p className="text-xs text-[#64748B] leading-relaxed">
            Set your target monthly expense limit in your selected currency ({currency}). Your dashboard and insights calculate real-time remaining budget and progress against this target.
          </p>

          {readStatus === 'error' && (
            <div
              role="alert"
              className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2.5 animate-in fade-in"
            >
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold block">Storage Read Warning</span>
                <span>
                  {errorMessage || 'Existing budget data could not be read safely from storage.'}{' '}
                  Saving is locked to prevent overwriting unreadable records until storage is restored.
                </span>
              </div>
            </div>
          )}

          {saveError && (
            <div
              role="alert"
              className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs font-semibold text-red-800 flex items-center gap-2 animate-in fade-in"
            >
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{saveError}</span>
            </div>
          )}

          <div>
            <label htmlFor="budget-input" className="block text-xs font-semibold text-[#142D4E] uppercase tracking-wider mb-1.5">
              Target Budget ({currency}) <span className="text-red-500">*</span>
            </label>
            <div className="relative rounded-xl shadow-2xs">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400 font-bold text-lg select-none">
                {symbol}
              </div>
              <input
                id="budget-input"
                type="number"
                step="1"
                min="1"
                inputMode="decimal"
                value={budgetInput}
                onChange={(e) => {
                  setBudgetInput(e.target.value);
                  if (error) setError('');
                  if (saveError) setSaveError(null);
                }}
                placeholder="2500"
                className={`w-full rounded-xl border bg-white py-3 pl-10 pr-4 text-xl font-bold text-[#142D4E] tabular-nums focus:outline-none focus:ring-2 transition-all ${
                  error
                    ? 'border-red-400 focus:border-red-500 focus:ring-red-100'
                    : 'border-[#E2E8F0] focus:border-teal-600 focus:ring-teal-100'
                }`}
                autoFocus
              />
            </div>
            {error && <p className="mt-1.5 text-xs text-red-600 font-medium">{error}</p>}
          </div>

          {/* Quick Presets */}
          <div>
            <span className="block text-xs font-medium text-slate-500 mb-2">
              Common monthly budgets:
            </span>
            <div className="grid grid-cols-4 gap-2">
              {presetAmounts.map((amount) => (
                <button
                  key={amount}
                  type="button"
                  onClick={() => {
                    setBudgetInput(amount.toString());
                    if (error) setError('');
                    if (saveError) setSaveError(null);
                  }}
                  className={`py-1.5 px-2 text-xs font-semibold rounded-lg border transition-all tabular-nums ${
                    budgetInput === amount.toString()
                      ? 'border-teal-600 bg-teal-50 text-teal-800'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {formatCurrency(amount, currency, false)}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#E2E8F0]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-[#E2E8F0] text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors min-h-[44px] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={readStatus === 'error'}
              className="px-6 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold shadow-xs hover:shadow-sm active:scale-[0.98] transition-all min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center cursor-pointer"
            >
              Save Budget
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
