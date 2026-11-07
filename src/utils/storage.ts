import {
  Expense,
  BudgetSettings,
  CurrencyCode,
  PlanData,
  ExpenseFlowBackupV1,
  SavingsChallenge,
} from '../types/expense';
import { isValidCurrencyCode } from '../data/geoCurrencies';

export const TRANSACTIONS_KEY = 'expenseflow_transactions_v1';
export const BUDGET_KEY = 'expenseflow_budget_v1';
export const CURRENCY_KEY = 'expenseflow_currency_preference_v1';
export const LEGACY_CURRENCY_KEY = 'expenseflow_base_currency_v1';
export const PLAN_KEY = 'expenseflow_plan_v1';
export const COUNTRY_KEY = 'expenseflow_country_preference_v1';
export const ONBOARDING_COMPLETED_KEY = 'expenseflow_onboarding_completed_v1';
export const CHALLENGES_KEY = 'expenseflow_challenges_v1';

export const VALID_CURRENCIES: CurrencyCode[] = ['USD', 'INR', 'GBP', 'EUR', 'CAD', 'AUD'];

/**
 * Validates a single transaction record against schema requirements.
 */
export function isValidExpenseItem(item: unknown): item is Expense {
  return Boolean(
    item &&
    typeof item === 'object' &&
    typeof (item as Expense).id === 'string' &&
    typeof (item as Expense).amount === 'number' &&
    isFinite((item as Expense).amount) &&
    (item as Expense).amount > 0 &&
    typeof (item as Expense).category === 'string' &&
    typeof (item as Expense).date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test((item as Expense).date)
  );
}

/**
 * Safely load the persistent global currency preference.
 * Defaults to 'USD' for new users or if invalid.
 */
export function loadStoredCurrencyResult(): LoadCurrencyResult {
  try {
    const raw = localStorage.getItem(CURRENCY_KEY) || localStorage.getItem(LEGACY_CURRENCY_KEY);
    if (raw === null || raw.trim() === '') {
      return { status: 'empty', data: 'USD' };
    }
    const clean = raw.trim().toUpperCase() as CurrencyCode;
    if (isValidCurrencyCode(clean)) {
      return { status: 'success', data: clean };
    }
    console.error(`ExpenseFlow: Stored currency "${raw}" is invalid or unsupported.`);
    return {
      status: 'error',
      data: 'USD',
      errorMessage: `Stored currency preference "${raw}" is not supported.`,
    };
  } catch (err) {
    console.error('ExpenseFlow: Unable to load currency preference from storage:', err);
    return {
      status: 'error',
      data: 'USD',
      errorMessage: 'Unable to access browser storage for currency preference.',
    };
  }
}

/**
 * Safely load the persistent global currency preference.
 * Defaults to 'USD' for new users or if invalid.
 */
export function loadStoredCurrencyPreference(): CurrencyCode {
  return loadStoredCurrencyResult().data;
}

/**
 * Safely save the persistent global currency preference.
 */
export function saveStoredCurrencyPreference(currency: CurrencyCode): boolean {
  if (!isValidCurrencyCode(currency)) {
    console.error(`ExpenseFlow: Cannot save invalid currency code: ${currency}`);
    return false;
  }
  try {
    const existingRaw = localStorage.getItem(CURRENCY_KEY);
    if (existingRaw !== null && existingRaw.trim() !== '') {
      const clean = existingRaw.trim().toUpperCase() as CurrencyCode;
      if (!isValidCurrencyCode(clean)) {
        console.error('ExpenseFlow: Write blocked because existing currency preference is corrupted.');
        return false;
      }
    }
    localStorage.setItem(CURRENCY_KEY, currency);
    localStorage.setItem(LEGACY_CURRENCY_KEY, currency);
    return true;
  } catch (err) {
    console.error('ExpenseFlow: Error saving currency preference to storage:', err);
    return false;
  }
}

/**
 * Safely load persistent country preference.
 */
export function loadStoredCountryPreference(): string | null {
  try {
    const raw = localStorage.getItem(COUNTRY_KEY);
    if (!raw || raw.trim() === '') return null;
    return raw.trim().toUpperCase();
  } catch {
    return null;
  }
}

/**
 * Safely save persistent country preference.
 */
export function saveStoredCountryPreference(countryCode: string): boolean {
  if (!countryCode || typeof countryCode !== 'string') return false;
  try {
    localStorage.setItem(COUNTRY_KEY, countryCode.trim().toUpperCase());
    return true;
  } catch (err) {
    console.error('ExpenseFlow: Error saving country preference to storage:', err);
    return false;
  }
}

/**
 * Check if first-run onboarding has been completed.
 */
export function loadOnboardingCompleted(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_COMPLETED_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Mark first-run onboarding as completed.
 */
export function saveOnboardingCompleted(completed: boolean = true): boolean {
  try {
    localStorage.setItem(ONBOARDING_COMPLETED_KEY, completed ? 'true' : 'false');
    return true;
  } catch (err) {
    console.error('ExpenseFlow: Error saving onboarding completed status:', err);
    return false;
  }
}

/**
 * Determines whether first-run onboarding should be displayed.
 * Existing users with saved currency preferences or existing financial records
 * (transactions, budget, plan) automatically skip onboarding.
 */
export function shouldShowOnboarding(): boolean {
  try {
    // 1. Explicit onboarding completed flag
    if (localStorage.getItem(ONBOARDING_COMPLETED_KEY) === 'true') {
      return false;
    }
    // 2. Existing currency preference
    const storedCurrency =
      localStorage.getItem(CURRENCY_KEY) || localStorage.getItem(LEGACY_CURRENCY_KEY);
    if (storedCurrency && storedCurrency.trim().length > 0) {
      return false;
    }
    // 3. Existing transactions
    const rawTx = localStorage.getItem(TRANSACTIONS_KEY);
    if (rawTx && rawTx.trim() !== '' && rawTx.trim() !== '[]') {
      return false;
    }
    // 4. Existing budget settings
    const rawBudget = localStorage.getItem(BUDGET_KEY);
    if (rawBudget && rawBudget.trim() !== '') {
      return false;
    }
    // 5. Existing plan data
    const rawPlan = localStorage.getItem(PLAN_KEY);
    if (rawPlan && rawPlan.trim() !== '') {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// Backwards-compatible aliases
export const loadStoredBaseCurrency = loadStoredCurrencyPreference;
export const saveStoredBaseCurrency = saveStoredCurrencyPreference;

export type StorageReadStatus = 'empty' | 'success' | 'error';

export interface LoadTransactionsResult {
  status: StorageReadStatus;
  data: Expense[];
  errorMessage?: string;
}

export interface LoadBudgetResult {
  status: StorageReadStatus;
  data: BudgetSettings;
  errorMessage?: string;
}

export interface LoadPlanResult {
  status: StorageReadStatus;
  data: PlanData;
  errorMessage?: string;
}

export interface LoadCurrencyResult {
  status: StorageReadStatus;
  data: CurrencyCode;
  errorMessage?: string;
}

/**
 * Safely load transactions from localStorage with clear status differentiation:
 * - 'empty': No saved transaction records exist in localStorage.
 * - 'success': Records were parsed and validated successfully.
 * - 'error': Storage access failed, or records were corrupted/malformed.
 */
export function loadStoredTransactionsResult(): LoadTransactionsResult {
  try {
    const raw = localStorage.getItem(TRANSACTIONS_KEY);
    if (raw === null || raw.trim() === '') {
      return { status: 'empty', data: [] };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (parseErr) {
      console.error('ExpenseFlow: Corrupted JSON in transactions storage:', parseErr);
      return {
        status: 'error',
        data: [],
        errorMessage: 'Stored transaction records are corrupted or not valid JSON.',
      };
    }

    if (!Array.isArray(parsed)) {
      console.error('ExpenseFlow: Expected array in transactions storage, got:', typeof parsed);
      return {
        status: 'error',
        data: [],
        errorMessage: 'Stored transaction records are not in a valid list format.',
      };
    }

    if (parsed.length === 0) {
      return { status: 'empty', data: [] };
    }

    const validTransactions: Expense[] = parsed
      .filter(isValidExpenseItem)
      .map((item) => ({
        id: item.id,
        amount: item.amount,
        category: item.category,
        date: item.date,
        paymentMethod: item.paymentMethod,
        notes: item.notes,
        description: item.description,
        createdAt: item.createdAt || Date.now(),
        updatedAt: item.updatedAt || Date.now(),
      }));

    if (parsed.length > 0 && validTransactions.length !== parsed.length) {
      const corruptedCount = parsed.length - validTransactions.length;
      console.error(
        `ExpenseFlow: Stored transactions contain ${corruptedCount} unreadable record(s) out of ${parsed.length}`
      );
      return {
        status: 'error',
        data: [],
        errorMessage: `Stored transaction records contain ${corruptedCount} unreadable or invalid item(s). Write locked to prevent permanent data loss.`,
      };
    }

    // Sort newest date first by default
    validTransactions.sort((a, b) => {
      if (b.date !== a.date) {
        return b.date.localeCompare(a.date);
      }
      return (b.createdAt || 0) - (a.createdAt || 0);
    });

    return {
      status: 'success',
      data: validTransactions,
    };
  } catch (error) {
    console.error('ExpenseFlow: Error reading transactions from localStorage:', error);
    return {
      status: 'error',
      data: [],
      errorMessage:
        error instanceof Error
          ? error.message
          : 'Unable to access browser storage (storage may be blocked or restricted).',
    };
  }
}

/**
 * Safely load transactions from localStorage (backwards-compatible wrapper).
 */
export function loadStoredTransactions(): Expense[] {
  return loadStoredTransactionsResult().data;
}

export interface SaveTransactionsOptions {
  deletedIds?: string[];
  mode?: 'merge' | 'replace';
}

/**
 * Merges an incoming transaction list with the persisted transaction list from storage.
 *
 * Conflict Resolution Policy:
 * 1. Transaction Preservation:
 *    - Any valid transaction present in `persisted` that is NOT in `deletedIds` is preserved,
 *      preventing stale tabs from silently discarding transactions created in other tabs.
 *    - Any valid transaction present in `incoming` is preserved.
 * 2. Conflicting Edits (same transaction ID):
 *    - If both `incoming` and `persisted` contain a transaction with the same ID:
 *      - Compare `updatedAt` timestamps (falling back to `createdAt` or 0):
 *        - If `incoming.updatedAt > persisted.updatedAt`: `incoming` wins.
 *        - If `persisted.updatedAt > incoming.updatedAt`: `persisted` wins.
 *        - If timestamps are identical: `incoming` (the active user's local edit in this session) wins.
 * 3. Explicit Deletions:
 *    - If `options.deletedIds` contains a transaction ID, that transaction is excluded from the merged output
 *      even if it was present in `persisted`.
 * 4. Ordering:
 *    - The resulting array is sorted by `date` descending, then by `(createdAt || 0)` descending.
 */
export function mergeTransactionLists(
  incoming: Expense[],
  persisted: Expense[],
  options?: SaveTransactionsOptions
): Expense[] {
  const deletedSet = new Set(options?.deletedIds || []);
  const map = new Map<string, Expense>();

  // 1. Seed with valid persisted transactions (excluding deletedIds)
  for (const item of persisted) {
    if (isValidExpenseItem(item) && !deletedSet.has(item.id)) {
      map.set(item.id, item);
    }
  }

  // 2. Merge incoming transactions
  for (const item of incoming) {
    if (!isValidExpenseItem(item) || deletedSet.has(item.id)) {
      continue;
    }
    const existing = map.get(item.id);
    if (!existing) {
      map.set(item.id, item);
    } else {
      // Conflicting edits with identical ID: compare timestamps
      const incomingTime = item.updatedAt || item.createdAt || 0;
      const existingTime = existing.updatedAt || existing.createdAt || 0;

      if (incomingTime >= existingTime) {
        // Incoming is newer or equal: active user's local edit wins
        map.set(item.id, item);
      } else {
        // Persisted is newer: keep persisted
        map.set(item.id, existing);
      }
    }
  }

  const result = Array.from(map.values());

  // Sort descending by date, then createdAt
  result.sort((a, b) => {
    if (b.date !== a.date) {
      return b.date.localeCompare(a.date);
    }
    return (b.createdAt || 0) - (a.createdAt || 0);
  });

  return result;
}

/**
 * Safely save transactions to localStorage.
 * Includes a guard against overwriting preexisting corrupted raw data or partially corrupted records,
 * and performs an ID-based merge with existing persisted records to prevent stale-state overwrites.
 */
export function saveStoredTransactions(
  transactions: Expense[],
  options?: SaveTransactionsOptions
): boolean {
  try {
    // Safety check: if raw data exists and is unparseable or contains corrupted records, do not overwrite blindly
    const existingRaw = localStorage.getItem(TRANSACTIONS_KEY);
    let existingList: Expense[] = [];

    if (existingRaw !== null && existingRaw.trim() !== '') {
      try {
        const testParse = JSON.parse(existingRaw);
        if (!Array.isArray(testParse)) {
          console.error('ExpenseFlow: Write blocked to prevent destroying unparseable existing storage data.');
          return false;
        }
        const hasCorruptedItems = testParse.some((item) => !isValidExpenseItem(item));
        if (hasCorruptedItems) {
          console.error(
            'ExpenseFlow: Write blocked because existing storage contains unparseable or corrupted records.'
          );
          return false;
        }
        existingList = testParse as Expense[];
      } catch {
        console.error('ExpenseFlow: Write blocked because existing raw data is corrupted. Overwrite prevented.');
        return false;
      }
    }

    // Determine target transactions: either merged (default) or explicit replacement
    const targetTransactions =
      options?.mode === 'replace'
        ? transactions.filter(isValidExpenseItem)
        : mergeTransactionLists(transactions, existingList, options);

    localStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(targetTransactions));
    return true;
  } catch (error) {
    console.error('ExpenseFlow: Error saving transactions to localStorage:', error);
    return false;
  }
}

export const DEFAULT_BUDGET: BudgetSettings = {
  monthlyBudget: 2500, // Reasonable default for initial setup
  lastUpdated: 0,
};

/**
 * Safely load budget settings with status differentiation:
 * - 'empty': No saved budget settings exist in localStorage.
 * - 'success': Budget settings were parsed and validated successfully.
 * - 'error': Storage access failed or settings were corrupted/invalid.
 */
export function loadStoredBudgetResult(): LoadBudgetResult {
  try {
    const raw = localStorage.getItem(BUDGET_KEY);
    if (raw === null || raw.trim() === '') {
      return {
        status: 'empty',
        data: { ...DEFAULT_BUDGET, lastUpdated: Date.now() },
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (parseErr) {
      console.error('ExpenseFlow: Corrupted JSON in budget storage:', parseErr);
      return {
        status: 'error',
        data: { ...DEFAULT_BUDGET, lastUpdated: Date.now() },
        errorMessage: 'Stored budget settings are corrupted or not valid JSON.',
      };
    }

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      typeof (parsed as any).monthlyBudget !== 'number' ||
      !isFinite((parsed as any).monthlyBudget) ||
      (parsed as any).monthlyBudget <= 0
    ) {
      console.error('ExpenseFlow: Stored budget has invalid schema:', parsed);
      return {
        status: 'error',
        data: { ...DEFAULT_BUDGET, lastUpdated: Date.now() },
        errorMessage: 'Stored budget settings are not in a valid format.',
      };
    }

    const p = parsed as { monthlyBudget: number; lastUpdated?: number };
    return {
      status: 'success',
      data: {
        monthlyBudget: p.monthlyBudget,
        lastUpdated: typeof p.lastUpdated === 'number' ? p.lastUpdated : Date.now(),
      },
    };
  } catch (error) {
    console.error('ExpenseFlow: Error reading budget from localStorage:', error);
    return {
      status: 'error',
      data: { ...DEFAULT_BUDGET, lastUpdated: Date.now() },
      errorMessage:
        error instanceof Error
          ? error.message
          : 'Unable to access browser storage for budget settings.',
    };
  }
}

/**
 * Safely load budget settings (backwards-compatible wrapper).
 */
export function loadStoredBudget(): BudgetSettings {
  return loadStoredBudgetResult().data;
}

/**
 * Safely save budget settings to localStorage with corrupted-data overwrite protection.
 */
export function saveStoredBudget(budget: BudgetSettings): boolean {
  if (
    !budget ||
    typeof budget.monthlyBudget !== 'number' ||
    !isFinite(budget.monthlyBudget) ||
    budget.monthlyBudget <= 0
  ) {
    console.error('ExpenseFlow: Invalid budget payload:', budget);
    return false;
  }

  try {
    const existingRaw = localStorage.getItem(BUDGET_KEY);
    if (existingRaw !== null && existingRaw.trim() !== '') {
      try {
        const testParse = JSON.parse(existingRaw);
        if (
          !testParse ||
          typeof testParse !== 'object' ||
          Array.isArray(testParse) ||
          typeof testParse.monthlyBudget !== 'number' ||
          !isFinite(testParse.monthlyBudget) ||
          testParse.monthlyBudget <= 0
        ) {
          console.error('ExpenseFlow: Write blocked to prevent destroying invalid existing budget data.');
          return false;
        }
      } catch {
        console.error('ExpenseFlow: Write blocked because existing budget data is corrupted. Overwrite prevented.');
        return false;
      }
    }

    localStorage.setItem(BUDGET_KEY, JSON.stringify(budget));
    return true;
  } catch (error) {
    console.error('ExpenseFlow: Error saving budget to localStorage:', error);
    return false;
  }
}

export const DEFAULT_INITIAL_PLAN: PlanData = {
  availableMoney: '500',
  upcomingBills: '250',
  otherExpenses: '100',
  proposedPurchase: '120',
  categoryBudgets: {},
};

/**
 * Safely load plan values from localStorage with status differentiation:
 * - 'empty': No saved plan data exists in localStorage.
 * - 'success': Plan data was parsed and validated successfully.
 * - 'error': Storage access failed or data was corrupted/invalid.
 * Dedicated versioned key: expenseflow_plan_v1
 */
export function loadStoredPlanResult(): LoadPlanResult {
  try {
    const raw = localStorage.getItem(PLAN_KEY);
    if (raw === null || raw.trim() === '') {
      return { status: 'empty', data: { ...DEFAULT_INITIAL_PLAN } };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (parseErr) {
      console.error('ExpenseFlow: Corrupted JSON in plan storage:', parseErr);
      return {
        status: 'error',
        data: { ...DEFAULT_INITIAL_PLAN },
        errorMessage: 'Stored purchase plan is corrupted or not valid JSON.',
      };
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      console.error('ExpenseFlow: Expected object in plan storage, got:', typeof parsed);
      return {
        status: 'error',
        data: { ...DEFAULT_INITIAL_PLAN },
        errorMessage: 'Stored purchase plan data is not in a valid format.',
      };
    }

    const obj = parsed as Record<string, unknown>;
    const hasAnyField =
      obj.availableMoney !== undefined ||
      obj.upcomingBills !== undefined ||
      obj.otherExpenses !== undefined ||
      obj.proposedPurchase !== undefined ||
      obj.categoryBudgets !== undefined;

    if (!hasAnyField) {
      console.error('ExpenseFlow: Stored plan has invalid schema (missing plan properties)');
      return {
        status: 'error',
        data: { ...DEFAULT_INITIAL_PLAN },
        errorMessage: 'Stored purchase plan does not contain valid plan fields.',
      };
    }

    const isScalarOrEmpty = (val: unknown) =>
      val === undefined || val === null || typeof val === 'string' || typeof val === 'number';

    if (
      !isScalarOrEmpty(obj.availableMoney) ||
      !isScalarOrEmpty(obj.upcomingBills) ||
      !isScalarOrEmpty(obj.otherExpenses) ||
      !isScalarOrEmpty(obj.proposedPurchase)
    ) {
      console.error('ExpenseFlow: Stored plan has invalid property types');
      return {
        status: 'error',
        data: { ...DEFAULT_INITIAL_PLAN },
        errorMessage: 'Stored purchase plan data contains invalid field values.',
      };
    }

    const categoryBudgets: Record<string, string> = {};
    if (obj.categoryBudgets && typeof obj.categoryBudgets === 'object' && !Array.isArray(obj.categoryBudgets)) {
      Object.entries(obj.categoryBudgets).forEach(([cat, val]) => {
        if (typeof val === 'string' || typeof val === 'number') {
          categoryBudgets[cat] = String(val);
        }
      });
    }

    return {
      status: 'success',
      data: {
        availableMoney:
          obj.availableMoney !== undefined && obj.availableMoney !== null
            ? String(obj.availableMoney)
            : '',
        upcomingBills:
          obj.upcomingBills !== undefined && obj.upcomingBills !== null
            ? String(obj.upcomingBills)
            : '',
        otherExpenses:
          obj.otherExpenses !== undefined && obj.otherExpenses !== null
            ? String(obj.otherExpenses)
            : '',
        proposedPurchase:
          obj.proposedPurchase !== undefined && obj.proposedPurchase !== null
            ? String(obj.proposedPurchase)
            : '',
        categoryBudgets,
        lastSaved: typeof obj.lastSaved === 'number' ? obj.lastSaved : undefined,
      },
    };
  } catch (error) {
    console.error('ExpenseFlow: Error reading plan from localStorage:', error);
    return {
      status: 'error',
      data: { ...DEFAULT_INITIAL_PLAN },
      errorMessage:
        error instanceof Error
          ? error.message
          : 'Unable to access browser storage for purchase plan.',
    };
  }
}

/**
 * Safely load plan values from localStorage (backwards-compatible wrapper).
 * Dedicated versioned key: expenseflow_plan_v1
 */
export function loadStoredPlan(): PlanData {
  return loadStoredPlanResult().data;
}

/**
 * Safely save all editable plan values to localStorage with corrupted-data overwrite protection.
 * Dedicated versioned key: expenseflow_plan_v1
 */
export function saveStoredPlan(plan: PlanData): boolean {
  if (!plan || typeof plan !== 'object') {
    return false;
  }
  try {
    const existingRaw = localStorage.getItem(PLAN_KEY);
    if (existingRaw !== null && existingRaw.trim() !== '') {
      try {
        const testParse = JSON.parse(existingRaw);
        if (!testParse || typeof testParse !== 'object' || Array.isArray(testParse)) {
          console.error('ExpenseFlow: Write blocked to prevent destroying unparseable existing plan data.');
          return false;
        }
        const hasAnyField =
          (testParse as any).availableMoney !== undefined ||
          (testParse as any).upcomingBills !== undefined ||
          (testParse as any).otherExpenses !== undefined ||
          (testParse as any).proposedPurchase !== undefined ||
          (testParse as any).categoryBudgets !== undefined;
        if (!hasAnyField) {
          console.error('ExpenseFlow: Write blocked because existing plan data lacks valid fields.');
          return false;
        }
        const isScalarOrEmpty = (val: unknown) =>
          val === undefined || val === null || typeof val === 'string' || typeof val === 'number';
        if (
          !isScalarOrEmpty((testParse as any).availableMoney) ||
          !isScalarOrEmpty((testParse as any).upcomingBills) ||
          !isScalarOrEmpty((testParse as any).otherExpenses) ||
          !isScalarOrEmpty((testParse as any).proposedPurchase)
        ) {
          console.error('ExpenseFlow: Write blocked because existing plan data has corrupted property types.');
          return false;
        }
      } catch {
        console.error('ExpenseFlow: Write blocked because existing plan data is corrupted. Overwrite prevented.');
        return false;
      }
    }

    const payload: PlanData = {
      availableMoney: String(plan.availableMoney ?? ''),
      upcomingBills: String(plan.upcomingBills ?? ''),
      otherExpenses: String(plan.otherExpenses ?? ''),
      proposedPurchase: String(plan.proposedPurchase ?? ''),
      categoryBudgets: plan.categoryBudgets || {},
      lastSaved: Date.now(),
    };
    localStorage.setItem(PLAN_KEY, JSON.stringify(payload));
    return true;
  } catch (error) {
    console.error('ExpenseFlow: Error saving plan to localStorage:', error);
    return false;
  }
}

/**
 * Returns today's date formatted as YYYY-MM-DD in local time for backup filenames.
 */
export function getBackupDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export interface BackupGenerationResult {
  success: boolean;
  errorMessage?: string;
  backup?: ExpenseFlowBackupV1;
}

/**
 * Read-only creation of the complete ExpenseFlow user data backup.
 * Gathers data across all 4 canonical financial storage keys:
 * - expenseflow_transactions_v1
 * - expenseflow_budget_v1
 * - expenseflow_currency_preference_v1
 * - expenseflow_plan_v1
 *
 * Guarantees:
 * - Does NOT alter, overwrite, or delete any local storage data.
 * - Does NOT mutate recorded transaction amounts or apply currency conversion.
 * - If storage contains corrupted or unreadable data in any key, returns success: false
 *   with an explanatory error message to prevent exporting corrupted payloads.
 */
export function generateFullDataBackupPayload(): BackupGenerationResult {
  const transactionsResult = loadStoredTransactionsResult();
  const budgetResult = loadStoredBudgetResult();
  const currencyResult = loadStoredCurrencyResult();
  const planResult = loadStoredPlanResult();

  if (transactionsResult.status === 'error') {
    return {
      success: false,
      errorMessage: transactionsResult.errorMessage || 'Failed to read transaction records from storage.',
    };
  }
  if (budgetResult.status === 'error') {
    return {
      success: false,
      errorMessage: budgetResult.errorMessage || 'Failed to read monthly budget settings from storage.',
    };
  }
  if (currencyResult.status === 'error') {
    return {
      success: false,
      errorMessage: currencyResult.errorMessage || 'Failed to read currency preference from storage.',
    };
  }
  if (planResult.status === 'error') {
    return {
      success: false,
      errorMessage: planResult.errorMessage || 'Failed to read purchase plan from storage.',
    };
  }

  const backup: ExpenseFlowBackupV1 = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    appName: 'ExpenseFlow',
    data: {
      currency: currencyResult.data,
      budget: budgetResult.data,
      transactions: transactionsResult.data,
      plan: planResult.data,
    },
  };

  return {
    success: true,
    backup,
  };
}

export interface DownloadBackupResult {
  success: boolean;
  filename?: string;
  errorMessage?: string;
  recordCounts?: {
    transactionsCount: number;
    monthlyBudget: number;
    currency: CurrencyCode;
  };
}

/**
 * Triggers a client-side download of the full JSON backup.
 * Creates an unpersisted Blob, invokes download link, and immediately revokes the object URL.
 */
export function downloadFullDataBackupJSON(): DownloadBackupResult {
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    return {
      success: false,
      errorMessage: 'Download is only available in a browser environment.',
    };
  }

  try {
    const backupResult = generateFullDataBackupPayload();
    if (!backupResult.success || !backupResult.backup) {
      return {
        success: false,
        errorMessage: backupResult.errorMessage || 'Unable to generate complete backup from storage.',
      };
    }

    const filename = `ExpenseFlow-backup-${getBackupDateString()}.json`;
    const jsonString = JSON.stringify(backupResult.backup, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    return {
      success: true,
      filename,
      recordCounts: {
        transactionsCount: backupResult.backup.data.transactions.length,
        monthlyBudget: backupResult.backup.data.budget.monthlyBudget,
        currency: backupResult.backup.data.currency,
      },
    };
  } catch (err) {
    console.error('ExpenseFlow: Error triggering JSON backup download:', err);
    return {
      success: false,
      errorMessage: err instanceof Error ? err.message : 'An unexpected error occurred while downloading backup.',
    };
  }
}

export interface LoadChallengesResult {
  status: StorageReadStatus;
  data: SavingsChallenge[];
  errorMessage?: string;
}

/**
 * Validates a single savings challenge record.
 */
export function isValidChallengeItem(item: unknown): item is SavingsChallenge {
  return Boolean(
    item &&
    typeof item === 'object' &&
    typeof (item as SavingsChallenge).id === 'string' &&
    typeof (item as SavingsChallenge).title === 'string' &&
    typeof (item as SavingsChallenge).type === 'string' &&
    typeof (item as SavingsChallenge).targetValue === 'number' &&
    typeof (item as SavingsChallenge).status === 'string'
  );
}

/**
 * Load savings challenges from isolated storage key: expenseflow_challenges_v1
 * Completely decoupled from canonical expense records.
 */
export function loadStoredChallengesResult(): LoadChallengesResult {
  try {
    const raw = localStorage.getItem(CHALLENGES_KEY);
    if (raw === null || raw.trim() === '') {
      return { status: 'empty', data: [] };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (parseErr) {
      console.error('ExpenseFlow: Corrupted JSON in challenges storage:', parseErr);
      return {
        status: 'error',
        data: [],
        errorMessage: 'Stored challenge records are corrupted or not valid JSON.',
      };
    }

    if (!Array.isArray(parsed)) {
      return {
        status: 'error',
        data: [],
        errorMessage: 'Stored challenges are not in a valid list format.',
      };
    }

    const validChallenges = parsed.filter(isValidChallengeItem);
    return {
      status: 'success',
      data: validChallenges,
    };
  } catch (err) {
    console.error('ExpenseFlow: Error reading challenges from localStorage:', err);
    return {
      status: 'error',
      data: [],
      errorMessage: 'Unable to access browser storage for challenges.',
    };
  }
}

export function loadStoredChallenges(): SavingsChallenge[] {
  return loadStoredChallengesResult().data;
}

/**
 * Safely save savings challenges to isolated storage key.
 */
export function saveStoredChallenges(challenges: SavingsChallenge[]): boolean {
  if (!Array.isArray(challenges)) {
    return false;
  }
  try {
    const valid = challenges.filter(isValidChallengeItem);
    localStorage.setItem(CHALLENGES_KEY, JSON.stringify(valid));
    return true;
  } catch (err) {
    console.error('ExpenseFlow: Error saving challenges to localStorage:', err);
    return false;
  }
}

/**
 * Cleanly remove all challenge data from localStorage without affecting
 * canonical expenses, budget, currency, or plan records.
 */
export function clearStoredChallenges(): boolean {
  try {
    localStorage.removeItem(CHALLENGES_KEY);
    return true;
  } catch (err) {
    console.error('ExpenseFlow: Error clearing challenges from localStorage:', err);
    return false;
  }
}

