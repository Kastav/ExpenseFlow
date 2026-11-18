import React, { useState, useMemo, useEffect, useRef } from 'react';
import { ExpenseCategory, CATEGORIES, CategoryInfo } from '../types/expense';
import {
  Home,
  ShoppingBag,
  Utensils,
  Car,
  Zap,
  HeartPulse,
  Film,
  Tag,
  Sparkles,
  Plane,
  GraduationCap,
  MoreHorizontal,
  Check,
  Search,
  X,
} from 'lucide-react';
import { useModalBackHandler, scrollInputIntoViewOnFocus } from '../utils/backNavigation';

interface CategorySelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedCategory: ExpenseCategory;
  onSelectCategory: (category: ExpenseCategory) => void;
}

// Icon mapping matching the 12 canonical ExpenseFlow categories
export const getCategoryIcon = (category: ExpenseCategory, className: string = 'w-4 h-4') => {
  switch (category) {
    case 'Housing':
      return <Home className={className} />;
    case 'Groceries':
      return <ShoppingBag className={className} />;
    case 'Dining Out':
      return <Utensils className={className} />;
    case 'Transportation':
      return <Car className={className} />;
    case 'Utilities':
      return <Zap className={className} />;
    case 'Healthcare':
      return <HeartPulse className={className} />;
    case 'Entertainment':
      return <Film className={className} />;
    case 'Shopping':
      return <Tag className={className} />;
    case 'Personal Care':
      return <Sparkles className={className} />;
    case 'Travel':
      return <Plane className={className} />;
    case 'Education':
      return <GraduationCap className={className} />;
    case 'Other':
    default:
      return <MoreHorizontal className={className} />;
  }
};

export const CategorySelectorModal: React.FC<CategorySelectorModalProps> = ({
  isOpen,
  onClose,
  selectedCategory,
  onSelectCategory,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useModalBackHandler(isOpen, onClose);

  useEffect(() => {
    if (isOpen && typeof window !== 'undefined' && window.innerWidth >= 768) {
      requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  }, [isOpen]);

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

  const filteredCategories = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return CATEGORIES;
    return CATEGORIES.filter((cat) => cat.name.toLowerCase().includes(q));
  }, [searchQuery]);

  if (!isOpen) return null;

  const handlePick = (catName: ExpenseCategory) => {
    onSelectCategory(catName);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="category-modal-title"
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150 overflow-hidden"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-2xl shadow-xl border border-[#E2E8F0] overflow-hidden flex flex-col max-h-[88dvh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 px-4 sm:px-5 py-3.5 sm:py-4 border-b border-[#E2E8F0] bg-slate-50/50 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center shrink-0">
              <Tag className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 id="category-modal-title" className="text-base font-bold text-[#142D4E] truncate">
                Select Category
              </h2>
              <p className="text-[11px] text-[#64748B] truncate">
                Choose an expense category to organize your spending
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            type="button"
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer shrink-0"
            aria-label="Close category selector"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search Input */}
        <div className="p-3 sm:p-3.5 border-b border-slate-100 bg-white shrink-0">
          <div className="relative w-full">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onFocus={scrollInputIntoViewOnFocus}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search categories (e.g. Groceries, Utilities)..."
              className="w-full min-h-[44px] pl-9 pr-11 py-2 text-sm sm:text-xs font-medium rounded-xl border border-[#E2E8F0] bg-slate-50 focus:bg-white focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 transition-all shadow-2xs"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-1 top-1/2 -translate-y-1/2 min-w-[40px] min-h-[40px] flex items-center justify-center text-slate-400 hover:text-slate-600 cursor-pointer"
                aria-label="Clear search"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Categories Grid/List */}
        <div className="flex-1 overflow-y-auto overscroll-contain divide-y divide-slate-100 p-2 touch-pan-y">
          {filteredCategories.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No categories match &ldquo;{searchQuery}&rdquo;.
            </div>
          ) : (
            filteredCategories.map((cat: CategoryInfo) => {
              const isSelected = cat.name === selectedCategory;
              return (
                <button
                  key={cat.name}
                  type="button"
                  onClick={() => handlePick(cat.name)}
                  className={`w-full flex items-center justify-between p-3 rounded-xl text-left transition-all cursor-pointer min-h-[48px] ${
                    isSelected
                      ? 'bg-teal-50 border border-teal-200 text-teal-950 font-bold'
                      : 'hover:bg-slate-50 border border-transparent text-[#142D4E] font-medium'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${cat.bgColor} ${cat.textColor}`}
                    >
                      {getCategoryIcon(cat.name, 'w-4 h-4')}
                    </div>
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: cat.color }}
                        aria-hidden="true"
                      />
                      <span className="text-sm truncate">{cat.name}</span>
                    </div>
                  </div>

                  {isSelected && (
                    <div className="w-6 h-6 rounded-full bg-teal-600 text-white flex items-center justify-center shrink-0 ml-2">
                      <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                    </div>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Footer info */}
        <div className="px-4 py-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom,0px))] sm:pb-2.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500 shrink-0">
          <span>{filteredCategories.length} categories available</span>
          <span>Tap any category to select</span>
        </div>
      </div>
    </div>
  );
};
