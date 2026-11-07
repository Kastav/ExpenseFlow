import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { CurrencyCode } from '../types/expense';
import {
  getRichCurrenciesList,
  RichCurrencyItem,
  getCurrencyCountryAndFlag,
  getCurrencyDetails,
} from '../data/geoCurrencies';
import { Search, X, Check, Globe, Info } from 'lucide-react';

interface CurrencySelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedCurrency: CurrencyCode;
  onSelectCurrency: (currency: CurrencyCode) => void;
  anchorRef?: React.RefObject<HTMLElement | null>;
}

const POPULAR_CURRENCY_CODES = [
  'USD',
  'EUR',
  'GBP',
  'INR',
  'CAD',
  'AUD',
  'JPY',
  'CHF',
  'SGD',
  'AED',
];

interface PopoverCoordinates {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

export const CurrencySelectorModal: React.FC<CurrencySelectorModalProps> = ({
  isOpen,
  onClose,
  selectedCurrency,
  onSelectCurrency,
  anchorRef,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [popoverCoords, setPopoverCoords] = useState<PopoverCoordinates | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Position calculation for anchored popover mode
  const updatePosition = useCallback(() => {
    if (!anchorRef?.current) {
      setPopoverCoords(null);
      return;
    }

    const rect = anchorRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Compact width: up to 330px, constrained on narrow mobile (e.g. 320px viewport -> 296px width)
    const popoverWidth = Math.min(330, viewportWidth - 24);

    // Prefer right-aligning with the anchor button so it drops neatly from the right side of header
    let left = rect.right - popoverWidth;

    // Constrain left within viewport padding (minimum 12px from left, 12px from right)
    if (left < 12) {
      left = 12;
    }
    if (left + popoverWidth > viewportWidth - 12) {
      left = viewportWidth - popoverWidth - 12;
    }

    // Default position: directly below the button with a 6px gap
    let top = rect.bottom + 6;

    // Calculate available vertical space below the anchor
    const availableHeightBelow = viewportHeight - top - 12;
    let maxHeight = Math.min(460, Math.max(220, availableHeightBelow));

    // If space below is extremely cramped (< 220px) and space above is larger, flip above
    if (availableHeightBelow < 220 && rect.top > availableHeightBelow) {
      const availableHeightAbove = rect.top - 12;
      maxHeight = Math.min(460, availableHeightAbove);
      top = Math.max(12, rect.top - maxHeight - 6);
    }

    setPopoverCoords({
      top,
      left,
      width: popoverWidth,
      maxHeight,
    });
  }, [anchorRef]);

  // Recalculate position on open, scroll, or resize
  useEffect(() => {
    if (!isOpen) return;

    if (anchorRef) {
      updatePosition();
      const handleScrollOrResize = () => updatePosition();
      window.addEventListener('resize', handleScrollOrResize);
      window.addEventListener('scroll', handleScrollOrResize, true);

      return () => {
        window.removeEventListener('resize', handleScrollOrResize);
        window.removeEventListener('scroll', handleScrollOrResize, true);
      };
    }
  }, [isOpen, anchorRef, updatePosition]);

  // Handle ESC key press
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Focus search input smoothly without causing browser scroll jumps
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        searchInputRef.current?.focus({ preventScroll: true });
      }, 50);
      return () => clearTimeout(timer);
    } else {
      setSearchQuery('');
    }
  }, [isOpen]);

  const allCurrencies = useMemo(() => getRichCurrenciesList(), []);

  const filteredCurrencies = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return allCurrencies;
    return allCurrencies.filter(
      (c) =>
        c.code.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.symbol.toLowerCase().includes(q) ||
        c.countryName.toLowerCase().includes(q)
    );
  }, [allCurrencies, searchQuery]);

  const popularCurrencies = useMemo(() => {
    return POPULAR_CURRENCY_CODES.map((code) => {
      const found = allCurrencies.find((c) => c.code === code);
      if (found) return found;
      const details = getCurrencyDetails(code);
      const geo = getCurrencyCountryAndFlag(code);
      return {
        code,
        name: details?.name || code,
        symbol: details?.symbol || code,
        decimalDigits: details?.decimalDigits ?? 2,
        countryCode: geo.countryCode,
        countryName: geo.countryName,
        flagEmoji: geo.flagEmoji,
      };
    });
  }, [allCurrencies]);

  if (!isOpen || typeof document === 'undefined') return null;

  const handlePick = (code: string) => {
    onSelectCurrency(code as CurrencyCode);
    onClose();
  };

  // 1. Anchored Popover Mode (when anchorRef is provided and coordinates computed)
  if (anchorRef && popoverCoords) {
    return createPortal(
      <>
        {/* Subtle backdrop for outside-click dismissal and blocking background scroll */}
        <div
          className="fixed inset-0 z-[89] bg-slate-900/10 transition-opacity animate-in fade-in duration-100"
          onClick={onClose}
          onWheel={(e) => e.preventDefault()}
          onTouchMove={(e) => e.preventDefault()}
          aria-hidden="true"
        />

        {/* Compact Floating Anchored Panel */}
        <div
          ref={popoverRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="currency-popover-title"
          style={{
            position: 'fixed',
            top: `${popoverCoords.top}px`,
            left: `${popoverCoords.left}px`,
            width: `${popoverCoords.width}px`,
            maxHeight: `${popoverCoords.maxHeight}px`,
          }}
          className="z-[90] bg-white rounded-2xl shadow-xl border border-[#E2E8F0] overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-100"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-[#E2E8F0] bg-slate-50/70 shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-teal-50 text-teal-600 flex items-center justify-center shrink-0">
                <Globe className="w-3.5 h-3.5" />
              </div>
              <div>
                <h2 id="currency-popover-title" className="text-xs font-bold text-[#142D4E] leading-tight">
                  Select Currency
                </h2>
                <p className="text-[10px] text-[#64748B] leading-none mt-0.5">
                  Display formatting only
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              type="button"
              className="w-6 h-6 flex items-center justify-center rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors cursor-pointer"
              aria-label="Close currency menu"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Search Input inside Popover */}
          <div className="p-2.5 border-b border-slate-100 bg-white shrink-0">
            <div className="relative w-full">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search code, name, country..."
                className="w-full pl-8 pr-7 py-1.5 text-xs font-medium rounded-xl border border-[#E2E8F0] bg-slate-50 focus:bg-white focus:outline-none focus:border-teal-600 focus:ring-1 focus:ring-teal-100 transition-all shadow-2xs"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    searchInputRef.current?.focus({ preventScroll: true });
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                  aria-label="Clear search"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Quick Popular Pills (Shown when no search query) */}
            {!searchQuery && (
              <div className="mt-2 pt-2 border-t border-slate-100">
                <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                  Popular
                </span>
                <div className="flex flex-wrap gap-1">
                  {popularCurrencies.map((c) => {
                    const isSelected = c.code === selectedCurrency;
                    return (
                      <button
                        key={c.code}
                        type="button"
                        onClick={() => handlePick(c.code)}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold transition-all cursor-pointer min-h-[26px] ${
                          isSelected
                            ? 'bg-teal-600 text-white shadow-2xs'
                            : 'bg-slate-100 hover:bg-slate-200 text-[#142D4E] border border-slate-200/60'
                        }`}
                      >
                        <span className="text-xs" aria-hidden="true">
                          {c.flagEmoji}
                        </span>
                        <span>{c.code}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Vertically Scrollable Currency List */}
          <div className="flex-1 overflow-y-auto overscroll-contain divide-y divide-slate-100 p-1.5 touch-pan-y">
            {filteredCurrencies.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                No currencies match &ldquo;{searchQuery}&rdquo;.
              </div>
            ) : (
              filteredCurrencies.map((curr: RichCurrencyItem) => {
                const isSelected = curr.code === selectedCurrency;
                return (
                  <button
                    key={curr.code}
                    type="button"
                    onClick={() => handlePick(curr.code)}
                    className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left transition-all cursor-pointer min-h-[44px] ${
                      isSelected
                        ? 'bg-teal-50 border border-teal-200/80 text-teal-950 font-bold'
                        : 'hover:bg-slate-50 border border-transparent text-[#142D4E] font-medium'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {/* Flag Emoji */}
                      <span className="text-xl leading-none shrink-0" aria-hidden="true">
                        {curr.flagEmoji}
                      </span>

                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          {/* 3-letter ISO Code */}
                          <span
                            className={`font-mono font-bold text-[11px] px-1 py-0.2 rounded border shrink-0 ${
                              isSelected
                                ? 'bg-white border-teal-300 text-teal-800'
                                : 'bg-slate-100 border-slate-200 text-[#142D4E]'
                            }`}
                          >
                            {curr.code}
                          </span>

                          {/* Country / Region Name */}
                          <span className="text-xs font-semibold text-[#142D4E] truncate max-w-[140px] sm:max-w-[160px]">
                            {curr.countryName}
                          </span>
                        </div>

                        {/* Currency Full Name & Symbol */}
                        <p className="text-[10px] text-[#64748B] truncate mt-0.5">
                          {curr.name} · <strong className="font-semibold text-slate-700">{curr.symbol}</strong>
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 ml-1.5">
                      <span className="font-bold text-xs text-[#142D4E] bg-white px-1.5 py-0.5 rounded border border-slate-200 shadow-2xs">
                        {curr.symbol}
                      </span>
                      {isSelected && (
                        <div className="w-4 h-4 rounded-full bg-teal-600 text-white flex items-center justify-center shrink-0">
                          <Check className="w-3 h-3 stroke-[3]" />
                        </div>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Compact Footnote */}
          <div className="p-2 bg-slate-50 border-t border-slate-100 text-[10px] text-slate-500 flex items-center gap-1.5 shrink-0">
            <Info className="w-3 h-3 text-slate-400 shrink-0" />
            <span className="leading-tight truncate">
              Format updates only. Existing amounts remain unchanged.
            </span>
          </div>
        </div>
      </>,
      document.body
    );
  }

  // 2. Centered Modal Fallback Mode (when no anchorRef provided, rendered via Portal to avoid stacking/clipping bugs)
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="currency-modal-title"
      className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-white rounded-2xl shadow-xl border border-[#E2E8F0] overflow-hidden my-auto flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#E2E8F0] bg-slate-50/50">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center shrink-0">
              <Globe className="w-3.5 h-3.5" />
            </div>
            <div>
              <h2 id="currency-modal-title" className="text-sm font-bold text-[#142D4E]">
                Select Currency
              </h2>
              <p className="text-[10px] text-[#64748B]">
                Choose display currency
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            type="button"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
            aria-label="Close currency modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search Input */}
        <div className="p-3 border-b border-slate-100 bg-white">
          <div className="relative w-full">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search currency, code, or country..."
              className="w-full pl-8 pr-7 py-2 text-xs font-medium rounded-xl border border-[#E2E8F0] bg-slate-50 focus:bg-white focus:outline-none focus:border-teal-600 focus:ring-1 focus:ring-teal-100 transition-all shadow-2xs"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  searchInputRef.current?.focus({ preventScroll: true });
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {!searchQuery && (
            <div className="mt-2.5">
              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                Popular Currencies
              </span>
              <div className="flex flex-wrap gap-1">
                {popularCurrencies.map((c) => {
                  const isSelected = c.code === selectedCurrency;
                  return (
                    <button
                      key={c.code}
                      type="button"
                      onClick={() => handlePick(c.code)}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold transition-all cursor-pointer min-h-[26px] ${
                        isSelected
                          ? 'bg-teal-600 text-white shadow-2xs'
                          : 'bg-slate-100 hover:bg-slate-200 text-[#142D4E] border border-slate-200/60'
                      }`}
                    >
                      <span className="text-xs" aria-hidden="true">
                        {c.flagEmoji}
                      </span>
                      <span>{c.code}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Currency List */}
        <div className="flex-1 overflow-y-auto overscroll-contain divide-y divide-slate-100 p-1.5 max-h-[50vh] touch-pan-y">
          {filteredCurrencies.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              No currencies match &ldquo;{searchQuery}&rdquo;.
            </div>
          ) : (
            filteredCurrencies.map((curr: RichCurrencyItem) => {
              const isSelected = curr.code === selectedCurrency;
              return (
                <button
                  key={curr.code}
                  type="button"
                  onClick={() => handlePick(curr.code)}
                  className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left transition-all cursor-pointer min-h-[44px] ${
                    isSelected
                      ? 'bg-teal-50 border border-teal-200/80 text-teal-950 font-bold'
                      : 'hover:bg-slate-50 border border-transparent text-[#142D4E] font-medium'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-xl leading-none shrink-0" aria-hidden="true">
                      {curr.flagEmoji}
                    </span>

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`font-mono font-bold text-[11px] px-1 py-0.2 rounded border shrink-0 ${
                            isSelected
                              ? 'bg-white border-teal-300 text-teal-800'
                              : 'bg-slate-100 border-slate-200 text-[#142D4E]'
                          }`}
                        >
                          {curr.code}
                        </span>

                        <span className="text-xs font-semibold text-[#142D4E] truncate max-w-[140px]">
                          {curr.countryName}
                        </span>
                      </div>

                      <p className="text-[10px] text-[#64748B] truncate mt-0.5">
                        {curr.name} · <strong className="font-semibold text-slate-700">{curr.symbol}</strong>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 ml-1.5">
                    <span className="font-bold text-xs text-[#142D4E] bg-white px-1.5 py-0.5 rounded border border-slate-200 shadow-2xs">
                      {curr.symbol}
                    </span>
                    {isSelected && (
                      <div className="w-4 h-4 rounded-full bg-teal-600 text-white flex items-center justify-center shrink-0">
                        <Check className="w-3 h-3 stroke-[3]" />
                      </div>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-2.5 bg-slate-50 border-t border-[#E2E8F0] text-[10px] text-slate-600 flex items-start gap-1.5">
          <Info className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
          <p className="leading-tight">
            Changing currency updates display formatting. Numerical amounts remain unchanged.
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
};
