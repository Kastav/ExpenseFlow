import { Expense, CurrencyCode, SUPPORTED_CURRENCIES } from '../types/expense';
import { getCurrencyDetails } from '../data/geoCurrencies';

/**
 * Format an amount in the specified currency code with consistent symbol and decimal formatting.
 * Respects ISO 4217 minor unit decimals (0 decimals for JPY/KRW, 3 for BHD/KWD/OMR, 2 for USD/EUR).
 */
export function formatCurrency(
  amount: number,
  currency: CurrencyCode = 'USD',
  showCents: boolean = true
): string {
  if (isNaN(amount) || !isFinite(amount)) {
    amount = 0;
  }

  const currInfo = getCurrencyDetails(currency) || SUPPORTED_CURRENCIES.find((c) => c.code === currency);
  const symbol = currInfo ? currInfo.symbol : currency;
  const naturalDecimals = currInfo ? currInfo.decimalDigits : 2;
  const decimals = showCents ? naturalDecimals : 0;

  // Use localized number formatting with appropriate thousands separators
  let locale = 'en-US';
  if (currency === 'INR') locale = 'en-IN';
  else if (currency === 'EUR') locale = 'de-DE';
  else if (currency === 'GBP') locale = 'en-GB';
  else if (currency === 'CAD') locale = 'en-CA';
  else if (currency === 'AUD') locale = 'en-AU';
  else if (currency === 'JPY') locale = 'ja-JP';

  const numberPart = new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);

  // Position symbol cleanly based on currency conventions
  if (currency === 'EUR') {
    return `${numberPart} €`;
  }
  return `${symbol}${numberPart}`;
}

/**
 * Backwards-compatible wrapper for USD formatting.
 */
export function formatUSD(amount: number, showCents: boolean = true): string {
  return formatCurrency(amount, 'USD', showCents);
}

/**
 * Format a YYYY-MM-DD date string into human-readable format.
 */
export function formatDate(dateString: string): string {
  if (!dateString) return '';
  try {
    const [year, month, day] = dateString.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  } catch {
    return dateString;
  }
}

/**
 * Returns today's date formatted as YYYY-MM-DD in local timezone.
 */
export function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Relative or clean date representation.
 */
export function formatRelativeDate(dateString: string): string {
  const today = getTodayDateString();
  if (dateString === today) return 'Today';

  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yYear = yesterday.getFullYear();
  const yMonth = String(yesterday.getMonth() + 1).padStart(2, '0');
  const yDay = String(yesterday.getDate()).padStart(2, '0');
  const yesterdayStr = `${yYear}-${yMonth}-${yDay}`;

  if (dateString === yesterdayStr) return 'Yesterday';
  return formatDate(dateString);
}

/**
 * Format Month & Year from "YYYY-MM" or "YYYY-MM-DD"
 */
export function formatMonthYear(dateString: string): string {
  if (!dateString) return '';
  try {
    const parts = dateString.split('-');
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const date = new Date(year, month - 1, 1);
    return new Intl.DateTimeFormat('en-US', {
      month: 'long',
      year: 'numeric',
    }).format(date);
  } catch {
    return dateString;
  }
}

/**
 * Escape CSV field to prevent CSV formula injection and handle quotes/commas.
 */
export function escapeCSVField(field: unknown): string {
  if (field === null || field === undefined) {
    return '""';
  }
  let str = String(field);

  // Prevent spreadsheet formula injection (CSV Injection / CWE-1236)
  const dangerousPrefixes = ['=', '+', '-', '@', '\t', '\r'];
  if (dangerousPrefixes.some((prefix) => str.startsWith(prefix))) {
    str = `'${str}`;
  }

  // Escape internal double quotes by doubling them
  str = str.replace(/"/g, '""');

  return `"${str}"`;
}

export interface ExportCSVResult {
  success: boolean;
  filename?: string;
  recordCount: number;
  errorMessage?: string;
}

/**
 * Returns the date span covered by the transaction list for display in the export UI.
 */
export function getTransactionsDateRange(transactions: Expense[]): {
  earliestDate: string | null;
  latestDate: string | null;
  formattedRange: string;
} {
  if (!transactions || transactions.length === 0) {
    return {
      earliestDate: null,
      latestDate: null,
      formattedRange: 'No transactions recorded',
    };
  }

  const validDates = transactions
    .map((t) => t.date)
    .filter((d) => Boolean(d) && /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();

  if (validDates.length === 0) {
    return {
      earliestDate: null,
      latestDate: null,
      formattedRange: 'All recorded transactions',
    };
  }

  const earliest = validDates[0];
  const latest = validDates[validDates.length - 1];

  if (earliest === latest) {
    return {
      earliestDate: earliest,
      latestDate: latest,
      formattedRange: formatDate(earliest),
    };
  }

  return {
    earliestDate: earliest,
    latestDate: latest,
    formattedRange: `${formatDate(earliest)} – ${formatDate(latest)}`,
  };
}

/**
 * Generate CSV text and trigger download for the user.
 * Features:
 * - Prepends UTF-8 BOM (\uFEFF) for seamless character rendering in Excel & Google Sheets.
 * - Escapes commas, quotes, line breaks according to RFC 4180.
 * - Defends against CSV injection (CWE-1236) by neutralising leading formula triggers (=, +, -, @, \t, \r).
 * - Descriptive filename containing "ExpenseFlow", active currency, and export date.
 * - Preserves exact recorded transaction numbers without conversion.
 */
export function exportTransactionsCSV(
  transactions: Expense[],
  currency: CurrencyCode = 'USD'
): ExportCSVResult {
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    return {
      success: false,
      recordCount: 0,
      errorMessage: 'Export is only supported in a browser environment.',
    };
  }

  if (!transactions || transactions.length === 0) {
    return {
      success: false,
      recordCount: 0,
      errorMessage: 'No transactions available to export.',
    };
  }

  try {
    const headers = ['Date', 'Category', 'Amount', 'Currency', 'Payment Method', 'Notes'];

    const rows = transactions.map((t) => {
      return [
        escapeCSVField(t.date),
        escapeCSVField(t.category),
        escapeCSVField(t.amount.toFixed(2)),
        escapeCSVField(currency),
        escapeCSVField(t.paymentMethod || 'Unspecified'),
        escapeCSVField(t.notes || (t.description ? `[Legacy note: ${t.description}]` : '')),
      ];
    });

    const csvContent = [headers.map(escapeCSVField).join(','), ...rows.map((r) => r.join(','))].join(
      '\r\n'
    );

    // Prepend UTF-8 BOM (\uFEFF) so Microsoft Excel, Apple Numbers, and Google Sheets open international characters properly
    const blob = new Blob(['\uFEFF', csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const filename = `ExpenseFlow_Transactions_${currency}_${getTodayDateString()}.csv`;
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    return {
      success: true,
      filename,
      recordCount: transactions.length,
    };
  } catch (err) {
    console.error('ExpenseFlow: Error exporting CSV:', err);
    return {
      success: false,
      recordCount: 0,
      errorMessage: err instanceof Error ? err.message : 'An unexpected error occurred during export.',
    };
  }
}

/**
 * Generate CSV text and trigger download for the user (backwards-compatible boolean wrapper).
 */
export function downloadTransactionsCSV(
  transactions: Expense[],
  currency: CurrencyCode = 'USD'
): boolean {
  return exportTransactionsCSV(transactions, currency).success;
}
