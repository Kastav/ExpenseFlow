import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CurrencyCode } from '../types/expense';
import {
  ISO_COUNTRIES,
  getCountryDetails,
  getCurrencyDetails,
  detectInitialCountryAndCurrency,
  getCountryFlagEmoji,
  getCurrencyCountryAndFlag,
} from '../data/geoCurrencies';
import {
  Globe,
  Coins,
  Search,
  Check,
  ChevronDown,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  X,
} from 'lucide-react';
import { CurrencySelectorModal } from './CurrencySelectorModal';
import { useModalBackHandler, scrollInputIntoViewOnFocus } from '../utils/backNavigation';

interface OnboardingModalProps {
  isOpen: boolean;
  onComplete: (selectedCountry: string, selectedCurrency: CurrencyCode) => void;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  isOpen,
  onComplete,
}) => {
  // Soft detection on initial load without prompt or GPS
  const [initialDetection] = useState(() => detectInitialCountryAndCurrency());

  const [selectedCountryCode, setSelectedCountryCode] = useState<string>(
    initialDetection.countryCode
  );
  const [selectedCurrencyCode, setSelectedCurrencyCode] = useState<CurrencyCode>(
    initialDetection.currencyCode
  );

  // Search filter states
  const [countrySearch, setCountrySearch] = useState('');
  const [isCountryDropdownOpen, setIsCountryDropdownOpen] = useState(false);
  const [isCurrencyModalOpen, setIsCurrencyModalOpen] = useState(false);
  const currencyButtonRef = useRef<HTMLButtonElement>(null);
  const countrySearchRef = useRef<HTMLInputElement>(null);

  useModalBackHandler(isOpen && isCountryDropdownOpen, () => setIsCountryDropdownOpen(false));

  useEffect(() => {
    if (isCountryDropdownOpen && typeof window !== 'undefined' && window.innerWidth >= 768) {
      requestAnimationFrame(() => countrySearchRef.current?.focus({ preventScroll: true }));
    }
  }, [isCountryDropdownOpen]);

  // Close dropdown on click outside / esc
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsCountryDropdownOpen(false);
        setIsCurrencyModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Filtered countries
  const filteredCountries = useMemo(() => {
    const query = countrySearch.trim().toLowerCase();
    if (!query) return ISO_COUNTRIES;
    return ISO_COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(query) ||
        c.code.toLowerCase().includes(query)
    );
  }, [countrySearch]);

  // When a country is chosen, automatically set the default currency for that country
  const handleSelectCountry = (countryCode: string) => {
    setSelectedCountryCode(countryCode);
    setIsCountryDropdownOpen(false);
    setCountrySearch('');

    const country = getCountryDetails(countryCode);
    if (country && country.defaultCurrency) {
      setSelectedCurrencyCode(country.defaultCurrency);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCountryCode || !selectedCurrencyCode) return;
    onComplete(selectedCountryCode, selectedCurrencyCode);
  };

  if (!isOpen) return null;

  const activeCountry = getCountryDetails(selectedCountryCode);
  const activeCurrency = getCurrencyDetails(selectedCurrencyCode);
  const isFormValid = Boolean(selectedCountryCode && selectedCurrencyCode);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-modal-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in overflow-hidden"
    >
      <div className="bg-white rounded-t-3xl sm:rounded-3xl max-w-lg w-full p-5 sm:p-8 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] sm:pb-8 shadow-2xl border border-[#E2E8F0] flex flex-col max-h-[92dvh] overflow-y-auto overscroll-contain">
        {/* Header Badge */}
        <div className="flex items-center gap-2 mb-3">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 text-[#142D4E] text-xs font-semibold border border-slate-200">
            <Sparkles className="w-3.5 h-3.5 text-[#142D4E]" />
            <span>Quick Setup</span>
          </div>
        </div>

        {/* Heading & Subtitle */}
        <div className="mb-6">
          <h1
            id="onboarding-modal-title"
            className="text-2xl sm:text-3xl font-extrabold text-[#142D4E] tracking-tight"
          >
            Personalize your experience
          </h1>
          <p className="text-sm text-[#64748B] mt-1.5 leading-relaxed">
            Select your country or territory and preferred currency
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Country Selection */}
          <div className="relative">
            <label className="block text-xs font-bold uppercase tracking-wider text-[#142D4E] mb-2 flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-[#142D4E]" />
              <span>Country or Territory</span>
            </label>

            {/* Selector Trigger Button */}
            <button
              type="button"
              onClick={() => {
                setIsCountryDropdownOpen((prev) => !prev);
                setIsCurrencyModalOpen(false);
              }}
              className="w-full min-h-[48px] flex items-center justify-between p-3.5 rounded-xl border border-[#E2E8F0] bg-slate-50 hover:bg-slate-100/80 hover:border-slate-300 transition-all text-left focus:outline-none focus:ring-2 focus:ring-[#142D4E] cursor-pointer"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-xl shrink-0" aria-hidden="true">
                  {getCountryFlagEmoji(selectedCountryCode)}
                </span>
                <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded bg-white border border-[#E2E8F0] font-mono font-bold text-xs text-[#142D4E] shrink-0">
                  {selectedCountryCode}
                </span>
                <span className="font-semibold text-sm text-[#142D4E] truncate">
                  {activeCountry ? activeCountry.name : 'Select Country'}
                </span>
              </div>
              <ChevronDown
                className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${
                  isCountryDropdownOpen ? 'rotate-180 text-[#142D4E]' : ''
                }`}
              />
            </button>

            {/* Country Picker Bottom-Sheet / Centered Modal via Portal */}
            {isCountryDropdownOpen &&
              typeof document !== 'undefined' &&
              createPortal(
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-label="Select country or territory"
                  className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150 overflow-hidden"
                  onClick={() => setIsCountryDropdownOpen(false)}
                >
                  <div
                    className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl shadow-xl border border-[#E2E8F0] overflow-hidden flex flex-col max-h-[85dvh]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[#E2E8F0] bg-slate-50/50 shrink-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <Globe className="w-4 h-4 text-[#142D4E] shrink-0" />
                        <span className="text-sm font-bold text-[#142D4E] truncate">Select Country / Territory</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsCountryDropdownOpen(false)}
                        aria-label="Close country picker"
                        className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer shrink-0"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    <div className="p-3 border-b border-slate-100 bg-white shrink-0">
                      <div className="relative">
                        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          ref={countrySearchRef}
                          type="text"
                          value={countrySearch}
                          onFocus={scrollInputIntoViewOnFocus}
                          onChange={(e) => setCountrySearch(e.target.value)}
                          placeholder="Search country name or 2-letter code..."
                          className="w-full min-h-[44px] pl-9 pr-11 py-2 text-sm sm:text-xs font-medium rounded-xl border border-[#E2E8F0] bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#142D4E]"
                        />
                        {countrySearch && (
                          <button
                            type="button"
                            onClick={() => setCountrySearch('')}
                            aria-label="Clear country search"
                            className="absolute right-1 top-1/2 -translate-y-1/2 min-w-[40px] min-h-[40px] flex items-center justify-center text-slate-400 hover:text-slate-600 cursor-pointer"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex-1 overflow-y-auto overscroll-contain divide-y divide-slate-100 p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] touch-pan-y">
                      {filteredCountries.length === 0 ? (
                        <div className="p-6 text-center text-xs text-slate-500">
                          No country found matching &ldquo;{countrySearch}&rdquo;
                        </div>
                      ) : (
                        filteredCountries.map((c) => {
                          const isSelected = c.code === selectedCountryCode;
                          return (
                            <button
                              key={c.code}
                              type="button"
                              onClick={() => handleSelectCountry(c.code)}
                              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left text-xs transition-colors cursor-pointer min-h-[48px] ${
                                isSelected
                                  ? 'bg-slate-100 text-[#142D4E] font-bold'
                                  : 'hover:bg-slate-50 text-[#142D4E]'
                              }`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <span className="text-lg shrink-0" aria-hidden="true">
                                  {getCountryFlagEmoji(c.code)}
                                </span>
                                <span className="font-mono font-bold text-[11px] text-[#142D4E] bg-white px-1.5 py-0.5 rounded border border-[#E2E8F0] shrink-0">
                                  {c.code}
                                </span>
                                <span className="truncate font-medium text-sm">{c.name}</span>
                              </div>
                              {isSelected && (
                                <Check className="w-4 h-4 text-[#142D4E] shrink-0 ml-2" />
                              )}
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

          {/* Currency Selection */}
          <div className="relative">
            <label className="block text-xs font-bold uppercase tracking-wider text-[#142D4E] mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Coins className="w-3.5 h-3.5 text-[#142D4E]" />
                <span>Preferred Currency</span>
              </span>
              <span className="text-[11px] font-normal text-slate-500">
                (can be updated anytime)
              </span>
            </label>

            {/* Currency Selector Trigger */}
            <button
              ref={currencyButtonRef}
              type="button"
              onClick={() => {
                setIsCurrencyModalOpen((prev) => !prev);
                setIsCountryDropdownOpen(false);
              }}
              aria-label="Select currency"
              aria-expanded={isCurrencyModalOpen}
              className="w-full min-h-[48px] flex items-center justify-between p-3.5 rounded-xl border border-[#E2E8F0] bg-slate-50 hover:bg-slate-100/80 hover:border-slate-300 transition-all text-left focus:outline-none focus:ring-2 focus:ring-[#142D4E] cursor-pointer"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="text-xl shrink-0" aria-hidden="true">
                  {getCurrencyCountryAndFlag(selectedCurrencyCode).flagEmoji}
                </span>
                <span className="inline-flex items-center justify-center px-2 py-1 rounded-lg bg-white border border-[#E2E8F0] font-extrabold text-xs text-[#142D4E] shrink-0">
                  {selectedCurrencyCode}
                </span>
                <span className="font-semibold text-sm text-[#142D4E] truncate">
                  {activeCurrency
                    ? `${activeCurrency.name} (${activeCurrency.symbol})`
                    : selectedCurrencyCode}
                </span>
              </div>
              <ChevronDown
                className={`w-4 h-4 text-slate-400 shrink-0 transition-transform duration-200 ${
                  isCurrencyModalOpen ? 'rotate-180 text-teal-600' : ''
                }`}
              />
            </button>

            {/* Reusable Currency Selection Modal with Anchor */}
            <CurrencySelectorModal
              isOpen={isCurrencyModalOpen}
              onClose={() => setIsCurrencyModalOpen(false)}
              selectedCurrency={selectedCurrencyCode}
              onSelectCurrency={(code) => setSelectedCurrencyCode(code)}
              anchorRef={currencyButtonRef}
            />
          </div>

          {/* Dedicated Selection Summary Card */}
          <div className="rounded-2xl p-4 bg-slate-50 border border-[#E2E8F0]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Selection Summary
              </span>
              <span className="text-xs text-slate-400 font-mono">
                {selectedCountryCode} • {selectedCurrencyCode}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-2xl leading-none" aria-hidden="true">
                  {getCountryFlagEmoji(selectedCountryCode)}
                </span>
                <div className="min-w-0">
                  <p className="font-bold text-sm text-[#142D4E] truncate">
                    {activeCountry ? activeCountry.name : selectedCountryCode}
                  </p>
                  <p className="text-xs text-slate-500 truncate">
                    {activeCurrency ? activeCurrency.name : selectedCurrencyCode}
                  </p>
                </div>
              </div>
              <div className="text-right shrink-0">
                <span className="inline-block px-2.5 py-1 rounded-lg bg-slate-100 text-[#142D4E] font-extrabold text-sm border border-slate-200">
                  {activeCurrency?.symbol || ''} {selectedCurrencyCode}
                </span>
              </div>
            </div>
          </div>

          {/* Privacy & Storage Explainer */}
          <div className="rounded-2xl p-3.5 bg-slate-50/60 border border-slate-200/70 text-xs text-slate-600 flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-[#142D4E] shrink-0 mt-0.5" />
            <p className="leading-relaxed text-[11px] text-slate-600">
              Stored securely on this device in your browser. No remote servers, account creation, or cloud sync required.
            </p>
          </div>

          {/* Confirm Button */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={!isFormValid}
              className="w-full flex items-center justify-center gap-2 py-3.5 px-5 rounded-xl bg-[#142D4E] hover:bg-[#1E3E66] disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm shadow-md hover:shadow-lg active:scale-[0.99] transition-all cursor-pointer min-h-[48px]"
            >
              <span>Continue</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
