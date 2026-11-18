import React, { useEffect } from 'react';
import { X, ShieldCheck, Lock, Mic, FileText, CheckCircle2 } from 'lucide-react';
import { useModalBackHandler } from '../utils/backNavigation';

interface PrivacyPolicyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PrivacyPolicyModal: React.FC<PrivacyPolicyModalProps> = ({ isOpen, onClose }) => {
  useModalBackHandler(isOpen, onClose);

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
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs overflow-hidden animate-in fade-in"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-xl bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 overflow-hidden max-h-[92dvh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-[#142D4E] text-white p-4 sm:p-6 pr-14 relative shrink-0">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close privacy policy"
            className="absolute top-3 right-3 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-2 mb-1.5">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-teal-500/20 text-teal-300 uppercase tracking-wider">
              <ShieldCheck className="w-3.5 h-3.5" />
              Legal &amp; Privacy
            </span>
          </div>

          <h2 id="privacy-modal-title" className="text-lg sm:text-2xl font-bold tracking-tight">
            Privacy Policy &amp; Data Safety
          </h2>
          <p className="text-xs text-slate-300 mt-0.5">
            Full transparency on how ExpenseFlow handles your financial data and device permissions.
          </p>
        </div>

        {/* Scrollable Content */}
        <div className="p-4 sm:p-6 overflow-y-auto overscroll-contain space-y-5 text-xs text-slate-700 leading-relaxed flex-1">
          <div className="p-3 bg-teal-50 border border-teal-200 rounded-xl flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
            <p className="text-teal-950 font-medium">
              ExpenseFlow is designed with privacy-first principles. Your individual financial records stay strictly on your device and are never sold or shared with ad brokers.
            </p>
          </div>

          <section className="space-y-1.5">
            <h3 className="text-sm font-bold text-[#142D4E] flex items-center gap-1.5">
              <Lock className="w-4 h-4 text-teal-600 shrink-0" />
              <span>1. Local Financial Storage</span>
            </h3>
            <p>
              Your expense ledger, budgets, purchase plans, challenges, category tags, and currency preferences are stored locally on your device. Core expense tracking works 100% offline without creating an account, and ExpenseFlow does not upload your expense records to any cloud database in this Stage 1 release.
            </p>
          </section>

          <section className="space-y-1.5">
            <h3 className="text-sm font-bold text-[#142D4E]">2. Optional ExpenseFlow Account (Firebase Authentication)</h3>
            <p>
              Creating an account or signing in is optional. If you choose to register, Google Firebase Authentication (project <code className="font-mono">expenseflow-ad899</code>) securely manages your email address and user ID (UID). Your password is handled directly by Firebase Authentication and is never stored locally by ExpenseFlow.
            </p>
          </section>

          <section className="space-y-1.5">
            <h3 className="text-sm font-bold text-[#142D4E] flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-teal-600 shrink-0" />
              <span>3. Planned Stage 2 Cloud &amp; AI Features (Currently Disabled)</span>
            </h3>
            <p>
              AI Spending Coach, multi-device cloud sync, and live Google Play subscription purchases are disabled in Stage 1 offline-first builds. Should optional Stage 2 backend features be activated in a future update, only minimized monthly summary aggregates would be transmitted during explicit AI Coach queries and only verified subscription metadata would be stored—never raw notes or receipts.
            </p>
          </section>

          <section className="space-y-1.5">
            <h3 className="text-sm font-bold text-[#142D4E] flex items-center gap-1.5">
              <Mic className="w-4 h-4 text-teal-600 shrink-0" />
              <span>4. Device Permissions &amp; Optional Analytics</span>
            </h3>
            <p>
              <strong>Microphone:</strong> Used only when you tap Voice Expense Entry to transcribe spoken entries via platform WebView/device speech recognition. Audio recordings are never stored or uploaded by ExpenseFlow.
            </p>
            <p>
              <strong>Anonymous Usage Analytics:</strong> Optional Firebase Analytics logs minimal, allowlisted non-financial navigation and feature counts (never amounts, categories, notes, or personal identifiers). You can opt out anytime in <strong>More &gt; Data Storage &amp; Privacy</strong>.
            </p>
          </section>

          <section className="space-y-1.5">
            <h3 className="text-sm font-bold text-[#142D4E] flex items-center gap-1.5">
              <FileText className="w-4 h-4 text-teal-600 shrink-0" />
              <span>5. Data Export, Retention &amp; Account Deletion</span>
            </h3>
            <p>
              You can export your ledger to CSV or clear local entries anytime. To permanently delete your ExpenseFlow Firebase account inside the app, open <strong>More &gt; ExpenseFlow Account &gt; Manage / Delete &gt; Delete ExpenseFlow Account</strong> (with an option to keep or also erase local device storage). You may also delete your account externally in any browser via our standalone <strong>Web Account Deletion</strong> page (<code className="font-mono">delete-account.html</code>) hosted alongside our public Privacy Policy. For developer contact, please use the official developer email listed on our Google Play Store listing.
            </p>
          </section>
        </div>

        {/* Footer */}
        <div className="p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] sm:pb-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0">
          <span className="text-[11px] text-slate-500">Effective Date: November 2026</span>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-4 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-xl transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
