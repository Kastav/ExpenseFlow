import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  X,
  Check,
  RotateCcw,
} from 'lucide-react';
import { getTodayDateString, formatDate } from '../utils/formatters';

interface DatePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDate: string; // YYYY-MM-DD
  onSelectDate: (date: string) => void;
  title?: string;
  maxDate?: string;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const WEEKDAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/**
 * Validates and formats date components to YYYY-MM-DD string.
 */
export function toDateString(year: number, monthIndex: number, day: number): string {
  const y = String(year).padStart(4, '0');
  const m = String(monthIndex + 1).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Computes calendar month properties: days in month and start weekday offset (0=Sun, 6=Sat).
 */
export function getMonthCalendarDays(year: number, monthIndex: number): { daysInMonth: number; firstDayOfWeek: number } {
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const firstDayOfWeek = new Date(year, monthIndex, 1).getDay();
  return { daysInMonth, firstDayOfWeek };
}

export const DatePickerModal: React.FC<DatePickerModalProps> = ({
  isOpen,
  onClose,
  selectedDate,
  onSelectDate,
  title = 'Select Date',
  maxDate,
}) => {
  // Parse incoming selectedDate or default to today
  const initialParts = useMemo(() => {
    const today = getTodayDateString();
    const target = /^\d{4}-\d{2}-\d{2}$/.test(selectedDate) ? selectedDate : today;
    const [y, m, d] = target.split('-').map(Number);
    return { year: y, monthIndex: m - 1, day: d, full: target };
  }, [selectedDate]);

  const [viewYear, setViewYear] = useState<number>(initialParts.year);
  const [viewMonth, setViewMonth] = useState<number>(initialParts.monthIndex);
  const [tempSelectedDate, setTempSelectedDate] = useState<string>(initialParts.full);

  // Synchronize internal state whenever modal opens or selectedDate changes externally
  useEffect(() => {
    if (isOpen) {
      setViewYear(initialParts.year);
      setViewMonth(initialParts.monthIndex);
      setTempSelectedDate(initialParts.full);
    }
  }, [isOpen, initialParts]);

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

  const todayStr = useMemo(() => getTodayDateString(), []);
  const yesterdayStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return toDateString(d.getFullYear(), d.getMonth(), d.getDate());
  }, []);

  // Compute month days with leap-year handling
  const calendarGrid = useMemo(() => {
    const firstDayIndex = new Date(viewYear, viewMonth, 1).getDay(); // 0 for Sunday
    const daysInCurrentMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

    const cells: {
      dateString: string;
      dayNumber: number;
      isCurrentMonth: boolean;
      isToday: boolean;
      isSelected: boolean;
    }[] = [];

    // Previous month padding days
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const day = daysInPrevMonth - i;
      const prevDate = new Date(viewYear, viewMonth - 1, day);
      const ds = toDateString(prevDate.getFullYear(), prevDate.getMonth(), day);
      cells.push({
        dateString: ds,
        dayNumber: day,
        isCurrentMonth: false,
        isToday: ds === todayStr,
        isSelected: ds === tempSelectedDate,
      });
    }

    // Current month days
    for (let day = 1; day <= daysInCurrentMonth; day++) {
      const ds = toDateString(viewYear, viewMonth, day);
      cells.push({
        dateString: ds,
        dayNumber: day,
        isCurrentMonth: true,
        isToday: ds === todayStr,
        isSelected: ds === tempSelectedDate,
      });
    }

    // Next month padding days to complete a consistent 35 or 42-cell grid
    const totalSlots = cells.length > 35 ? 42 : 35;
    const remaining = totalSlots - cells.length;
    for (let day = 1; day <= remaining; day++) {
      const nextDate = new Date(viewYear, viewMonth + 1, day);
      const ds = toDateString(nextDate.getFullYear(), nextDate.getMonth(), day);
      cells.push({
        dateString: ds,
        dayNumber: day,
        isCurrentMonth: false,
        isToday: ds === todayStr,
        isSelected: ds === tempSelectedDate,
      });
    }

    return cells;
  }, [viewYear, viewMonth, tempSelectedDate, todayStr]);

  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const handleSelectDay = (ds: string) => {
    setTempSelectedDate(ds);
    const [y, m] = ds.split('-').map(Number);
    if (y !== viewYear || m - 1 !== viewMonth) {
      setViewYear(y);
      setViewMonth(m - 1);
    }
  };

  const handleApply = () => {
    onSelectDate(tempSelectedDate);
    onClose();
  };

  const handleQuickSelect = (ds: string) => {
    setTempSelectedDate(ds);
    const [y, m] = ds.split('-').map(Number);
    setViewYear(y);
    setViewMonth(m - 1);
    onSelectDate(ds);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="datepicker-modal-title"
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-white rounded-2xl shadow-xl border border-[#E2E8F0] overflow-hidden my-auto flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#E2E8F0] bg-slate-50/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center shrink-0">
              <CalendarIcon className="w-4 h-4" />
            </div>
            <div>
              <h2 id="datepicker-modal-title" className="text-sm font-bold text-[#142D4E]">
                {title}
              </h2>
              <p className="text-[11px] text-[#64748B]">
                {tempSelectedDate === todayStr
                  ? 'Today · ' + formatDate(tempSelectedDate)
                  : tempSelectedDate === yesterdayStr
                  ? 'Yesterday · ' + formatDate(tempSelectedDate)
                  : formatDate(tempSelectedDate)}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
            aria-label="Close date picker"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Quick Date Presets Bar */}
        <div className="flex items-center gap-1.5 px-5 py-2.5 bg-white border-b border-slate-100 overflow-x-auto">
          <span className="text-[11px] font-semibold text-slate-400 mr-1 shrink-0">Quick:</span>
          <button
            type="button"
            onClick={() => handleQuickSelect(todayStr)}
            className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer whitespace-nowrap min-h-[30px] ${
              tempSelectedDate === todayStr
                ? 'bg-teal-600 text-white shadow-2xs'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => handleQuickSelect(yesterdayStr)}
            className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer whitespace-nowrap min-h-[30px] ${
              tempSelectedDate === yesterdayStr
                ? 'bg-teal-600 text-white shadow-2xs'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Yesterday
          </button>
        </div>

        {/* Calendar Body */}
        <div className="p-4 sm:p-5 space-y-3">
          {/* Month / Year Navigator */}
          <div className="flex items-center justify-between gap-2 px-1">
            <button
              type="button"
              onClick={handlePrevMonth}
              className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 hover:text-slate-900 border border-slate-200 shadow-2xs transition-all cursor-pointer"
              aria-label="Previous month"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-[#142D4E]">
                {MONTH_NAMES[viewMonth]}
              </span>
              <span className="text-sm font-bold text-teal-700">
                {viewYear}
              </span>
            </div>

            <button
              type="button"
              onClick={handleNextMonth}
              className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 hover:text-slate-900 border border-slate-200 shadow-2xs transition-all cursor-pointer"
              aria-label="Next month"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Weekday Row Header */}
          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAY_NAMES.map((wd, idx) => (
              <div
                key={wd}
                className={`text-[11px] font-bold py-1 select-none ${
                  idx === 0 || idx === 6 ? 'text-slate-400' : 'text-slate-500'
                }`}
              >
                {wd}
              </div>
            ))}
          </div>

          {/* Days Grid */}
          <div className="grid grid-cols-7 gap-1">
            {calendarGrid.map((cell) => {
              const isSelected = cell.isSelected;
              const isToday = cell.isToday;
              const isCurrentMonth = cell.isCurrentMonth;

              return (
                <button
                  key={cell.dateString}
                  type="button"
                  onClick={() => handleSelectDay(cell.dateString)}
                  className={`relative flex items-center justify-center w-full aspect-square rounded-xl text-xs font-semibold transition-all cursor-pointer select-none min-h-[38px] ${
                    isSelected
                      ? 'bg-teal-600 text-white font-bold shadow-xs scale-100 z-10'
                      : isToday
                      ? 'border border-teal-600 text-teal-800 font-bold bg-teal-50/60 hover:bg-teal-100/60'
                      : isCurrentMonth
                      ? 'text-[#142D4E] hover:bg-slate-100'
                      : 'text-slate-300 hover:text-slate-500 hover:bg-slate-50'
                  }`}
                  aria-label={`${formatDate(cell.dateString)}${isToday ? ' (Today)' : ''}${isSelected ? ' (Selected)' : ''}`}
                >
                  <span>{cell.dayNumber}</span>
                  {isToday && !isSelected && (
                    <span className="absolute bottom-1 w-1 h-1 rounded-full bg-teal-600" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Modal Footer with Apply and Cancel buttons */}
        <div className="flex items-center justify-between gap-2.5 px-5 py-3 border-t border-[#E2E8F0] bg-slate-50/70">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200/70 rounded-xl transition-colors cursor-pointer min-h-[38px]"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleApply}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-teal-600 hover:bg-teal-700 active:scale-[0.98] rounded-xl shadow-xs transition-all cursor-pointer min-h-[38px]"
          >
            <Check className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>Apply Date</span>
          </button>
        </div>
      </div>
    </div>
  );
};
