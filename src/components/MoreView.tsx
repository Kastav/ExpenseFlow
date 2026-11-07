import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Expense, CurrencyCode } from '../types/expense';
import {
  ISO_COUNTRIES,
  ISO_CURRENCIES,
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
  Bot,
  ArrowRight,
  FileText,
} from 'lucide-react';
import { PremiumFeatureId } from '../types/premium';

interface MoreViewProps {
  transactions: Expense[];
  currency: CurrencyCode;
  onSelectCurrency: (currency: CurrencyCode) => void;
  country?: string | null;
  onSelectCountry?: (countryCode: string) => void;
  onOpenUpgrade?: (feature?: PremiumFeatureId) => void;
  onOpenPrivacyPolicy?: () => void;
}

export const MoreView: React.FC<MoreViewProps> = ({
  transactions,
  currency,
  onSelectCurrency,
  country = 'US',
  onSelectCountry,
  onOpenUpgrade,
  onOpenPrivacyPolicy,
}) => {
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
  const currencyButtonRef = useRef<HTMLButtonElement>(null);

  // Close dropdowns on escape
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
    <div className="space-y-6 pb-20 md:pb-8 max-w-4xl">
      {/* Title */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[#142D4E]">
          Settings & Preferences
        </h1>
        <p className="text-sm text-[#64748B] mt-0.5">
          Customize country and currency display, export your transactions, and manage preferences
        </p>
      </div>

      {/* ExpenseFlow Premium Packaging Card */}
      <div className="bg-gradient-to-br from-[#142D4E] to-[#1E3E66] rounded-2xl p-5 sm:p-6 text-white shadow-md relative overflow-hidden border border-slate-700/50">
        <div className="absolute top-0 right-0 w-64 h-64 bg-teal-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-400 text-slate-950 uppercase tracking-wider">
                <Sparkles className="w-3 h-3 fill-current" />
                Premium Tier
              </span>
              <span className="text-xs text-teal-200 font-semibold">$14.99/mo or $109.99/yr</span>
            </div>
            <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">
              ExpenseFlow Premium Packaging &amp; AI
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 max-w-xl leading-relaxed">
              Core local tracking, budgets, velocity, and CSV exports remain <strong>100% free forever</strong>. Ongoing cost-incurring features—including the upcoming AI Personal Spending Coach, automated recommendations, and multi-device cloud sync—are strictly Premium.
            </p>
          </div>

          <button
            type="button"
            onClick={() => onOpenUpgrade?.()}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white text-[#142D4E] hover:bg-slate-100 font-bold text-xs shadow-sm transition-all cursor-pointer self-start sm:self-auto shrink-0 active:scale-[0.98]"
          >
            <span>Explore Premium Plans</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Country & Currency Preferences Section */}
      <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 sm:p-6 shadow-xs space-y-5">
        <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
          <div className="w-10 h-10 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center shrink-0">
            <Coins className="w-5 h-5" />
          </div>
          <div>
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
                setIsCountryOpen((prev) => !prev);
                setIsCurrencyModalOpen(false);
              }}
              className="w-full flex items-center justify-between p-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100/80 hover:border-slate-300 transition-all text-left focus:outline-none focus:ring-2 focus:ring-teal-600 cursor-pointer"
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

            {isCountryOpen && (
              <div className="absolute z-20 left-0 right-0 mt-2 bg-white rounded-2xl border border-slate-200 shadow-xl p-2.5 space-y-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={countryQuery}
                    onChange={(e) => setCountryQuery(e.target.value)}
                    placeholder="Search country..."
                    autoFocus
                    className="w-full pl-8 pr-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>
                <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 rounded-lg">
                  {filteredCountries.map((c) => {
                    const isSelected = c.code === (country || 'US');
                    return (
                      <button
                        key={c.code}
                        type="button"
                        onClick={() => handleCountryPick(c.code)}
                        className={`w-full flex items-center justify-between px-2.5 py-2 text-left text-xs transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-teal-50 text-teal-900 font-bold'
                            : 'hover:bg-slate-50 text-[#142D4E]'
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate">
                          <span className="text-base shrink-0" aria-hidden="true">
                            {getCountryFlagEmoji(c.code)}
                          </span>
                          <span className="font-mono text-[10px] text-teal-700 bg-white px-1 py-0.2 rounded border border-slate-200">
                            {c.code}
                          </span>
                          <span className="truncate">{c.name}</span>
                        </div>
                        {isSelected && <Check className="w-3.5 h-3.5 text-teal-600 shrink-0 ml-2" />}
                      </button>
                    );
                  })}
                </div>
              </div>
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
              className="w-full flex items-center justify-between p-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100/80 hover:border-slate-300 transition-all text-left focus:outline-none focus:ring-2 focus:ring-teal-600 cursor-pointer"
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
      <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 sm:p-6 shadow-xs space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-100 text-[#142D4E] flex items-center justify-center shrink-0 border border-slate-200/60">
              <FileSpreadsheet className="w-5 h-5 text-[#142D4E]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
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

      {/* Cloud Sync & Multi-Device Backup (Premium Feature Notice) */}
      <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center shrink-0">
              <Cloud className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-[#142D4E]">Multi-Device Cloud Sync</h2>
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                  Premium
                </span>
              </div>
              <p className="text-xs text-[#64748B] mt-0.5">
                Seamless encrypted database sync across phone, tablet, and desktop
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onOpenUpgrade?.('cloud_sync_backup')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-[#142D4E] font-bold text-xs transition-colors cursor-pointer self-start sm:self-auto shrink-0"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span>Learn More</span>
          </button>
        </div>

        <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 text-xs text-slate-600 space-y-2">
          <p className="leading-relaxed">
            Multi-device cloud synchronization requires continuous database infrastructure and encryption services, making it an ongoing cost-incurring feature reserved for <strong>ExpenseFlow Premium</strong>.
          </p>
          <p className="text-[11px] text-slate-500">
            For users who prefer zero-cost local storage, the <strong>Universal CSV Export</strong> above will always remain 100% free with unlimited downloads.
          </p>
        </div>
      </div>

      {/* Data Storage & Privacy Card */}
      <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 sm:p-6 shadow-xs space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <h2 className="text-base font-bold text-[#142D4E]">Data Storage & Privacy</h2>
        </div>

        <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs sm:text-sm text-[#142D4E] leading-relaxed">
          <p className="font-medium">
            Your financial data is stored in this browser on this device. Clearing browser data or switching devices may cause you to lose your saved transactions.
          </p>
        </div>

        <p className="text-xs text-slate-500 leading-normal">
          All recorded transactions, budgets, and plans remain stored locally in your browser.
        </p>

        <div className="pt-2 flex flex-wrap items-center gap-3 border-t border-slate-100">
          {onOpenPrivacyPolicy && (
            <button
              type="button"
              onClick={onOpenPrivacyPolicy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-[#142D4E] font-bold text-xs transition-colors cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5 text-teal-600" />
              <span>Read Full Privacy Policy</span>
            </button>
          )}
          <a
            href="/privacy.html"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-slate-500 hover:text-slate-800 underline"
          >
            Public Policy (Web)
          </a>
        </div>
      </div>
    </div>
  );
};
