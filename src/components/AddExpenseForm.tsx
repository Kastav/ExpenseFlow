import React, { useState } from 'react';
import { ExpenseCategory, CATEGORIES, PAYMENT_METHODS, CurrencyCode, SUPPORTED_CURRENCIES } from '../types/expense';
import { getTodayDateString, formatCurrency, formatDate } from '../utils/formatters';
import { Calendar, Tag, CreditCard, FileText, CheckCircle2, Plus, AlertCircle, Sparkles, X, ChevronDown } from 'lucide-react';
import { VoiceExpenseControl } from './VoiceExpenseControl';
import { ParsedVoiceExpense } from '../utils/voiceExpenseParser';
import { CategorySelectorModal, getCategoryIcon } from './CategorySelectorModal';
import { PaymentMethodSelectorModal, getPaymentMethodIcon } from './PaymentMethodSelectorModal';
import { DatePickerModal } from './DatePickerModal';

interface AddExpenseFormProps {
  onSave: (expenseData: {
    amount: number;
    category: ExpenseCategory;
    date: string;
    paymentMethod?: string;
    notes?: string;
  }) => boolean;
  currency: CurrencyCode;
}

export const AddExpenseForm: React.FC<AddExpenseFormProps> = ({ onSave, currency }) => {
  const [amount, setAmount] = useState<string>('');
  const [category, setCategory] = useState<ExpenseCategory>('Groceries');
  const [date, setDate] = useState<string>(getTodayDateString());
  const [paymentMethod, setPaymentMethod] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
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
    setStorageError(null);
    setVoiceAppliedNote(
      parsed.type === 'income'
        ? 'Voice income details applied. Review the category and amount, then click Add Expense to save.'
        : 'Voice transaction details applied. Review the fields below and click Add Expense to save.'
    );
  };

  const selectedCurrencyInfo = SUPPORTED_CURRENCIES.find((c) => c.code === currency);

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

    // Validate category
    if (!category) {
      newErrors.category = 'Please select a category.';
    }

    // Validate date
    if (!date) {
      newErrors.date = 'Date is required.';
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      newErrors.date = 'Please enter a valid date (YYYY-MM-DD).';
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
      setStorageError('Failed to save expense to browser storage. Your changes could not be persisted.');
      return;
    }

    // Clear form inputs only on confirmed persistence
    setAmount('');
    setCategory('Groceries');
    setDate(getTodayDateString());
    setPaymentMethod('');
    setNotes('');
    setErrors({});
    setStorageError(null);

    // Show clear success feedback
    const formatted = formatCurrency(cleanAmount, currency);
    setSuccessMessage(`Expense of ${formatted} added successfully.`);
    setTimeout(() => {
      setSuccessMessage(null);
    }, 4000);
  };

  return (
    <section
      id="add-expense-form-section"
      className="bg-white rounded-2xl border border-[#E2E8F0] p-5 sm:p-6 shadow-xs transition-shadow"
      aria-labelledby="add-expense-heading"
    >
      <div className="flex items-center justify-between gap-3 pb-4 mb-4 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center shrink-0">
            <Plus className="w-4 h-4 stroke-[2.5]" />
          </div>
          <div>
            <h2 id="add-expense-heading" className="text-base sm:text-lg font-bold text-[#142D4E]">
              Add Expense
            </h2>
            <p className="text-xs text-[#64748B]">
              Quickly record a transaction directly to your dashboard ({currency})
            </p>
          </div>
        </div>

        {/* Voice Expense Entry Control with Direct Save capability */}
        <VoiceExpenseControl
          currentCurrency={currency}
          onApplyParsedExpense={handleApplyVoiceExpense}
          onDirectSaveExpense={onSave}
        />
      </div>

      {voiceAppliedNote && (
        <div
          role="status"
          className="mb-4 flex items-center justify-between gap-2.5 p-3 rounded-xl bg-teal-50 border border-teal-200 text-xs font-semibold text-teal-900 animate-in fade-in"
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

      {storageError && (
        <div
          role="alert"
          className="mb-4 flex items-center gap-2.5 p-3 rounded-xl bg-red-50 border border-red-200 text-xs sm:text-sm font-semibold text-red-800 animate-in fade-in"
        >
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{storageError}</span>
        </div>
      )}

      {successMessage && (
        <div
          role="status"
          className="mb-4 flex items-center gap-2.5 p-3 rounded-xl bg-green-50 border border-green-200 text-xs sm:text-sm font-semibold text-green-800 animate-in fade-in"
        >
          <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Row 1: Amount & Category */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* 1. Amount */}
          <div>
            <label
              htmlFor="inline-expense-amount"
              className="block text-xs font-semibold text-[#142D4E] uppercase tracking-wider mb-1.5"
            >
              Amount ({currency}) <span className="text-red-500">*</span>
            </label>
            <div className="relative rounded-xl shadow-2xs">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400 font-bold select-none text-base">
                {selectedCurrencyInfo?.symbol || '$'}
              </div>
              <input
                id="inline-expense-amount"
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
              />
            </div>

            {/* Quick Amount Presets */}
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              <span className="text-[11px] font-semibold text-slate-400 mr-1">Quick:</span>
              {[10, 25, 50, 100].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setAmount(preset.toFixed(2));
                    if (errors.amount) setErrors((prev) => ({ ...prev, amount: '' }));
                  }}
                  className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors tabular-nums min-h-[32px] cursor-pointer"
                >
                  +{selectedCurrencyInfo?.symbol || '$'}{preset}
                </button>
              ))}
            </div>

            {errors.amount && (
              <p role="alert" className="mt-1.5 text-xs text-red-600 font-medium">{errors.amount}</p>
            )}
          </div>

          {/* 2. Category (Required) */}
          <div>
            <label
              id="inline-expense-category-label"
              className="block text-xs font-semibold text-[#142D4E] uppercase tracking-wider mb-1.5"
            >
              Category <span className="text-red-500">*</span>
            </label>
            <div className="relative rounded-xl shadow-2xs">
              <button
                type="button"
                id="inline-expense-category"
                aria-labelledby="inline-expense-category-label"
                onClick={() => setIsCategoryModalOpen(true)}
                className={`w-full flex items-center justify-between rounded-xl border bg-white py-2.5 px-3.5 text-sm font-medium text-[#142D4E] transition-all cursor-pointer min-h-[48px] ${
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
                <div className="flex items-center gap-1.5 text-slate-400 shrink-0 ml-2">
                  <span className="text-[11px] font-medium hidden xs:inline text-slate-500">Change</span>
                  <ChevronDown className="w-4 h-4" />
                </div>
              </button>
            </div>

            {/* Quick Top Category Chips */}
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              <span className="text-[11px] font-semibold text-slate-400 mr-1">Popular:</span>
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
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
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
        </div>

        {/* Row 2: Date & Payment Method */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* 3. Date (Required, defaults to today) */}
          <div>
            <label
              id="inline-expense-date-label"
              className="block text-xs font-semibold text-[#142D4E] uppercase tracking-wider mb-1.5"
            >
              Date <span className="text-red-500">*</span>
            </label>
            <div className="relative rounded-xl shadow-2xs">
              <button
                type="button"
                id="inline-expense-date"
                aria-labelledby="inline-expense-date-label"
                onClick={() => setIsDateModalOpen(true)}
                className={`w-full flex items-center justify-between rounded-xl border bg-white py-2.5 px-3.5 text-sm font-medium text-[#142D4E] transition-all cursor-pointer min-h-[48px] ${
                  errors.date
                    ? 'border-red-400 focus:ring-2 focus:ring-red-100'
                    : 'border-[#E2E8F0] hover:border-teal-500 focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100'
                }`}
              >
                <div className="flex items-center gap-2.5 truncate">
                  <div className="w-7 h-7 rounded-lg bg-teal-50 text-teal-700 flex items-center justify-center shrink-0">
                    <Calendar className="w-4 h-4" />
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
              <p className="mt-1.5 text-xs text-red-600 font-medium">{errors.date}</p>
            )}
          </div>

          {/* 4. Payment Method (Optional) */}
          <div>
            <label
              id="inline-expense-payment-method-label"
              className="block text-xs font-semibold text-[#142D4E] uppercase tracking-wider mb-1.5"
            >
              Payment Method <span className="text-slate-400 font-normal">(Optional)</span>
            </label>
            <div className="relative rounded-xl shadow-2xs">
              <button
                type="button"
                id="inline-expense-payment-method"
                aria-labelledby="inline-expense-payment-method-label"
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
        </div>

        {/* Row 3: Notes (Optional) */}
        <div>
          <label
            htmlFor="inline-expense-notes"
            className="block text-xs font-semibold text-[#142D4E] uppercase tracking-wider mb-1.5"
          >
            Notes <span className="text-slate-400 font-normal">(Optional)</span>
          </label>
          <div className="relative rounded-xl shadow-2xs">
            <div className="pointer-events-none absolute top-3 left-3.5 text-slate-400">
              <FileText className="w-4 h-4" />
            </div>
            <input
              id="inline-expense-notes"
              type="text"
              placeholder="e.g. Weekly family groceries, lunch meeting, monthly train pass"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-xl border border-[#E2E8F0] bg-white py-2.5 pl-10 pr-4 text-sm text-[#142D4E] focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 transition-all min-h-[44px]"
            />
          </div>
        </div>

        {/* Submit Button */}
        <div className="pt-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-bold shadow-xs hover:shadow-sm active:scale-[0.99] transition-all min-h-[48px] disabled:opacity-60 cursor-pointer"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>{isSubmitting ? 'Saving Expense...' : 'Save Expense'}</span>
          </button>
        </div>
      </form>

      {/* Premium Category Selection Modal */}
      <CategorySelectorModal
        isOpen={isCategoryModalOpen}
        onClose={() => setIsCategoryModalOpen(false)}
        selectedCategory={category}
        onSelectCategory={(cat) => {
          setCategory(cat);
          if (errors.category) setErrors((prev) => ({ ...prev, category: '' }));
        }}
      />

      {/* Premium Payment Method Selection Modal */}
      <PaymentMethodSelectorModal
        isOpen={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
        selectedPaymentMethod={paymentMethod}
        onSelectPaymentMethod={(pm) => setPaymentMethod(pm)}
      />

      {/* Premium Date Selection Modal */}
      <DatePickerModal
        isOpen={isDateModalOpen}
        onClose={() => setIsDateModalOpen(false)}
        selectedDate={date}
        onSelectDate={(newDate) => {
          setDate(newDate);
          if (errors.date) setErrors((prev) => ({ ...prev, date: '' }));
        }}
      />
    </section>
  );
};
