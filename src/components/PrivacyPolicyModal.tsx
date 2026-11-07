import React, { useEffect } from 'react';
import { X, ShieldCheck, Lock, Mic, FileText, CheckCircle2 } from 'lucide-react';

interface PrivacyPolicyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PrivacyPolicyModal: React.FC<PrivacyPolicyModalProps> = ({ isOpen, onClose }) => {
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="privacy-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto animate-in fade-in"
    >
      <div
        className="relative w-full max-w-xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden my-auto max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-[#142D4E] text-white p-5 sm:p-6 relative shrink-0">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close privacy policy"
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-2 mb-1.5">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-teal-500/20 text-teal-300 uppercase tracking-wider">
              <ShieldCheck className="w-3.5 h-3.5" />
              Legal &amp; Privacy
            </span>
          </div>

          <h2 id="privacy-modal-title" className="text-xl sm:text-2xl font-bold tracking-tight">
            Privacy Policy &amp; Data Safety
          </h2>
          <p className="text-xs text-slate-300 mt-0.5">
            Full transparency on how ExpenseFlow handles your financial data and device permissions.
          </p>
        </div>

        {/* Scrollable Content */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-5 text-xs text-slate-700 leading-relaxed flex-1">
          <div className="p-3 bg-teal-50 border border-teal-200 rounded-xl flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
            <p className="text-teal-950 font-medium">
              ExpenseFlow is designed with privacy-first principles. Your individual financial records stay on your device by default.
            </p>
          </div>

          <section className="space-y-1.5">
            <h3 className="text-sm font-bold text-[#142D4E] flex items-center gap-1.5">
              <Lock className="w-4 h-4 text-teal-600" />
              <span>1. Local Data Storage</span>
            </h3>
            <p>
              Your expense history, budgets, purchase plans, category tags, and currency preferences are stored directly on this device using local storage. We do not automatically upload, track, or sell your financial data to external marketing databases.
            </p>
          </section>

          <section className="space-y-1.5">
            <h3 className="text-sm font-bold text-[#142D4E] flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-teal-600" />
              <span>2. AI Spending Coach &amp; Data Minimization</span>
            </h3>
            <p>
              When interacting with the AI Spending Coach, your raw individual transactions, notes, merchant names, and IDs are <strong>strictly withheld</strong>. The app transmits only anonymized high-level aggregates (current month spend, monthly budget, daily allowance, category breakdown percentages) to compute helpful guidance via our server-side Gemini API proxy.
            </p>
          </section>

          <section className="space-y-1.5">
            <h3 className="text-sm font-bold text-[#142D4E] flex items-center gap-1.5">
              <Mic className="w-4 h-4 text-teal-600" />
              <span>3. Device Permissions</span>
            </h3>
            <p>
              <strong>Microphone:</strong> Used only when you tap Voice Expense Entry to transcribe spoken amounts. Voice audio is processed locally on device and is never recorded or stored remotely.
            </p>
            <p>
              <strong>Internet:</strong> Used to verify Google Play In-App Billing receipts, query current exchange rates if applicable, and fetch AI Coach guidance.
            </p>
          </section>

          <section className="space-y-1.5">
            <h3 className="text-sm font-bold text-[#142D4E] flex items-center gap-1.5">
              <FileText className="w-4 h-4 text-teal-600" />
              <span>4. Google Play Subscriptions</span>
            </h3>
            <p>
              Subscription purchases are handled securely by Google Play Billing. Payment credentials remain entirely with Google. Server receipt verification is executed via the official Google Play Developer API strictly to validate active subscription status.
            </p>
          </section>

          <section className="space-y-1.5">
            <h3 className="text-sm font-bold text-[#142D4E]">5. Data Export &amp; Deletion</h3>
            <p>
              You maintain total data ownership. You can export your full ledger at any time in universal CSV format, or clear all data by wiping app storage.
            </p>
          </section>
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0">
          <span className="text-[11px] text-slate-500">Effective Date: November 2026</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-xl transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
