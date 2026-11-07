import React, { useState, useEffect } from 'react';
import { Expense, CurrencyCode } from '../types/expense';
import { formatCurrency, formatDate } from '../utils/formatters';
import { AlertTriangle, X, AlertCircle } from 'lucide-react';

interface DeleteConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => boolean;
  expense: Expense | null;
  currency: CurrencyCode;
}

export const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  expense,
  currency,
}) => {
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    setDeleteError(null);
  }, [isOpen, expense]);

  if (!isOpen || !expense) return null;

  const handleDelete = () => {
    const success = onConfirm();
    if (!success) {
      setDeleteError('Could not delete expense: unable to save changes to browser storage.');
      return;
    }
    setDeleteError(null);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-150"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="delete-dialog-title"
    >
      <div
        className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-[#E2E8F0] overflow-hidden my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E2E8F0] bg-slate-50/50">
          <div className="flex items-center gap-2 text-red-600">
            <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <h2 id="delete-dialog-title" className="text-base font-bold text-[#142D4E]">
              Delete Transaction
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

        <div className="p-6 space-y-4">
          {deleteError && (
            <div
              role="alert"
              className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs font-semibold text-red-800 flex items-center gap-2 animate-in fade-in"
            >
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{deleteError}</span>
            </div>
          )}

          <p className="text-sm text-[#142D4E] leading-normal">
            Are you sure you want to permanently delete this transaction? This action cannot be undone.
          </p>

          <div className="bg-slate-50 rounded-xl p-4 border border-slate-200/80 space-y-1.5 text-xs text-slate-600">
            <div className="flex justify-between items-center text-sm font-semibold text-[#142D4E]">
              <span>{expense.category}</span>
              <span className="tabular-nums font-bold text-slate-900">{formatCurrency(expense.amount, currency)}</span>
            </div>
            <div className="flex justify-between items-center text-slate-500 pt-1 border-t border-slate-200/60">
              <span>{formatDate(expense.date)}</span>
              <span>{expense.paymentMethod || 'Unspecified'}</span>
            </div>
            {expense.notes && (
              <p className="text-slate-500 italic pt-1 truncate">Note: {expense.notes}</p>
            )}
            {!expense.notes && expense.description && (
              <p className="text-slate-500 italic pt-1 truncate">Note: {expense.description}</p>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-[#E2E8F0] text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors min-h-[44px]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDelete}
              className="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold shadow-xs hover:shadow-sm active:scale-[0.98] transition-all min-h-[44px]"
            >
              Delete Expense
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
