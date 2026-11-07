export type ExpenseCategory =
  | 'Housing'
  | 'Groceries'
  | 'Dining Out'
  | 'Transportation'
  | 'Utilities'
  | 'Healthcare'
  | 'Entertainment'
  | 'Shopping'
  | 'Personal Care'
  | 'Travel'
  | 'Education'
  | 'Other';

export type PaymentMethod =
  | 'Credit Card'
  | 'Debit Card'
  | 'Cash'
  | 'Bank Transfer'
  | 'Digital Wallet'
  | 'Other';

export const PAYMENT_METHODS: PaymentMethod[] = [
  'Credit Card',
  'Debit Card',
  'Cash',
  'Bank Transfer',
  'Digital Wallet',
  'Other',
];

export type CurrencyCode =
  | 'USD'
  | 'INR'
  | 'GBP'
  | 'EUR'
  | 'CAD'
  | 'AUD'
  | (string & {});

export interface CurrencyDetails {
  code: CurrencyCode;
  symbol: string;
  name: string;
  decimalDigits: number;
}

export interface CountryInfo {
  code: string;
  name: string;
  defaultCurrency: CurrencyCode;
  secondaryCurrencies?: CurrencyCode[];
}

export const SUPPORTED_CURRENCIES: CurrencyDetails[] = [
  { code: 'USD', symbol: '$', name: 'US Dollar', decimalDigits: 2 },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee', decimalDigits: 2 },
  { code: 'GBP', symbol: '£', name: 'British Pound', decimalDigits: 2 },
  { code: 'EUR', symbol: '€', name: 'Euro', decimalDigits: 2 },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar', decimalDigits: 2 },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar', decimalDigits: 2 },
];

export interface Expense {
  id: string;
  amount: number;
  category: ExpenseCategory;
  date: string; // YYYY-MM-DD
  paymentMethod?: string;
  notes?: string;
  description?: string; // Optional legacy description
  currency?: CurrencyCode; // Optional legacy currency
  createdAt: number;
  updatedAt: number;
}

export interface BudgetSettings {
  monthlyBudget: number;
  lastUpdated: number;
}

export interface PlannerInputs {
  availableMoney: number;
  upcomingBills: number;
  otherExpenses: number;
  proposedPurchase: number;
}

export interface PlanData {
  availableMoney: string;
  upcomingBills: string;
  otherExpenses: string;
  proposedPurchase: string;
  categoryBudgets?: Record<string, string>;
  lastSaved?: number;
}

export interface PlannerResult {
  estimatedRemaining: number;
  totalCommitted: number;
  isAffordable: boolean;
  deficit: number;
  explanation: string;
}

export type ActiveTab = 'home' | 'history' | 'plan' | 'insights' | 'more';

export interface CategoryInfo {
  name: ExpenseCategory;
  color: string;
  bgColor: string;
  borderColor: string;
  textColor: string;
}

export const CATEGORIES: CategoryInfo[] = [
  { name: 'Housing', color: '#0D9488', bgColor: 'bg-teal-50', borderColor: 'border-teal-200', textColor: 'text-teal-800' },
  { name: 'Groceries', color: '#16A34A', bgColor: 'bg-green-50', borderColor: 'border-green-200', textColor: 'text-green-800' },
  { name: 'Dining Out', color: '#D97706', bgColor: 'bg-amber-50', borderColor: 'border-amber-200', textColor: 'text-amber-800' },
  { name: 'Transportation', color: '#6366F1', bgColor: 'bg-indigo-50', borderColor: 'border-indigo-200', textColor: 'text-indigo-800' },
  { name: 'Utilities', color: '#0284C7', bgColor: 'bg-sky-50', borderColor: 'border-sky-200', textColor: 'text-sky-800' },
  { name: 'Healthcare', color: '#E11D48', bgColor: 'bg-rose-50', borderColor: 'border-rose-200', textColor: 'text-rose-800' },
  { name: 'Entertainment', color: '#8B5CF6', bgColor: 'bg-purple-50', borderColor: 'border-purple-200', textColor: 'text-purple-800' },
  { name: 'Shopping', color: '#EC4899', bgColor: 'bg-pink-50', borderColor: 'border-pink-200', textColor: 'text-pink-800' },
  { name: 'Personal Care', color: '#14B8A6', bgColor: 'bg-teal-50', borderColor: 'border-teal-200', textColor: 'text-teal-800' },
  { name: 'Travel', color: '#F59E0B', bgColor: 'bg-amber-50', borderColor: 'border-amber-200', textColor: 'text-amber-800' },
  { name: 'Education', color: '#3B82F6', bgColor: 'bg-blue-50', borderColor: 'border-blue-200', textColor: 'text-blue-800' },
  { name: 'Other', color: '#64748B', bgColor: 'bg-slate-100', borderColor: 'border-slate-300', textColor: 'text-slate-800' },
];

export interface ExpenseFlowBackupV1 {
  version: '1.0';
  exportedAt: string; // ISO 8601
  appName: 'ExpenseFlow';
  data: {
    currency: CurrencyCode;
    budget: BudgetSettings;
    transactions: Expense[];
    plan: PlanData;
  };
}

export type PurchasePriority = 'need' | 'want' | 'investment' | 'emergency';

export type ChallengeType = 'no_spend_days' | 'category_cap' | 'spending_reduction' | 'daily_budget';

export type ChallengeStatus = 'available' | 'active' | 'completed' | 'paused';

export interface SavingsChallenge {
  id: string;
  title: string;
  description: string;
  type: ChallengeType;
  category?: ExpenseCategory;
  targetValue: number; // e.g., 5 days, or 200 currency units, or 25% reduction
  currentProgress: number;
  unit: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  status: ChallengeStatus;
  badgeIcon?: string;
  completedAt?: number;
}

export interface MonthOverMonthReport {
  currentTotal: number;
  previousTotal: number;
  equivalentPreviousTotal?: number;
  difference: number;
  percentageChange: number; // e.g. +12.5 or -8.2
  direction: 'up' | 'down' | 'flat';
  hasPreviousMonthData: boolean;
  isEquivalentDateRange?: boolean;
  daysCompared?: number;
}

export interface DailySpendingVelocity {
  daysElapsed: number;
  totalDaysInMonth: number;
  daysRemaining: number;
  averageDailySpend: number;
  projectedMonthEndSpend: number;
  recommendedDailyAllowance: number;
  budgetStatus: 'on-track' | 'caution' | 'exceeded';
}
