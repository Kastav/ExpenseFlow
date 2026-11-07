import React, { useEffect } from 'react';
import { PAYMENT_METHODS, PaymentMethod } from '../types/expense';
import {
  CreditCard,
  Banknote,
  Building2,
  Smartphone,
  HelpCircle,
  CircleSlash,
  Check,
  X,
} from 'lucide-react';

interface PaymentMethodSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedPaymentMethod: string | undefined;
  onSelectPaymentMethod: (paymentMethod: string) => void;
}

export const getPaymentMethodIcon = (method: string | undefined, className: string = 'w-4 h-4') => {
  if (!method) return <CircleSlash className={className} />;
  switch (method) {
    case 'Credit Card':
      return <CreditCard className={className} />;
    case 'Debit Card':
      return <CreditCard className={className} />;
    case 'Cash':
      return <Banknote className={className} />;
    case 'Bank Transfer':
      return <Building2 className={className} />;
    case 'Digital Wallet':
      return <Smartphone className={className} />;
    case 'Other':
    default:
      return <HelpCircle className={className} />;
  }
};

export const PaymentMethodSelectorModal: React.FC<PaymentMethodSelectorModalProps> = ({
  isOpen,
  onClose,
  selectedPaymentMethod,
  onSelectPaymentMethod,
}) => {
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

  const handlePick = (method: string) => {
    onSelectPaymentMethod(method);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="payment-method-modal-title"
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-[#E2E8F0] overflow-hidden my-auto flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E2E8F0] bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center shrink-0">
              <CreditCard className="w-4 h-4" />
            </div>
            <div>
              <h2 id="payment-method-modal-title" className="text-base font-bold text-[#142D4E]">
                Select Payment Method
              </h2>
              <p className="text-[11px] text-[#64748B]">
                Record how this expense was paid (Optional)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            type="button"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
            aria-label="Close payment method selector"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Options List */}
        <div className="flex-1 overflow-y-auto overscroll-contain divide-y divide-slate-100 p-2 max-h-[50vh] sm:max-h-[55vh] touch-pan-y">
          {/* Option: None / Unspecified (Optional) */}
          <button
            type="button"
            onClick={() => handlePick('')}
            className={`w-full flex items-center justify-between p-3 rounded-xl text-left transition-all cursor-pointer min-h-[48px] ${
              !selectedPaymentMethod
                ? 'bg-teal-50 border border-teal-200 text-teal-950 font-bold'
                : 'hover:bg-slate-50 border border-transparent text-slate-600 font-medium'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
                <CircleSlash className="w-4 h-4" />
              </div>
              <div>
                <span className="text-sm block">None / Unspecified</span>
                <span className="text-[11px] text-slate-400 font-normal">Leave payment method blank</span>
              </div>
            </div>

            {!selectedPaymentMethod && (
              <div className="w-6 h-6 rounded-full bg-teal-600 text-white flex items-center justify-center shrink-0">
                <Check className="w-3.5 h-3.5 stroke-[2.5]" />
              </div>
            )}
          </button>

          {/* Standard Payment Methods */}
          {PAYMENT_METHODS.map((method: PaymentMethod) => {
            const isSelected = selectedPaymentMethod === method;
            return (
              <button
                key={method}
                type="button"
                onClick={() => handlePick(method)}
                className={`w-full flex items-center justify-between p-3 rounded-xl text-left transition-all cursor-pointer min-h-[48px] ${
                  isSelected
                    ? 'bg-teal-50 border border-teal-200 text-teal-950 font-bold'
                    : 'hover:bg-slate-50 border border-transparent text-[#142D4E] font-medium'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-teal-50 text-teal-700 flex items-center justify-center shrink-0">
                    {getPaymentMethodIcon(method, 'w-4 h-4')}
                  </div>
                  <div>
                    <span className="text-sm block">{method}</span>
                    <span className="text-[11px] text-slate-400 font-normal">
                      {method === 'Credit Card'
                        ? 'Visa, Mastercard, Amex'
                        : method === 'Debit Card'
                        ? 'Bank debit or ATM card'
                        : method === 'Cash'
                        ? 'Physical cash payment'
                        : method === 'Bank Transfer'
                        ? 'Direct wire, ACH, or NEFT'
                        : method === 'Digital Wallet'
                        ? 'Apple Pay, Google Pay, UPI'
                        : 'Other payment option'}
                    </span>
                  </div>
                </div>

                {isSelected && (
                  <div className="w-6 h-6 rounded-full bg-teal-600 text-white flex items-center justify-center shrink-0">
                    <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Footer info */}
        <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
          <span>{PAYMENT_METHODS.length} payment options</span>
          <span>Click any option to select</span>
        </div>
      </div>
    </div>
  );
};
