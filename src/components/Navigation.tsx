import React from 'react';
import { ActiveTab } from '../types/expense';
import { Home, History, Calculator, TrendingUp, MoreHorizontal } from 'lucide-react';

interface NavigationProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
}

export const Navigation: React.FC<NavigationProps> = ({ activeTab, onSelectTab }) => {
  const tabs: { id: ActiveTab; label: string; icon: React.FC<{ className?: string }> }[] = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'history', label: 'History', icon: History },
    { id: 'plan', label: 'Plan', icon: Calculator },
    { id: 'insights', label: 'Insights', icon: TrendingUp },
    { id: 'more', label: 'More', icon: MoreHorizontal },
  ];

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-[#E2E8F0] shadow-sm pb-[env(safe-area-inset-bottom,0px)]"
      aria-label="Mobile navigation"
    >
      {/* Symmetrical container with balanced edge padding: removes awkward gaps before Home and after More */}
      <div className="w-full max-w-md mx-auto px-2 sm:px-3">
        {/* Evenly distributed 5-column grid: every item gets exact 20% width with identical centerlines */}
        <div className="grid grid-cols-5 h-16 items-center">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onSelectTab(tab.id)}
                className={`w-full h-full flex flex-col items-center justify-center py-1 px-0.5 transition-all group focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 rounded-xl min-h-[44px] cursor-pointer ${
                  isActive ? 'text-teal-700' : 'text-[#64748B] hover:text-[#142D4E]'
                }`}
                aria-current={isActive ? 'page' : undefined}
                aria-label={tab.label}
              >
                {/* Visual Icon Pill: consistent size and alignment across all 5 items */}
                <div
                  className={`w-10 h-7 rounded-full flex items-center justify-center transition-all duration-150 ${
                    isActive
                      ? 'bg-teal-50 text-teal-600 shadow-2xs'
                      : 'text-slate-400 group-hover:text-slate-600 group-hover:bg-slate-50'
                  }`}
                >
                  <Icon
                    className={`w-5 h-5 shrink-0 transition-transform ${
                      isActive ? 'stroke-[2.25] scale-105' : 'stroke-[1.75]'
                    }`}
                  />
                </div>

                {/* Symmetrical Label: single-line without wrapping or adjacent collision */}
                <span
                  className={`text-[10px] sm:text-[11px] leading-tight tracking-tight mt-1 truncate max-w-full text-center ${
                    isActive ? 'font-bold text-teal-700' : 'font-medium text-slate-500 group-hover:text-slate-700'
                  }`}
                >
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
};
