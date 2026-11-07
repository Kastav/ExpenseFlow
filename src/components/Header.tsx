import React, { useState, useRef } from 'react';
import { ActiveTab, CurrencyCode } from '../types/expense';
import { getCurrencyDetails, getCurrencyCountryAndFlag } from '../data/geoCurrencies';
import { CurrencySelectorModal } from './CurrencySelectorModal';
import { Wallet, Plus, History, Calculator, TrendingUp, MoreHorizontal, Home, ChevronDown, Sparkles, Bot } from 'lucide-react';

interface HeaderProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  onOpenAddExpense: () => void;
  currency: CurrencyCode;
  onSelectCurrency: (currency: CurrencyCode) => void;
  onOpenUpgrade?: () => void;
  onOpenAiCoach?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onSelectTab,
  onOpenAddExpense,
  currency,
  onSelectCurrency,
  onOpenUpgrade,
  onOpenAiCoach,
}) => {
  const [isCurrencyModalOpen, setIsCurrencyModalOpen] = useState(false);
  const currencyButtonRef = useRef<HTMLButtonElement>(null);

  const navItems: { id: ActiveTab; label: string; icon: React.FC<{ className?: string }> }[] = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'history', label: 'History', icon: History },
    { id: 'plan', label: 'Plan', icon: Calculator },
    { id: 'insights', label: 'Insights', icon: TrendingUp },
    { id: 'more', label: 'More', icon: MoreHorizontal },
  ];

  const currentCurrencyDetails = getCurrencyDetails(currency);
  const geoInfo = getCurrencyCountryAndFlag(currency);

  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-[#E2E8F0]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
        {/* Zone 1: Wordmark */}
        <button
          onClick={() => onSelectTab('home')}
          className="flex items-center gap-2.5 text-left group focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 rounded-lg p-1 -ml-1 transition-opacity cursor-pointer shrink-0"
        >
          <div className="w-9 h-9 rounded-xl bg-teal-600 text-white flex items-center justify-center shadow-xs">
            <Wallet className="w-5 h-5 text-white" />
          </div>
          <span className="text-lg font-bold tracking-tight text-[#142D4E] whitespace-nowrap">
            ExpenseFlow
          </span>
        </button>

        {/* Zone 2: Desktop Nav Bar with balanced spacing before Home and after More */}
        <nav
          className="hidden md:flex items-center p-1 bg-slate-100/80 rounded-xl border border-slate-200/80 gap-1 shadow-2xs"
          aria-label="Desktop primary navigation"
        >
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap min-h-[36px] cursor-pointer ${
                  isActive
                    ? 'bg-white text-teal-700 shadow-xs border border-slate-200/60 font-bold'
                    : 'text-[#64748B] hover:text-[#142D4E] hover:bg-white/60'
                }`}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon
                  className={`w-4 h-4 shrink-0 transition-colors ${
                    isActive ? 'text-teal-600' : 'text-slate-400'
                  }`}
                />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Global Currency Preference Selector & Primary CTA */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Global Currency Preference Selector */}
          <button
            ref={currencyButtonRef}
            type="button"
            onClick={() => setIsCurrencyModalOpen((prev) => !prev)}
            aria-label={`Change currency from ${currency}`}
            aria-expanded={isCurrencyModalOpen}
            aria-haspopup="dialog"
            title={`Active currency: ${currency} (${currentCurrencyDetails?.name || geoInfo.countryName})`}
            className="flex items-center gap-1.5 bg-slate-50 hover:bg-slate-100/90 active:bg-slate-200/80 border border-[#E2E8F0] text-[#142D4E] text-xs font-bold py-2 px-3 rounded-xl cursor-pointer transition-all focus:outline-none focus:ring-2 focus:ring-teal-600 h-10 shadow-2xs group"
          >
            <span className="text-base leading-none shrink-0" aria-hidden="true">
              {geoInfo.flagEmoji}
            </span>
            <span className="font-mono tracking-tight font-bold">{currency}</span>
            <span className="text-[#64748B] font-semibold text-[11px] hidden sm:inline">
              ({currentCurrencyDetails?.symbol || '$'})
            </span>
            <ChevronDown
              className={`w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 shrink-0 ml-0.5 transition-transform duration-200 ${
                isCurrencyModalOpen ? 'rotate-180 text-teal-600' : ''
              }`}
            />
          </button>

          {/* AI Coach Button */}
          {onOpenAiCoach && (
            <button
              type="button"
              onClick={onOpenAiCoach}
              className="flex items-center gap-1.5 px-3 h-10 rounded-xl bg-teal-50 hover:bg-teal-100/90 active:bg-teal-200/80 border border-teal-200 text-teal-900 text-xs font-bold transition-all shadow-2xs active:scale-[0.98] cursor-pointer"
              title="Open AI Personal Spending Coach"
              aria-label="AI Spending Coach"
            >
              <Bot className="w-3.5 h-3.5 text-teal-600 shrink-0" />
              <span className="hidden sm:inline">AI Coach</span>
            </button>
          )}

          {/* Premium / Upgrade Button */}
          {onOpenUpgrade && (
            <button
              type="button"
              onClick={onOpenUpgrade}
              className="flex items-center gap-1.5 px-3 h-10 rounded-xl bg-gradient-to-r from-amber-50 to-amber-100/90 hover:from-amber-100 hover:to-amber-200 border border-amber-300 text-amber-950 text-xs font-extrabold transition-all shadow-2xs active:scale-[0.98] cursor-pointer"
              title="Explore ExpenseFlow Premium ($14.99/mo or $109.99/yr)"
              aria-label="ExpenseFlow Premium"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-600 fill-amber-500 shrink-0" />
              <span className="hidden sm:inline">Premium</span>
            </button>
          )}

          <button
            onClick={onOpenAddExpense}
            className="flex items-center justify-center gap-1.5 px-3.5 sm:px-4 h-10 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold shadow-xs hover:shadow-sm active:scale-[0.98] transition-all whitespace-nowrap cursor-pointer"
            aria-label="Add Expense"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span className="hidden sm:inline">Add Expense</span>
            <span className="sm:hidden">Add</span>
          </button>
        </div>
      </div>

      {/* Currency Selection Anchored Popover with Country Flags */}
      <CurrencySelectorModal
        isOpen={isCurrencyModalOpen}
        onClose={() => setIsCurrencyModalOpen(false)}
        selectedCurrency={currency}
        onSelectCurrency={onSelectCurrency}
        anchorRef={currencyButtonRef}
      />
    </header>
  );
};
