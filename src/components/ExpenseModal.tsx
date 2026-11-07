import React, { useState, useEffect } from 'react';
import { Expense, ExpenseCategory, CATEGORIES, PAYMENT_METHODS, CurrencyCode, SUPPORTED_CURRENCIES } from '../types/expense';
import { getTodayDateString, formatDate } from '../utils/formatters';
import { X, Calendar, Tag, FileText, CreditCard, AlertCircle, Sparkles, ChevronDown } from 'lucide-react';
import { VoiceExpenseControl } from './VoiceExpenseControl';
import { ParsedVoiceExpense } from '../utils/voiceExpenseParser';
import { CategorySelectorModal, getCategoryIcon } from './CategorySelectorModal';
import { PaymentMethodSelectorModal, getPaymentMethodIcon } from './PaymentMethodSelectorModal';
import { DatePickerModal } from './DatePickerModal';

interface ExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (expenseData: {
    amount: number;
    category: ExpenseCategory;
    date: string;
    paymentMethod?: string;
    notes?: string;
  }) => boolean;
  initialExpense?: Expense | null;
  currency: CurrencyCode;
}

export const ExpenseModal: React.FC<ExpenseModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialExpense,
  currency,
}) => {
  const [amount, setAmount] = useState<string>('');
  const [category, setCategory] = useState<ExpenseCategory>('Groceries');
  const [date, setDate] = useState<string>(getTodayDateString());
  const [paymentMethod, setPaymentMethod] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [voiceAppliedNote, setVoiceAppliedNote] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState<boolean>(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState<boolean>(false);
  const [isDateModalOpen, setIsDateModalOpen] = useState<boolean>(false);

  const handleApplyVoiceExpense = (parsed: ParsedVoiceExpense) => {
    if (parsed.amount !== null) {
      setAmount(parsed.amount.toString());
    }
    setCategory(parsed.category);
    setDate(parsed.date);
    if (parsed.suggestedPaymentMethod) {
      setPaymentMethod(parsed.suggestedPaymentMethod);
    }
    setNotes(parsed.notes);
    setErrors({});
    setSaveError(null);
    setVoiceAppliedNote(
      parsed.type === 'income'
        ? 'Voice income details applied. Review the fields below before saving.'
        : 'Voice transaction details applied. Review the fields below before saving.'
    );
  };

  useEffect(() => {
    if (initialExpense) {
      setAmount(initialExpense.amount.toString());
      setCategory(initialExpense.category);
      setDate(initialExpense.date);
      setPaymentMethod(initialExpense.paymentMethod || '');
      setNotes(initialExpense.notes || '');
    } else {
      setAmount('');
      setCategory('Groceries');
      setDate(getTodayDateString());
      setPaymentMethod('');
      setNotes('');
    }
    setErrors({});
    setSaveError(null);
    setIsSubmitting(false);
  }, [initialExpense, isOpen]);

  // Handle ESC key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const validate = (): boolean => {
    const newErrors: { [key: string]: string } = {};

    // Validate amount
    const parsedAmount = parseFloat(amount.trim());
    if (!amount.trim()) {
      newErrors.amount = 'Please enter an expense amount.';
    } else if (isNaN(parsedAmount) || !isFinite(parsedAmount)) {
      newErrors.amount = 'Please enter a valid numeric amount.';
    } else if (parsedAmount <= 0) {
      newErrors.amount = 'Amount must be greater than 0.';
    } else if (parsedAmount > 100000000) {
      newErrors.amount = 'Amount exceeds maximum allowable threshold.';
    }

    // Validate date
    if (!date) {
      newErrors.date = 'Date is required.';
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      newErrors.date = 'Please enter a valid date (YYYY-MM-DD).';
    }

    // Validate category
    if (!category) {
      newErrors.category = 'Please select a category.';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (!validate()) {
      return;
    }

    setIsSubmitting(true);
    const parsedAmount = parseFloat(amount.trim());
    const cleanAmount = Math.round(parsedAmount * 100) / 100;

    const saved = onSave({
      amount: cleanAmount,
      category,
      date,
      paymentMethod: paymentMethod.trim() || undefined,
      notes: notes.trim() || undefined,
    });

    setIsSubmitting(false);

    if (!saved) {
      setSaveError('Failed to save expense to browser storage. Your modifications were not saved.');
      return;
    }

    setSaveError(null);
    onClose();
  };

  const selectedCurrencyInfo = SUPPORTED_CURRENCIES.find((c) => c.code === currency);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div
        className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-[#E2E8F0] overflow-hidden my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E2E8F0] bg-slate-50/50">
          <h2 id="modal-title" className="text-lg font-bold text-[#142D4E]">
            {initialExpense ? 'Edit Expense' : 'Add New Expense'}
          </h2>
          <div className="flex items-center gap-2">
            {!initialExpense && (
              <VoiceExpenseControl
                currentCurrency={currency}
                onApplyParsedExpense={handleApplyVoiceExpense}
                onDirectSaveExpense={(expenseData) => {
                  const success = onSave(expenseData);
                  if (success) {
                    onClose();
                  }
                  return success;
                }}
              />
            )}
            <button
              onClick={onClose}
              className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              aria-label="Close dialog"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {voiceAppliedNote && (
            <div
              role="status"
              className="p-3 rounded-xl bg-teal-50 border border-teal-200 text-xs font-semibold text-teal-900 flex items-center justify-between gap-2 animate-in fade-in"
            >
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-teal-600 shrink-0" />
                <span>{voiceAppliedNote}</span>
              </div>
              <button
                type="button"
                onClick={() => setVoiceAppliedNote(null)}
                className="text-teal-700 hover:text-teal-900 p-1 cursor-pointer"
                aria-label="Dismiss voice note"
              >
                <X className="w-3.5 h-3.5" />
              </button>
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
          {/* Amount Field */}
          <div>
            <label htmlFor="edit-expense-amount" className="block text-xs font-semibold text-[#142D4E] uppercase tracking-wider mb-1.5">
              Amount ({currency}) <span className="text-red-500">*</span>
            </label>
            <div className="relative rounded-xl shadow-2xs">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400 font-bold select-none text-base">
                {selectedCurrencyInfo?.symbol || '$'}
              </div>
              <input
                id="edit-expense-amount"
                type="number"
                step="0.01"
                min="0.01"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  if (errors.amount) setErrors((prev) => ({ ...prev, amount: '' }));
                }}
                className={`w-full rounded-xl border bg-white py-3 pl-10 pr-4 text-lg font-bold text-[#142D4E] tabular-nums focus:outline-none focus:ring-2 transition-all min-h-[48px] ${
                  errors.amount
                    ? 'border-red-400 focus:border-red-500 focus:ring-red-100'
                    : 'border-[#E2E8F0] focus:border-teal-600 focus:ring-teal-100'
                }`}
                autoFocus
              />
            </div>
            {errors.amount && (
              <p role="alert" className="mt-1.5 text-xs text-red-600 font-medium">{errors.amount}</p>
            )}
          </div>

          {/* Category & Date Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Category */}
            <div>
              <label id="edit-expense-category-label" className="block text-xs font-semibold text-[#142D4E] uppercase tracking-wider mb-1.5">
                Category <span className="text-red-500">*</span>
              </label>
              <div className="relative rounded-xl shadow-2xs">
                <button
                  type="button"
                  id="edit-expense-category"
                  aria-labelledby="edit-expense-category-label"
                  onClick={() => setIsCategoryModalOpen(true)}
                  className={`w-full flex items-center justify-between rounded-xl border bg-white py-2.5 px-3.5 text-sm font-medium text-[#142D4E] transition-all cursor-pointer min-h-[44px] ${
                    errors.category
                      ? 'border-red-400 focus:ring-2 focus:ring-red-100'
                      : 'border-[#E2E8F0] hover:border-teal-500 focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100'
                  }`}
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                        CATEGORIES.find((c) => c.name === category)?.bgColor || 'bg-teal-50'
                      } ${
                        CATEGORIES.find((c) => c.name === category)?.textColor || 'text-teal-700'
                      }`}
                    >
                      {getCategoryIcon(category, 'w-4 h-4')}
                    </div>
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{
                        backgroundColor:
                          CATEGORIES.find((c) => c.name === category)?.color || '#0D9488',
                      }}
                      aria-hidden="true"
                    />
                    <span className="font-bold text-[#142D4E] truncate">{category}</span>
                  </div>
                  <div className="flex items-center gap-1 text-slate-400 shrink-0 ml-2">
                    <span className="text-[11px] font-medium hidden xs:inline text-slate-500">Change</span>
                    <ChevronDown className="w-4 h-4" />
                  </div>
                </button>
              </div>
              {/* Popular Category Chips */}
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                <span className="text-[11px] font-semibold text-slate-400 mr-0.5">Popular:</span>
                {(['Groceries', 'Dining Out', 'Utilities', 'Transportation'] as ExpenseCategory[]).map((catName) => {
                  const isSelected = category === catName;
                  return (
                    <button
                      key={catName}
                      type="button"
                      onClick={() => {
                        setCategory(catName);
                        if (errors.category) setErrors((prev) => ({ ...prev, category: '' }));
                      }}
                      className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all min-h-[32px] cursor-pointer ${
                        isSelected
                          ? 'bg-teal-600 text-white shadow-2xs'
                          : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200/60'
                      }`}
                    >
                      {catName}
                    </button>
                  );
                })}
              </div>
              {errors.category && (
                <p role="alert" className="mt-1.5 text-xs text-red-600 font-medium">{errors.category}</p>
              )}
            </div>

            {/* Date */}
            <div>
              <label id="edit-expense-date-label" className="block text-xs font-semibold text-[#142D4E] uppercase tracking-wider mb-1.5">
                Date <span className="text-red-500">*</span>
              </label>
              <div className="relative rounded-xl shadow-2xs">
                <button
                  type="button"
                  id="edit-expense-date"
                  aria-labelledby="edit-expense-date-label"
                  onClick={() => setIsDateModalOpen(true)}
                  className={`w-full flex items-center justify-between rounded-xl border bg-white py-2.5 px-3.5 text-sm font-medium text-[#142D4E] transition-all cursor-pointer min-h-[44px] ${
                    errors.date
                      ? 'border-red-400 focus:ring-2 focus:ring-red-100'
                      : 'border-[#E2E8F0] hover:border-teal-500 focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100'
                  }`}
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <div className="w-6 h-6 rounded-lg bg-teal-50 text-teal-700 flex items-center justify-center shrink-0">
                      <Calendar className="w-3.5 h-3.5" />
                    </div>
                    <span className="font-bold text-[#142D4E] truncate">
                      {date === getTodayDateString() ? `Today · ${formatDate(date)}` : formatDate(date)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-slate-400 shrink-0 ml-2">
                    <span className="text-[11px] font-medium hidden xs:inline text-slate-500">Change</span>
                    <ChevronDown className="w-4 h-4" />
                  </div>
                </button>
              </div>
              {errors.date && (
                <p role="alert" className="mt-1.5 text-xs text-red-600 font-medium">{errors.date}</p>
              )}
            </div>
          </div>

          {/* Payment Method */}
          <div>
            <label id="edit-expense-payment-method-label" className="block text-xs font-semibold text-[#142D4E] uppercase tracking-wider mb-1.5">
              Payment Method <span className="text-slate-400 font-normal">(Optional)</span>
            </label>
            <div className="relative rounded-xl shadow-2xs">
              <button
                type="button"
                id="edit-expense-payment-method"
                aria-labelledby="edit-expense-payment-method-label"
                onClick={() => setIsPaymentModalOpen(true)}
                className="w-full flex items-center justify-between rounded-xl border border-[#E2E8F0] bg-white py-2.5 px-3.5 text-sm font-medium text-[#142D4E] hover:border-teal-500 focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 transition-all cursor-pointer min-h-[44px]"
              >
                <div className="flex items-center gap-2.5 truncate">
                  <div className="w-7 h-7 rounded-lg bg-teal-50 text-teal-700 flex items-center justify-center shrink-0">
                    {getPaymentMethodIcon(paymentMethod, 'w-4 h-4')}
                  </div>
                  <span className={paymentMethod ? 'font-semibold text-[#142D4E] truncate' : 'text-slate-500 truncate'}>
                    {paymentMethod || 'Select method (optional)'}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-slate-400 shrink-0 ml-2">
                  <span className="text-[11px] font-medium hidden xs:inline text-slate-500">Choose</span>
                  <ChevronDown className="w-4 h-4" />
                </div>
              </button>
            </div>

            {/* Quick Payment Method Chips */}
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              <span className="text-[11px] font-semibold text-slate-400 mr-1">Popular:</span>
              {['Credit Card', 'Debit Card', 'Cash', 'Digital Wallet'].map((pm) => {
                const isSelected = paymentMethod === pm;
                return (
                  <button
                    key={pm}
                    type="button"
                    onClick={() => setPaymentMethod(isSelected ? '' : pm)}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all min-h-[32px] cursor-pointer ${
                      isSelected
                        ? 'bg-teal-600 text-white shadow-2xs'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200/60'
                    }`}
                  >
                    {pm}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Optional Notes */}
          <div>
            <label htmlFor="edit-expense-notes" className="block text-xs font-semibold text-[#142D4E] uppercase tracking-wider mb-1.5">
              Notes <span className="text-slate-400 font-normal">(Optional)</span>
            </label>
            <div className="relative rounded-xl shadow-2xs">
              <div className="pointer-events-none absolute top-3 left-3.5 text-slate-400">
                <FileText className="w-4 h-4" />
              </div>
              <textarea
                id="edit-expense-notes"
                rows={2}
                placeholder="Additional details or notes..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-xl border border-[#E2E8F0] bg-white py-2.5 pl-10 pr-4 text-sm text-[#142D4E] focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 transition-all resize-none"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#E2E8F0]">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2.5 rounded-xl border border-[#E2E8F0] text-sm font-medium text-slate-700 hover:bg-slate-50 active:bg-slate-100 transition-colors min-h-[44px] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold shadow-xs hover:shadow-sm active:scale-[0.98] transition-all min-h-[44px] disabled:opacity-60 flex items-center justify-center cursor-pointer"
            >
              {isSubmitting ? 'Saving...' : initialExpense ? 'Update Expense' : 'Save Expense'}
            </button>
          </div>
        </form>
      </div>

      {/* Category Selector Modal */}
      <CategorySelectorModal
        isOpen={isCategoryModalOpen}
        onClose={() => setIsCategoryModalOpen(false)}
        selectedCategory={category}
        onSelectCategory={(cat) => {
          setCategory(cat);
          if (errors.category) setErrors((prev) => ({ ...prev, category: '' }));
        }}
      />

      {/* Payment Method Selector Modal */}
      <PaymentMethodSelectorModal
        isOpen={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
        selectedPaymentMethod={paymentMethod}
        onSelectPaymentMethod={(pm) => setPaymentMethod(pm)}
      />

      {/* Date Selector Modal */}
      <DatePickerModal
        isOpen={isDateModalOpen}
        onClose={() => setIsDateModalOpen(false)}
        selectedDate={date}
        onSelectDate={(newDate) => {
          setDate(newDate);
          if (errors.date) setErrors((prev) => ({ ...prev, date: '' }));
        }}
      />
    </div>
  );
};
