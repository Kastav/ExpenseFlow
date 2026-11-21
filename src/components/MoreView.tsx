import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Expense, CurrencyCode } from '../types/expense';
import {
  ISO_COUNTRIES,
  getCountryDetails,
  getCurrencyDetails,
  getCountryFlagEmoji,
  getCurrencyCountryAndFlag,
} from '../data/geoCurrencies';
import { CurrencySelectorModal } from './CurrencySelectorModal';
import {
  exportTransactionsCSV,
  getTransactionsDateRange,
} from '../utils/formatters';
import {
  Download,
  ShieldCheck,
  CheckCircle2,
  FileSpreadsheet,
  AlertCircle,
  Coins,
  Globe,
  Search,
  Check,
  ChevronDown,
  Calendar,
  Loader2,
  Sparkles,
  Cloud,
  ArrowRight,
  FileText,
  UserCheck,
  LogIn,
  LogOut,
  X,
  RefreshCw,
  RotateCcw,
  Lock,
} from 'lucide-react';
import { PremiumFeatureId } from '../types/premium';
import { AuthUser } from '../services/authService';
import { getCurrentUserPlanTier } from '../utils/premium';
import { useStageAvailability } from '../utils/stageAvailability';
import {
  CloudSyncPreview,
  CloudSyncLocalMeta,
  PreSyncRecoveryBackup,
  getCloudSyncLocalMeta,
  getPreSyncRecoveryBackup,
  performSmartCloudSync,
  previewCloudSync,
  pullAndApplyCloudBackup,
  restorePreSyncRecoveryBackup,
  restorePreviousCloudRevision,
} from '../utils/cloudSyncClient';
import { getAnalyticsConsent, setAnalyticsConsent } from '../services/analytics';
import { useModalBackHandler, scrollInputIntoViewOnFocus } from '../utils/backNavigation';

interface MoreViewProps {
  transactions: Expense[];
  currency: CurrencyCode;
  onSelectCurrency: (currency: CurrencyCode) => void;
  country?: string | null;
  onSelectCountry?: (countryCode: string) => void;
  onOpenUpgrade?: (feature?: PremiumFeatureId) => void;
  onOpenPrivacyPolicy?: () => void;
  authUser?: AuthUser | null;
  onOpenAuth?: () => void;
  onRequireAuth?: (msg?: string) => void;
  onSignOut?: () => Promise<void> | void;
  onCloudSyncApplied?: () => void;
}

export const MoreView: React.FC<MoreViewProps> = ({
  transactions,
  currency,
  onSelectCurrency,
  country = 'US',
  onSelectCountry,
  onOpenUpgrade,
  onOpenPrivacyPolicy,
  authUser,
  onOpenAuth,
  onRequireAuth,
  onSignOut,
  onCloudSyncApplied,
}) => {
  const stageAvailability = useStageAvailability(true);
  const isPremium = Boolean(authUser) && getCurrentUserPlanTier() === 'premium';
  const [syncMeta, setSyncMeta] = useState<CloudSyncLocalMeta | null>(() => getCloudSyncLocalMeta());
  const [recoveryBackup, setRecoveryBackup] = useState<PreSyncRecoveryBackup | null>(() =>
    getPreSyncRecoveryBackup()
  );
  const [syncPreview, setSyncPreview] = useState<CloudSyncPreview | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  const handleCloudSmartSync = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    setSyncMessage(null);
    try {
      const result = await performSmartCloudSync('merge_newest');
      setSyncMeta(getCloudSyncLocalMeta());
      setRecoveryBackup(getPreSyncRecoveryBackup());
      setSyncPreview(null);
      onCloudSyncApplied?.();
      const conflictNote =
        result.diff.conflictingTransactionIds.length > 0
          ? ` Resolved ${result.diff.conflictingTransactionIds.length} edited conflict(s) using latest timestamps.`
          : '';
      setSyncMessage({
        type: 'success',
        text: `Cloud backup synced (revision #${result.revision}, ${result.snapshot.transactions.length} transactions).${conflictNote}`,
      });
    } catch (err) {
      setSyncMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to sync with cloud backup right now.',
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const handlePreviewCloudSync = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    setSyncMessage(null);
    try {
      const preview = await previewCloudSync();
      setSyncPreview(preview);
    } catch (err) {
      setSyncMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to inspect cloud backup state.',
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const handlePullCloudBackup = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    setSyncMessage(null);
    try {
      const restored = await pullAndApplyCloudBackup();
      setSyncMeta(getCloudSyncLocalMeta());
      setRecoveryBackup(getPreSyncRecoveryBackup());
      setSyncPreview(null);
      onCloudSyncApplied?.();
      setSyncMessage({
        type: 'success',
        text: `Restored cloud backup revision #${restored.revision} (${restored.snapshot.transactions.length} transactions). Pre-sync local snapshot retained for safety.`,
      });
    } catch (err) {
      setSyncMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to restore cloud backup.',
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleRestorePreviousCloud = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    setSyncMessage(null);
    try {
      const restored = await restorePreviousCloudRevision();
      setSyncMeta(getCloudSyncLocalMeta());
      setRecoveryBackup(getPreSyncRecoveryBackup());
      setSyncPreview(null);
      onCloudSyncApplied?.();
      setSyncMessage({
        type: 'success',
        text: `Rolled back to previous cloud backup revision (#${restored.revision}, ${restored.snapshot.transactions.length} transactions).`,
      });
    } catch (err) {
      setSyncMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to restore previous cloud backup.',
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleRestoreLocalPreSync = () => {
    try {
      const backup = restorePreSyncRecoveryBackup();
      setRecoveryBackup(getPreSyncRecoveryBackup());
      onCloudSyncApplied?.();
      setSyncMessage({
        type: 'info',
        text: `Restored local device data saved ${backup.reason} (${backup.snapshot.transactions.length} transactions).`,
      });
    } catch (err) {
      setSyncMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'No pre-sync local recovery backup found.',
      });
    }
  };
  const [exportStatus, setExportStatus] = useState<'success' | 'error' | 'empty' | null>(null);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportResult, setExportResult] = useState<{
    filename?: string;
    count?: number;
    errorMessage?: string;
  } | null>(null);

  // Dropdown states for country selector and currency modal
  const [isCountryOpen, setIsCountryOpen] = useState(false);
  const [countryQuery, setCountryQuery] = useState('');
  const [isCurrencyModalOpen, setIsCurrencyModalOpen] = useState(false);
  const [analyticsEnabled, setAnalyticsEnabled] = useState<boolean>(() => getAnalyticsConsent());
  const currencyButtonRef = useRef<HTMLButtonElement>(null);

  // Close dropdowns on escape & Android hardware back
  useModalBackHandler(isCountryOpen, () => setIsCountryOpen(false));

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsCountryOpen(false);
        setIsCurrencyModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const activeCountry = getCountryDetails(country || 'US');
  const activeCurrency = getCurrencyDetails(currency);

  const filteredCountries = useMemo(() => {
    const q = countryQuery.trim().toLowerCase();
    if (!q) return ISO_COUNTRIES;
    return ISO_COUNTRIES.filter(
      (c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)
    );
  }, [countryQuery]);

  const handleCountryPick = (code: string) => {
    if (onSelectCountry) {
      onSelectCountry(code);
    }
    const cObj = getCountryDetails(code);
    if (cObj && cObj.defaultCurrency) {
      onSelectCurrency(cObj.defaultCurrency);
    }
    setIsCountryOpen(false);
    setCountryQuery('');
  };

  const dateRangeInfo = useMemo(() => getTransactionsDateRange(transactions), [transactions]);

  const handleExport = () => {
    if (isExporting) return;

    if (transactions.length === 0) {
      setExportStatus('empty');
      setExportResult(null);
      return;
    }

    setIsExporting(true);
    setExportStatus(null);
    setExportResult(null);

    // Prevent duplicate clicks and provide tactile feedback
    setTimeout(() => {
      try {
        const res = exportTransactionsCSV(transactions, currency);
        if (res.success && res.filename) {
          setExportStatus('success');
          setExportResult({ filename: res.filename, count: res.recordCount });
          setTimeout(() => setExportStatus(null), 5000);
        } else {
          setExportStatus('error');
          setExportResult({ errorMessage: res.errorMessage || 'Export failed.' });
        }
      } catch (err) {
        setExportStatus('error');
        setExportResult({
          errorMessage: err instanceof Error ? err.message : 'An unexpected error occurred during export.',
        });
      } finally {
        setIsExporting(false);
      }
    }, 100);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Title */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#142D4E]">
          Settings &amp; Preferences
        </h1>
        <p className="text-xs sm:text-sm text-[#64748B] mt-0.5">
          Customize country and currency display, export your transactions, and manage preferences
        </p>
      </div>

      {/* ExpenseFlow Account & Subscription Identity Card */}
      <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4 sm:p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
              authUser ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-[#142D4E]'
            }`}>
              {authUser ? <UserCheck className="w-5 h-5" /> : <LogIn className="w-5 h-5" />}
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-[#142D4E]">
                {authUser ? 'Signed In Account' : 'ExpenseFlow Account'}
              </h2>
              {authUser ? (
                <p className="text-xs text-slate-600 mt-0.5 break-words">
                  Signed in as <strong className="text-[#142D4E]">{authUser.email || authUser.uid}</strong>. Tap <strong>Manage / Delete</strong> to view session details or permanently delete your account.
                </p>
              ) : (
                <p className="text-xs text-[#64748B] mt-0.5">
                  Optional Firebase account for future Stage 2 features. Core local expense tracking works offline without an account.
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto shrink-0">
            {authUser ? (
              <>
                <button
                  type="button"
                  onClick={() => onOpenAuth?.()}
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-[#142D4E] text-xs font-bold transition-colors min-h-[44px] cursor-pointer"
                >
                  <UserCheck className="w-3.5 h-3.5 text-teal-600" />
                  <span>Manage / Delete</span>
                </button>
                <button
                  type="button"
                  onClick={() => onSignOut?.()}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-[#142D4E] text-xs font-bold transition-colors min-h-[44px] cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sign Out</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => onOpenAuth?.()}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold shadow-xs transition-colors min-h-[44px] cursor-pointer"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Sign In / Register</span>
              </button>
            )}
          </div>
        </div>

        <div className="text-[11px] text-slate-600 bg-slate-50 px-3 py-2.5 rounded-xl border border-slate-200/80 space-y-1">
          <p>
            Your local expenses, budgets, and plans remain safely on this device regardless of whether you sign in or sign out.
          </p>
          <p>
            Need to delete an existing ExpenseFlow account? Sign in above and choose <strong>Manage / Delete</strong>, or use the standalone{' '}
            <a href="/delete-account.html" target="_blank" rel="noreferrer" className="text-teal-700 font-semibold underline">
              Web Account Deletion page
            </a>.
          </p>
        </div>
      </div>

      {/* ExpenseFlow Premium Packaging Card */}
      <div className="bg-gradient-to-br from-[#142D4E] to-[#1E3E66] rounded-2xl p-4 sm:p-6 text-white shadow-md relative overflow-hidden border border-slate-700/50">
        <div className="absolute top-0 right-0 w-64 h-64 bg-teal-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-2 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-400 text-slate-950 uppercase tracking-wider">
                <Sparkles className="w-3 h-3 fill-current" />
                {isPremium
                  ? 'Premium Active'
                  : stageAvailability.purchasesEnabled
                  ? 'Google Play Billing'
                  : 'Offline Core Mode'}
              </span>
              <span className="text-xs text-teal-200 font-semibold">$14.99/mo or $109.99/yr</span>
            </div>
            <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">
              ExpenseFlow Premium &amp; AI Suite
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 max-w-xl leading-relaxed">
              {isPremium
                ? 'Your Premium subscription is active: AI Personal Spending Coach, AI Recommendations, Advanced Cash-Flow Insights, and Multi-Device Cloud Sync are unlocked.'
                : 'Core local tracking, budgets, velocity, and CSV exports are 100% free forever. Upgrade to Premium for Gemini AI coaching, anomaly recommendations, cash-flow forecasts, and multi-device cloud backup.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenUpgrade?.()}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white text-[#142D4E] hover:bg-slate-100 font-bold text-xs shadow-sm transition-all cursor-pointer shrink-0 min-h-[44px] active:scale-[0.98]"
          >
            <span>{isPremium ? 'Manage Subscription' : 'View Premium Plans'}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Country & Currency Preferences Section */}
      <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4 sm:p-6 shadow-xs space-y-5">
        <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
          <div className="w-10 h-10 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center shrink-0">
            <Coins className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-[#142D4E]">Country &amp; Currency Preferences</h2>
            <p className="text-xs text-[#64748B] mt-0.5">
              Select your region and preferred currency. Amounts and budgets will format using this standard.
            </p>
          </div>
        </div>

        {/* Compact Selectors in a clean 2-column layout */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Country Selector */}
          <div className="relative">
            <label className="block text-xs font-bold uppercase tracking-wider text-[#142D4E] mb-2 flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-teal-600" />
              <span>Country / Region</span>
            </label>

            <button
              type="button"
              onClick={() => {
                setIsCountryOpen(true);
                setIsCurrencyModalOpen(false);
              }}
              className="w-full flex items-center justify-between p-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100/80 hover:border-slate-300 transition-all text-left focus:outline-none focus:ring-2 focus:ring-teal-600 cursor-pointer min-h-[48px]"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-base leading-none shrink-0" aria-hidden="true">
                  {getCountryFlagEmoji(country || 'US')}
                </span>
                <span className="font-mono font-bold text-xs bg-white text-teal-800 px-2 py-0.5 rounded border border-slate-200 shrink-0">
                  {country || 'US'}
                </span>
                <span className="font-semibold text-xs text-[#142D4E] truncate">
                  {activeCountry ? activeCountry.name : country}
                </span>
              </div>
              <ChevronDown
                className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${
                  isCountryOpen ? 'rotate-180 text-teal-600' : ''
                }`}
              />
            </button>

            {/* Mobile Bottom-Sheet / Centered Modal Country Picker Portal */}
            {isCountryOpen && typeof document !== 'undefined' && createPortal(
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="more-country-modal-title"
                className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150"
                onClick={() => setIsCountryOpen(false)}
              >
                <div
                  className="w-full sm:max-w-sm bg-white rounded-t-3xl sm:rounded-2xl shadow-xl border border-[#E2E8F0] overflow-hidden flex flex-col max-h-[85dvh]"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between px-4 py-3 border-b border-[#E2E8F0] bg-slate-50/70 shrink-0">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center shrink-0">
                        <Globe className="w-4 h-4" />
                      </div>
                      <h3 id="more-country-modal-title" className="text-sm font-bold text-[#142D4E]">
                        Select Country / Region
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsCountryOpen(false)}
                      className="min-w-[44px] min-h-[44px] -mr-2 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors cursor-pointer"
                      aria-label="Close country selector"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="p-3 border-b border-slate-100 bg-white shrink-0">
                    <div className="relative">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={countryQuery}
                        onFocus={scrollInputIntoViewOnFocus}
                        onChange={(e) => setCountryQuery(e.target.value)}
                        placeholder="Search country..."
                        className="w-full pl-9 pr-10 py-2.5 text-sm font-medium rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600 min-h-[44px]"
                      />
                      {countryQuery && (
                        <button
                          type="button"
                          onClick={() => setCountryQuery('')}
                          className="absolute right-1 top-1/2 -translate-y-1/2 min-w-[40px] min-h-[40px] flex items-center justify-center text-slate-400 hover:text-slate-600 cursor-pointer"
                          aria-label="Clear country search"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto overscroll-contain divide-y divide-slate-100 p-2 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] touch-pan-y">
                    {filteredCountries.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-500">
                        No countries match &ldquo;{countryQuery}&rdquo;.
                      </div>
                    ) : (
                      filteredCountries.map((c) => {
                        const isSelected = c.code === (country || 'US');
                        return (
                          <button
                            key={c.code}
                            type="button"
                            onClick={() => handleCountryPick(c.code)}
                            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left text-xs transition-colors min-h-[48px] cursor-pointer ${
                              isSelected
                                ? 'bg-teal-50 text-teal-900 font-bold'
                                : 'hover:bg-slate-50 text-[#142D4E]'
                            }`}
                          >
                            <div className="flex items-center gap-2.5 truncate">
                              <span className="text-lg shrink-0" aria-hidden="true">
                                {getCountryFlagEmoji(c.code)}
                              </span>
                              <span className="font-mono text-[11px] text-teal-700 bg-white px-1.5 py-0.5 rounded border border-slate-200 shrink-0">
                                {c.code}
                              </span>
                              <span className="truncate text-sm">{c.name}</span>
                            </div>
                            {isSelected && <Check className="w-4 h-4 text-teal-600 shrink-0 ml-2" />}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>,
              document.body
            )}
          </div>

          {/* Currency Selector */}
          <div className="relative">
            <label className="block text-xs font-bold uppercase tracking-wider text-[#142D4E] mb-2 flex items-center gap-1.5">
              <Coins className="w-3.5 h-3.5 text-teal-600" />
              <span>Active Currency</span>
            </label>

            <button
              ref={currencyButtonRef}
              type="button"
              onClick={() => {
                setIsCurrencyModalOpen((prev) => !prev);
                setIsCountryOpen(false);
              }}
              aria-label={`Change currency from ${currency}`}
              aria-expanded={isCurrencyModalOpen}
              className="w-full flex items-center justify-between p-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100/80 hover:border-slate-300 transition-all text-left focus:outline-none focus:ring-2 focus:ring-teal-600 cursor-pointer min-h-[48px]"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-base leading-none shrink-0" aria-hidden="true">
                  {getCurrencyCountryAndFlag(currency).flagEmoji}
                </span>
                <span className="font-mono font-bold text-xs bg-white text-teal-800 px-2 py-0.5 rounded border border-slate-200 shrink-0">
                  {currency}
                </span>
                <span className="font-semibold text-xs text-[#142D4E] truncate">
                  {activeCurrency ? `${activeCurrency.name} (${activeCurrency.symbol})` : currency}
                </span>
              </div>
              <ChevronDown
                className={`w-4 h-4 text-slate-400 shrink-0 transition-transform duration-200 ${
                  isCurrencyModalOpen ? 'rotate-180 text-teal-600' : ''
                }`}
              />
            </button>
          </div>
        </div>

        {/* Currency Selection Modal Reused Here with anchor */}
        <CurrencySelectorModal
          isOpen={isCurrencyModalOpen}
          onClose={() => setIsCurrencyModalOpen(false)}
          selectedCurrency={currency}
          onSelectCurrency={onSelectCurrency}
          anchorRef={currencyButtonRef}
        />

        {/* Warning / Explanation banner */}
        <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200/80 text-xs text-slate-600">
          <p className="leading-relaxed">
            Changing your currency preference updates how your numbers are formatted throughout ExpenseFlow. Your recorded numerical amounts remain unchanged and are not modified by exchange rates.
          </p>
        </div>
      </div>

      {/* CSV Export Card */}
      <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4 sm:p-6 shadow-xs space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-slate-100 text-[#142D4E] flex items-center justify-center shrink-0 border border-slate-200/60">
              <FileSpreadsheet className="w-5 h-5 text-[#142D4E]" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold text-[#142D4E]">Export Transactions</h2>
                <span className="text-[10px] font-bold uppercase tracking-wider text-teal-700 bg-teal-50 px-2 py-0.5 rounded-full border border-teal-200/80">
                  Free
                </span>
              </div>
              <p className="text-xs text-[#64748B] mt-0.5">
                Download your complete recorded financial data in universal CSV format
              </p>
            </div>
          </div>
          <span className="text-xs font-semibold text-[#142D4E] bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-lg tabular-nums shrink-0">
            {transactions.length} {transactions.length === 1 ? 'record' : 'records'}
          </span>
        </div>

        {/* Export Scope & Structure Details */}
        <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200/80 text-xs space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-slate-600">
            <span className="font-medium flex items-center gap-1.5 text-[#142D4E]">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <span>Coverage:</span>
              <strong className="font-semibold text-[#142D4E]">
                {dateRangeInfo.formattedRange}
              </strong>
            </span>
            <span className="text-[11px] text-slate-500 font-mono">
              RFC 4180 · UTF-8 (Excel &amp; Sheets ready)
            </span>
          </div>

          <div className="pt-2 border-t border-slate-200/60">
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
              Included Columns:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {['Date', 'Category', 'Amount', 'Currency', 'Payment Method', 'Notes'].map((col) => (
                <span
                  key={col}
                  className="bg-white border border-slate-200 text-slate-700 px-2 py-0.5 rounded-md text-[11px] font-medium shadow-2xs"
                >
                  {col}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Action Button & Feedback */}
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <button
              type="button"
              onClick={handleExport}
              disabled={isExporting || transactions.length === 0}
              aria-label="Export CSV"
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#142D4E] hover:bg-[#1E3E66] active:bg-[#0F233D] text-white text-sm font-semibold shadow-xs hover:shadow-sm active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#142D4E] focus-visible:ring-offset-2 transition-all min-h-[44px] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              {isExporting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>Exporting CSV...</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>Export CSV</span>
                </>
              )}
            </button>

            {transactions.length === 0 && (
              <span className="text-xs text-slate-500">
                No transactions recorded yet. Add an expense before exporting.
              </span>
            )}
          </div>

          {exportStatus === 'success' && exportResult?.filename && (
            <div
              role="status"
              className="flex items-start gap-2.5 text-xs text-emerald-900 bg-emerald-50 p-3 rounded-xl border border-emerald-200 animate-in fade-in"
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-emerald-950">File downloaded successfully</p>
                <p className="text-emerald-800 text-[11px] mt-0.5 font-mono">
                  {exportResult.filename} ({exportResult.count} {exportResult.count === 1 ? 'transaction' : 'transactions'})
                </p>
              </div>
            </div>
          )}

          {exportStatus === 'error' && (
            <div
              role="alert"
              className="flex items-start gap-2.5 text-xs text-rose-900 bg-rose-50 p-3 rounded-xl border border-rose-200 animate-in fade-in"
            >
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-rose-950">Export could not be completed</p>
                <p className="text-rose-800 text-[11px] mt-0.5">
                  {exportResult?.errorMessage || 'Please ensure file downloads are permitted in your browser settings and try again.'}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Cloud Sync & Multi-Device Backup (Premium Feature) */}
      <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4 sm:p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center shrink-0">
              <Cloud className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold text-[#142D4E]">Multi-Device Cloud Sync &amp; Backup</h2>
                <span
                  className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                    !stageAvailability.cloudSyncEnabled
                      ? 'text-slate-700 bg-slate-100 border-slate-200'
                      : isPremium
                      ? 'text-emerald-800 bg-emerald-50 border-emerald-200'
                      : 'text-amber-800 bg-amber-50 border-amber-200'
                  }`}
                >
                  {!stageAvailability.cloudSyncEnabled
                    ? 'Backend Offline'
                    : !authUser
                    ? 'Sign In Required'
                    : isPremium
                    ? 'Premium Active'
                    : 'Premium Feature'}
                </span>
              </div>
              <p className="text-xs text-[#64748B] mt-0.5">
                {syncMeta
                  ? `Last synced: ${new Date(syncMeta.lastSyncedAt).toLocaleString()} (Rev #${syncMeta.lastSyncedRevision})`
                  : 'User-scoped Firestore backup with conflict detection and local recovery snapshots'}
              </p>
            </div>
          </div>

          {!stageAvailability.cloudSyncEnabled ? (
            <button
              type="button"
              onClick={() => onOpenUpgrade?.('cloud_sync_backup')}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-[#142D4E] font-bold text-xs transition-colors cursor-pointer self-start sm:self-auto shrink-0 min-h-[44px]"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span>Plan Details</span>
            </button>
          ) : !authUser ? (
            <button
              type="button"
              onClick={() =>
                onRequireAuth?.('Sign in with your ExpenseFlow account to access Cloud Sync & Backup.')
              }
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-[#142D4E] hover:bg-[#1E3E66] text-white font-bold text-xs transition-colors cursor-pointer self-start sm:self-auto shrink-0 min-h-[44px]"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>Sign In</span>
            </button>
          ) : !isPremium ? (
            <button
              type="button"
              onClick={() => onOpenUpgrade?.('cloud_sync_backup')}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs transition-colors cursor-pointer self-start sm:self-auto shrink-0 min-h-[44px]"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Upgrade to Sync</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleCloudSmartSync}
              disabled={isSyncing}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs transition-colors cursor-pointer self-start sm:self-auto shrink-0 min-h-[44px] disabled:opacity-50"
            >
              {isSyncing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              <span>{isSyncing ? 'Syncing...' : 'Sync Now'}</span>
            </button>
          )}
        </div>

        {!stageAvailability.cloudSyncEnabled ? (
          <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 text-xs text-slate-600 space-y-2">
            <p className="leading-relaxed">{stageAvailability.cloudSyncReason}</p>
            <p className="text-[11px] text-slate-500">
              Use the <strong>Universal CSV Export</strong> above anytime for 100% free local backups.
            </p>
          </div>
        ) : authUser && isPremium ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handlePreviewCloudSync}
                disabled={isSyncing}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-[#142D4E] text-xs font-semibold min-h-[44px] cursor-pointer disabled:opacity-50"
              >
                <Cloud className="w-3.5 h-3.5 text-teal-700" />
                <span>Inspect Cloud &amp; Conflicts</span>
              </button>
              {recoveryBackup && (
                <button
                  type="button"
                  onClick={handleRestoreLocalPreSync}
                  disabled={isSyncing}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-950 text-xs font-semibold min-h-[44px] cursor-pointer disabled:opacity-50"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Undo Last Sync ({recoveryBackup.snapshot.transactions.length} tx)</span>
                </button>
              )}
            </div>

            {syncPreview && (
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-700 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-[#142D4E]">
                    Cloud Revision #{syncPreview.remote.revision}
                    {syncPreview.remote.updatedAt
                      ? ` · ${new Date(syncPreview.remote.updatedAt).toLocaleString()}`
                      : ' (No cloud backup yet)'}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Local: {syncPreview.local.transactions.length} tx · Cloud:{' '}
                    {syncPreview.remote.snapshot?.transactions.length ?? 0} tx · Merged:{' '}
                    {syncPreview.diff.combinedCount} tx
                  </span>
                </div>
                {syncPreview.diff.conflictingTransactionIds.length > 0 && (
                  <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                    {syncPreview.diff.conflictingTransactionIds.length} transaction(s) differ between this device and cloud. Smart Sync keeps the newest edit timestamp and saves a pre-sync local recovery snapshot.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleCloudSmartSync}
                    disabled={isSyncing}
                    className="px-3 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs cursor-pointer min-h-[40px]"
                  >
                    Smart Merge &amp; Upload
                  </button>
                  {syncPreview.remote.snapshot && (
                    <button
                      type="button"
                      onClick={handlePullCloudBackup}
                      disabled={isSyncing}
                      className="px-3 py-2 rounded-lg bg-white hover:bg-slate-100 border border-slate-300 text-[#142D4E] font-semibold text-xs cursor-pointer min-h-[40px]"
                    >
                      Restore Cloud Snapshot to Device
                    </button>
                  )}
                  {syncPreview.remote.hasPreviousBackup && (
                    <button
                      type="button"
                      onClick={handleRestorePreviousCloud}
                      disabled={isSyncing}
                      className="px-3 py-2 rounded-lg bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 font-semibold text-xs cursor-pointer min-h-[40px]"
                    >
                      Rollback Cloud to Rev #{syncPreview.remote.previousRevision}
                    </button>
                  )}
                </div>
              </div>
            )}

            {syncMessage && (
              <div
                role="status"
                className={`p-3 rounded-xl border text-xs flex items-start gap-2 ${
                  syncMessage.type === 'success'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : syncMessage.type === 'info'
                    ? 'bg-slate-50 border-slate-200 text-slate-800'
                    : 'bg-rose-50 border-rose-200 text-rose-900'
                }`}
              >
                {syncMessage.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                )}
                <span>{syncMessage.text}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 text-xs text-slate-600 space-y-1.5">
            <p className="leading-relaxed">
              {!authUser
                ? 'Sign in with your ExpenseFlow account to access user-scoped Cloud Sync & Backup.'
                : 'Cloud Sync is gated server-side by an active ExpenseFlow Premium subscription so your backups stay isolated to your verified account.'}
            </p>
            <p className="text-[11px] text-slate-500">
              Your local data remains 100% private on this device and can be exported via CSV anytime.
            </p>
          </div>
        )}
      </div>

      {/* Data Storage & Privacy Card */}
      <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4 sm:p-6 shadow-xs space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <h2 className="text-base font-bold text-[#142D4E]">Data Storage &amp; Privacy</h2>
        </div>

        <div className="p-4 bg-slate-50 rounded-xl border border-slate-20 text-xs sm:text-sm text-[#142D4E] leading-relaxed">
          <p className="font-medium">
            Your expenses, budgets, and plans remain stored locally on this device by default. Cloud Sync uploads snapshots only when you explicitly sync with an active Premium account.
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 p-3.5 rounded-xl border border-slate-200 bg-white">
          <div className="min-w-0">
            <p className="text-xs font-bold text-[#142D4E]">Anonymous Usage Analytics</p>
            <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
              Optional Firebase Analytics event counts (never logs amounts, notes, or personal data).
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={analyticsEnabled}
            aria-label="Toggle anonymous usage analytics"
            onClick={() => {
              const next = !analyticsEnabled;
              setAnalyticsConsent(next);
              setAnalyticsEnabled(next);
            }}
            className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-teal-600 ${
              analyticsEnabled ? 'bg-teal-600' : 'bg-slate-300'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-xs transition-transform ${
                analyticsEnabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        <div className="pt-2 flex flex-wrap items-center gap-3 border-t border-slate-100">
          {onOpenPrivacyPolicy && (
            <button
              type="button"
              onClick={onOpenPrivacyPolicy}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-[#142D4E] font-bold text-xs transition-colors min-h-[44px] cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5 text-teal-600" />
              <span>Read Full Privacy Policy</span>
            </button>
          )}
          <a
            href="/privacy.html"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-slate-500 hover:text-slate-800 underline min-h-[44px] inline-flex items-center px-1"
          >
            Public Policy (Web)
          </a>
        </div>
      </div>
    </div>
  );
};
