/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Expense, BudgetSettings, ActiveTab, ExpenseCategory, CurrencyCode, PlanData } from './types/expense';
import {
  dispatchExpenseFlowBack,
  setRootBackHandler,
  useMobileKeyboardVisible,
  getActiveModalStackDepth,
} from './utils/backNavigation';
import {
  loadStoredTransactionsResult,
  saveStoredTransactions,
  loadStoredBudgetResult,
  saveStoredBudget,
  loadStoredCurrencyResult,
  saveStoredCurrencyPreference,
  loadStoredPlanResult,
  saveStoredPlan,
  loadStoredCountryPreference,
  saveStoredCountryPreference,
  saveOnboardingCompleted,
  shouldShowOnboarding,
  TRANSACTIONS_KEY,
  BUDGET_KEY,
  CURRENCY_KEY,
  LEGACY_CURRENCY_KEY,
  PLAN_KEY,
  COUNTRY_KEY,
  StorageReadStatus,
  LoadTransactionsResult,
  LoadBudgetResult,
  LoadPlanResult,
  LoadCurrencyResult,
  SaveTransactionsOptions,
} from './utils/storage';
import { Header } from './components/Header';
import { Navigation } from './components/Navigation';
import { HomeDashboard } from './components/HomeDashboard';
import { TransactionHistory } from './components/TransactionHistory';
import { PurchasePlanner } from './components/PurchasePlanner';
import { InsightsView } from './components/InsightsView';
import { MoreView } from './components/MoreView';
import { ExpenseModal } from './components/ExpenseModal';
import { BudgetModal } from './components/BudgetModal';
import { DeleteConfirmModal } from './components/DeleteConfirmModal';
import { OnboardingModal } from './components/OnboardingModal';
import { PremiumUpgradeModal } from './components/PremiumUpgradeModal';
import { AiSpendingCoachModal } from './components/AiSpendingCoachModal';
import { PrivacyPolicyModal } from './components/PrivacyPolicyModal';
import { AuthModal } from './components/AuthModal';
import { PremiumFeatureId } from './types/premium';
import { trackEvent, initializeFirebaseAnalytics } from './services/analytics';
import {
  clearLocalSubscriptionEntitlement,
  syncSubscriptionOnAppActive,
} from './services/playBillingService';
import {
  AuthUser,
  DeleteAccountOptions,
  subscribeToAuthState,
  signOutUser,
  deleteCurrentUserAccount,
} from './services/authService';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default function App() {
  const [initialCurrencyResult] = useState<LoadCurrencyResult>(() => loadStoredCurrencyResult());
  const [currency, setCurrency] = useState<CurrencyCode>(initialCurrencyResult.data);
  const [currencyReadStatus, setCurrencyReadStatus] = useState<StorageReadStatus>(initialCurrencyResult.status);
  const [currencyErrorMessage, setCurrencyErrorMessage] = useState<string | null>(initialCurrencyResult.errorMessage || null);

  const [initialLoadResult] = useState<LoadTransactionsResult>(() => loadStoredTransactionsResult());
  const [storageReadStatus, setStorageReadStatus] = useState<StorageReadStatus>(initialLoadResult.status);
  const [storageErrorMessage, setStorageErrorMessage] = useState<string | null>(initialLoadResult.errorMessage || null);
  const [transactions, setTransactions] = useState<Expense[]>(initialLoadResult.data);

  const [initialBudgetResult] = useState<LoadBudgetResult>(() => loadStoredBudgetResult());
  const [budgetReadStatus, setBudgetReadStatus] = useState<StorageReadStatus>(initialBudgetResult.status);
  const [budgetErrorMessage, setBudgetErrorMessage] = useState<string | null>(initialBudgetResult.errorMessage || null);
  const [budget, setBudget] = useState<BudgetSettings>(initialBudgetResult.data);

  const [initialPlanResult] = useState<LoadPlanResult>(() => loadStoredPlanResult());
  const [planReadStatus, setPlanReadStatus] = useState<StorageReadStatus>(initialPlanResult.status);
  const [planErrorMessage, setPlanErrorMessage] = useState<string | null>(initialPlanResult.errorMessage || null);
  const [planData, setPlanData] = useState<PlanData>(initialPlanResult.data);

  const [activeTab, setActiveTab] = useState<ActiveTab>('home');
  const tabHistoryRef = useRef<ActiveTab[]>(['home']);
  const isKeyboardVisible = useMobileKeyboardVisible();

  // Country and first-run worldwide onboarding state
  const [country, setCountry] = useState<string>(() => loadStoredCountryPreference() || 'US');
  const [isOnboardingOpen, setIsOnboardingOpen] = useState<boolean>(() => shouldShowOnboarding());

  // Modal states (Editing existing expense, Budget setting, Delete confirmation, Premium Upgrade)
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [isBudgetModalOpen, setIsBudgetModalOpen] = useState<boolean>(false);
  const [deletingExpense, setDeletingExpense] = useState<Expense | null>(null);
  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState<boolean>(false);
  const [upgradeFeatureTrigger, setUpgradeFeatureTrigger] = useState<PremiumFeatureId | null>(null);
  const [isAiCoachOpen, setIsAiCoachOpen] = useState<boolean>(false);
  const [isPrivacyModalOpen, setIsPrivacyModalOpen] = useState<boolean>(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const lastAuthUidRef = useRef<string | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  const [authModalContext, setAuthModalContext] = useState<string | null>(null);

  const handleSelectTab = useCallback((nextTab: ActiveTab) => {
    setActiveTab((prevTab) => {
      if (prevTab !== nextTab) {
        if (nextTab === 'home') {
          tabHistoryRef.current = ['home'];
        } else {
          const filtered = tabHistoryRef.current.filter((t) => t !== nextTab);
          tabHistoryRef.current = [...filtered, nextTab];
        }
        if (typeof window !== 'undefined') {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }
      return nextTab;
    });
  }, []);

  const handleOpenUpgrade = useCallback((featureId?: PremiumFeatureId) => {
    setUpgradeFeatureTrigger(featureId || null);
    setIsUpgradeModalOpen(true);
  }, []);

  const handleOpenAiCoach = useCallback(() => {
    setIsAiCoachOpen(true);
  }, []);

  const handleOpenAuth = useCallback((contextMsg?: string) => {
    setAuthModalContext(contextMsg || null);
    setIsAuthModalOpen(true);
  }, []);

  const handleSignOut = useCallback(async () => {
    await signOutUser();
    lastAuthUidRef.current = null;
    setAuthUser(null);
  }, []);

  const handleDeleteAccount = useCallback(async (options?: DeleteAccountOptions) => {
    const res = await deleteCurrentUserAccount(options);
    if (res.success) {
      lastAuthUidRef.current = null;
      setAuthUser(null);
      if (options?.deleteLocalData) {
        const txRes = loadStoredTransactionsResult();
        setStorageReadStatus(txRes.status);
        setStorageErrorMessage(txRes.errorMessage || null);
        setTransactions(txRes.data);

        const bRes = loadStoredBudgetResult();
        setBudgetReadStatus(bRes.status);
        setBudgetErrorMessage(bRes.errorMessage || null);
        setBudget(bRes.data);

        const pRes = loadStoredPlanResult();
        setPlanReadStatus(pRes.status);
        setPlanErrorMessage(pRes.errorMessage || null);
        setPlanData(pRes.data);

        const cRes = loadStoredCurrencyResult();
        setCurrencyReadStatus(cRes.status);
        setCurrencyErrorMessage(cRes.errorMessage || null);
        setCurrency(cRes.data);
      }
    }
    return res;
  }, []);

  // Register Android hardware Back & Web popstate navigation
  useEffect(() => {
    setRootBackHandler(() => {
      if (tabHistoryRef.current.length > 1) {
        const nextHistory = tabHistoryRef.current.slice(0, -1);
        const targetTab = nextHistory[nextHistory.length - 1] || 'home';
        tabHistoryRef.current = nextHistory;
        setActiveTab(targetTab);
        if (typeof window !== 'undefined') {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
        return true;
      }
      if (activeTab !== 'home') {
        tabHistoryRef.current = ['home'];
        setActiveTab('home');
        if (typeof window !== 'undefined') {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
        return true;
      }
      return false;
    });

    const w = window as unknown as {
      __expenseFlowHandleBack?: () => boolean;
      Capacitor?: { isNativePlatform?: () => boolean };
    };
    w.__expenseFlowHandleBack = dispatchExpenseFlowBack;

    const isNativeAndroid = Boolean(w.Capacitor?.isNativePlatform?.());
    const handlePopState = () => {
      if (isNativeAndroid) return;
      const consumed = dispatchExpenseFlowBack();
      if (consumed && (getActiveModalStackDepth() > 0 || tabHistoryRef.current.length > 1)) {
        window.history.pushState({ efBackSentinel: true }, '');
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      setRootBackHandler(null);
      delete w.__expenseFlowHandleBack;
      window.removeEventListener('popstate', handlePopState);
    };
  }, [activeTab]);

  // Keep a single browser history sentinel active on non-native web when modals or sub-tabs are open
  useEffect(() => {
    const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } };
    if (w.Capacitor?.isNativePlatform?.()) return;

    const hasBackState =
      activeTab !== 'home' ||
      Boolean(editingExpense) ||
      isBudgetModalOpen ||
      Boolean(deletingExpense) ||
      isUpgradeModalOpen ||
      isAiCoachOpen ||
      isPrivacyModalOpen ||
      isAuthModalOpen;

    if (hasBackState && !window.history.state?.efBackSentinel) {
      window.history.pushState({ efBackSentinel: true }, '');
    }
  }, [
    activeTab,
    editingExpense,
    isBudgetModalOpen,
    deletingExpense,
    isUpgradeModalOpen,
    isAiCoachOpen,
    isPrivacyModalOpen,
    isAuthModalOpen,
  ]);

  // Restore Firebase Authentication session across launches and bind entitlement lifecycle
  useEffect(() => {
    const unsubscribe = subscribeToAuthState((snapshot) => {
      const nextUid = snapshot.user?.uid ?? null;
      const prevUid = lastAuthUidRef.current;

      if (snapshot.initialized && prevUid && nextUid && prevUid !== nextUid) {
        // Switching accounts directly must immediately purge the prior user's cached local entitlement
        clearLocalSubscriptionEntitlement();
      }
      lastAuthUidRef.current = nextUid;
      setAuthUser(snapshot.user);

      if (snapshot.initialized) {
        if (snapshot.user) {
          syncSubscriptionOnAppActive({ force: true }).catch(() => {});
        } else {
          // Signed-out users cannot retain cached Premium entitlement; local financial data stays intact
          clearLocalSubscriptionEntitlement();
        }
      }
    });

    return unsubscribe;
  }, []);

  // Re-verify subscription entitlements on app resume when authenticated
  useEffect(() => {
    const handleResumeSync = () => {
      if (typeof document !== 'undefined' && document.visibilityState && document.visibilityState !== 'visible') {
        return;
      }
      if (authUser) {
        syncSubscriptionOnAppActive().catch(() => {});
      }
    };

    window.addEventListener('focus', handleResumeSync);
    document.addEventListener('visibilitychange', handleResumeSync);

    return () => {
      window.removeEventListener('focus', handleResumeSync);
      document.removeEventListener('visibilitychange', handleResumeSync);
    };
  }, [authUser]);

  // Initialize Firebase Analytics safely on mount and send standard page_view and app_open
  useEffect(() => {
    initializeFirebaseAnalytics()
      .then((analytics) => {
        if (analytics) {
          trackEvent('page_view');
          trackEvent('app_open');
        }
      })
      .catch(() => {});
  }, []);

  // Track section views based on active tab without transmitting user data
  useEffect(() => {
    if (activeTab === 'history') {
      trackEvent('history_viewed');
      trackEvent('page_view');
    } else if (activeTab === 'insights') {
      trackEvent('insights_viewed');
      trackEvent('page_view');
    } else if (activeTab === 'plan') {
      trackEvent('planner_used');
      trackEvent('page_view');
    }
  }, [activeTab]);

  // Listen for storage changes made in other tabs to keep state synchronized and prevent split-brain overwrites
  useEffect(() => {
    const handleStorageEvent = (event: StorageEvent) => {
      // If event.key is null, storage was cleared or reset across tabs
      if (!event.key || event.key === TRANSACTIONS_KEY) {
        const txRes = loadStoredTransactionsResult();
        setStorageReadStatus(txRes.status);
        setStorageErrorMessage(txRes.errorMessage || null);
        if (txRes.status !== 'error') {
          setTransactions(txRes.data);
        }
      }

      if (!event.key || event.key === BUDGET_KEY) {
        const bRes = loadStoredBudgetResult();
        setBudgetReadStatus(bRes.status);
        setBudgetErrorMessage(bRes.errorMessage || null);
        if (bRes.status !== 'error') {
          setBudget(bRes.data);
        }
      }

      if (!event.key || event.key === PLAN_KEY) {
        const pRes = loadStoredPlanResult();
        setPlanReadStatus(pRes.status);
        setPlanErrorMessage(pRes.errorMessage || null);
        if (pRes.status !== 'error') {
          setPlanData(pRes.data);
        }
      }

      if (!event.key || event.key === CURRENCY_KEY || event.key === LEGACY_CURRENCY_KEY) {
        const cRes = loadStoredCurrencyResult();
        setCurrencyReadStatus(cRes.status);
        setCurrencyErrorMessage(cRes.errorMessage || null);
        if (cRes.status !== 'error') {
          setCurrency(cRes.data);
        }
      }

      if (!event.key || event.key === COUNTRY_KEY) {
        const storedCountry = loadStoredCountryPreference();
        if (storedCountry) {
          setCountry(storedCountry);
        }
      }
    };

    window.addEventListener('storage', handleStorageEvent);
    return () => {
      window.removeEventListener('storage', handleStorageEvent);
    };
  }, []);

  // Retry loading storage safely across all keys
  const handleRetryLoadStorage = useCallback(() => {
    const txRes = loadStoredTransactionsResult();
    setStorageReadStatus(txRes.status);
    setStorageErrorMessage(txRes.errorMessage || null);
    if (txRes.status !== 'error') {
      setTransactions(txRes.data);
    }

    const bRes = loadStoredBudgetResult();
    setBudgetReadStatus(bRes.status);
    setBudgetErrorMessage(bRes.errorMessage || null);
    if (bRes.status !== 'error') {
      setBudget(bRes.data);
    }

    const pRes = loadStoredPlanResult();
    setPlanReadStatus(pRes.status);
    setPlanErrorMessage(pRes.errorMessage || null);
    if (pRes.status !== 'error') {
      setPlanData(pRes.data);
    }

    const cRes = loadStoredCurrencyResult();
    setCurrencyReadStatus(cRes.status);
    setCurrencyErrorMessage(cRes.errorMessage || null);
    if (cRes.status !== 'error') {
      setCurrency(cRes.data);
    }
  }, []);

  // Sync transactions to localStorage whenever changed, with strict write protection
  const updateTransactions = useCallback(
    (newTransactions: Expense[], options?: SaveTransactionsOptions): boolean => {
      // Prevent destructive overwrite if storage could not be read safely
      if (storageReadStatus === 'error') {
        console.warn('ExpenseFlow: Write prevented because existing storage data could not be read reliably.');
        return false;
      }
      const saved = saveStoredTransactions(newTransactions, options);
      if (saved) {
        // Refresh React state with latest merged storage data so that additions from other tabs are reflected
        const refreshed = loadStoredTransactionsResult();
        if (refreshed.status === 'success' || refreshed.status === 'empty') {
          setTransactions(refreshed.data);
        } else {
          setTransactions(newTransactions);
        }
        return true;
      }
      return false;
    },
    [storageReadStatus]
  );

  // Handler for changing global currency preference across the entire app
  const handleSelectCurrency = useCallback((newCurrency: CurrencyCode): boolean => {
    if (currencyReadStatus === 'error') {
      console.warn('ExpenseFlow: Currency update prevented because existing storage preference could not be read reliably.');
      return false;
    }
    const saved = saveStoredCurrencyPreference(newCurrency);
    if (saved) {
      setCurrency(newCurrency);
      return true;
    }
    return false;
  }, [currencyReadStatus]);

  // Handler for changing country preference
  const handleSelectCountry = useCallback((newCountry: string): boolean => {
    const saved = saveStoredCountryPreference(newCountry);
    if (saved) {
      setCountry(newCountry);
      return true;
    }
    return false;
  }, []);

  // Handler for completing first-run onboarding
  const handleCompleteOnboarding = useCallback(
    (selectedCountry: string, selectedCurrency: CurrencyCode) => {
      saveStoredCountryPreference(selectedCountry);
      setCountry(selectedCountry);
      handleSelectCurrency(selectedCurrency);
      saveOnboardingCompleted(true);
      setIsOnboardingOpen(false);
      trackEvent('onboarding_completed');
    },
    [handleSelectCurrency]
  );

  // Sync budget to localStorage with strict write protection
  const updateBudget = useCallback((newMonthlyBudget: number): boolean => {
    if (budgetReadStatus === 'error') {
      console.warn('ExpenseFlow: Budget write prevented because existing storage data could not be read reliably.');
      return false;
    }
    const updated: BudgetSettings = {
      monthlyBudget: newMonthlyBudget,
      lastUpdated: Date.now(),
    };
    const saved = saveStoredBudget(updated);
    if (saved) {
      setBudget(updated);
      return true;
    }
    return false;
  }, [budgetReadStatus]);

  // Save Plan handler with strict write protection
  const handleSavePlan = useCallback((newPlan: PlanData): boolean => {
    if (planReadStatus === 'error') {
      console.warn('ExpenseFlow: Plan write prevented because existing storage data could not be read reliably.');
      return false;
    }
    const saved = saveStoredPlan(newPlan);
    if (saved) {
      setPlanData(newPlan);
      return true;
    }
    return false;
  }, [planReadStatus]);

  // Save Expense Handler (Used by inline form on Home and by Edit modal)
  const handleSaveExpense = useCallback(
    (expenseData: {
      amount: number;
      category: ExpenseCategory;
      date: string;
      paymentMethod?: string;
      notes?: string;
    }): boolean => {
      if (storageReadStatus === 'error') {
        return false;
      }

      // Check latest persisted records before constructing update to account for other tabs
      const currentPersisted = loadStoredTransactionsResult();
      const baseList =
        currentPersisted.status !== 'error' ? currentPersisted.data : transactions;

      if (editingExpense) {
        // Edit existing transaction
        const updatedExpenseObj: Expense = {
          ...editingExpense,
          amount: expenseData.amount,
          category: expenseData.category,
          date: expenseData.date,
          paymentMethod: expenseData.paymentMethod,
          notes: expenseData.notes,
          updatedAt: Date.now(),
        };

        const updatedList = baseList.map((t) => (t.id === editingExpense.id ? updatedExpenseObj : t));
        const success = updateTransactions(updatedList);
        if (success) {
          setEditingExpense(null);
        }
        return success;
      } else {
        // Add new transaction
        const newExpense: Expense = {
          id: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          amount: expenseData.amount,
          category: expenseData.category,
          date: expenseData.date,
          paymentMethod: expenseData.paymentMethod,
          notes: expenseData.notes,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        // Place new expense at top of list and sort by date desc
        const updatedList = [newExpense, ...baseList].sort((a, b) => {
          if (b.date !== a.date) return b.date.localeCompare(a.date);
          return b.createdAt - a.createdAt;
        });
        const success = updateTransactions(updatedList);
        if (success) {
          // Track expense_added event safely with zero financial/identifying data
          trackEvent('expense_added');
        }
        return success;
      }
    },
    [editingExpense, transactions, updateTransactions, storageReadStatus]
  );

  // Delete Expense Handler
  const handleConfirmDelete = useCallback((): boolean => {
    if (!deletingExpense) return false;
    if (storageReadStatus === 'error') {
      return false;
    }
    const currentPersisted = loadStoredTransactionsResult();
    const baseList =
      currentPersisted.status !== 'error' ? currentPersisted.data : transactions;

    const updatedList = baseList.filter((t) => t.id !== deletingExpense.id);
    const success = updateTransactions(updatedList, { deletedIds: [deletingExpense.id] });
    if (success) {
      setDeletingExpense(null);
      // Track expense_deleted event safely with zero financial/identifying data
      trackEvent('expense_deleted');
      return true;
    }
    return false;
  }, [deletingExpense, transactions, updateTransactions, storageReadStatus]);

  // Navigate to Add Expense Form on Home dashboard and focus amount
  const handleNavigateToAdd = useCallback(() => {
    handleSelectTab('home');
    setTimeout(() => {
      const input = document.getElementById('inline-expense-amount');
      if (input) {
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        input.focus();
      }
    }, 60);
  }, [handleSelectTab]);

  return (
    <div className="min-h-[100dvh] bg-[#F8FAFC] text-[#142D4E] flex flex-col font-sans selection:bg-teal-100 selection:text-teal-900 overflow-x-clip">
      {/* Top Header with Global Currency Switcher */}
      <Header
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        onOpenAddExpense={handleNavigateToAdd}
        currency={currency}
        onSelectCurrency={handleSelectCurrency}
        onOpenUpgrade={() => handleOpenUpgrade()}
        onOpenAiCoach={handleOpenAiCoach}
        authUser={authUser}
        onOpenAuth={() => handleOpenAuth()}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-3 xs:px-4 sm:px-6 py-4 sm:py-8 pb-[calc(5.25rem+env(safe-area-inset-bottom,0px))] md:pb-8 min-w-0">
        {/* Storage Read Failure Warning Banner (Aggregated across all keys) */}
        {(storageReadStatus === 'error' ||
          budgetReadStatus === 'error' ||
          planReadStatus === 'error' ||
          currencyReadStatus === 'error') && (
          <div
            role="alert"
            className="mb-6 p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-in fade-in"
          >
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0 mt-0.5 sm:mt-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-amber-950">
                  Warning: Saved records could not be loaded safely
                </h3>
                <p className="text-xs text-amber-800 mt-0.5 leading-relaxed">
                  {[
                    storageReadStatus === 'error' && (storageErrorMessage || 'Transaction records could not be read safely.'),
                    budgetReadStatus === 'error' && (budgetErrorMessage || 'Monthly budget settings could not be read safely.'),
                    planReadStatus === 'error' && (planErrorMessage || 'Purchase planner data could not be read safely.'),
                    currencyReadStatus === 'error' && (currencyErrorMessage || 'Currency preference could not be read safely.'),
                  ]
                    .filter(Boolean)
                    .join(' ')}{' '}
                  To prevent accidental data loss or overwriting existing records, changes cannot be saved right now.
                </p>
              </div>
            </div>
            <button
              onClick={handleRetryLoadStorage}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-amber-900 bg-white border border-amber-300 hover:bg-amber-100 rounded-xl transition-colors shrink-0 shadow-2xs min-h-[44px] cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry Loading</span>
            </button>
          </div>
        )}

        {activeTab === 'home' && (
          <HomeDashboard
            transactions={transactions}
            budget={budget}
            currency={currency}
            onSaveExpense={handleSaveExpense}
            onOpenEditExpense={(tx) => setEditingExpense(tx)}
            onOpenBudgetModal={() => setIsBudgetModalOpen(true)}
            onSelectTab={handleSelectTab}
          />
        )}

        {activeTab === 'history' && (
          <TransactionHistory
            transactions={transactions}
            currency={currency}
            onEditExpense={(tx) => setEditingExpense(tx)}
            onRequestDeleteExpense={(tx) => setDeletingExpense(tx)}
            onOpenAddExpense={handleNavigateToAdd}
          />
        )}

        {activeTab === 'plan' && (
          <PurchasePlanner
            currency={currency}
            initialPlan={planData}
            onSavePlan={handleSavePlan}
            planReadStatus={planReadStatus}
            planErrorMessage={planErrorMessage}
            monthlyBudget={budget.monthlyBudget}
            onOpenUpgrade={handleOpenUpgrade}
          />
        )}

        {activeTab === 'insights' && (
          <InsightsView
            transactions={transactions}
            budget={budget}
            currency={currency}
            onOpenBudgetModal={() => setIsBudgetModalOpen(true)}
            onOpenUpgrade={handleOpenUpgrade}
            onOpenAiCoach={handleOpenAiCoach}
          />
        )}

        {activeTab === 'more' && (
          <MoreView
            transactions={transactions}
            currency={currency}
            onSelectCurrency={handleSelectCurrency}
            country={country}
            onSelectCountry={handleSelectCountry}
            onOpenUpgrade={handleOpenUpgrade}
            onOpenPrivacyPolicy={() => setIsPrivacyModalOpen(true)}
            authUser={authUser}
            onOpenAuth={() => handleOpenAuth()}
            onSignOut={handleSignOut}
          />
        )}
      </main>

      {/* Mobile Bottom Navigation Bar */}
      <Navigation activeTab={activeTab} onSelectTab={handleSelectTab} hidden={isKeyboardVisible} />

      {/* First-Run Worldwide Onboarding Modal */}
      <OnboardingModal
        isOpen={isOnboardingOpen}
        onComplete={handleCompleteOnboarding}
      />

      {/* Premium Upgrade Modal */}
      <PremiumUpgradeModal
        isOpen={isUpgradeModalOpen}
        onClose={() => setIsUpgradeModalOpen(false)}
        featureTrigger={upgradeFeatureTrigger}
        authUser={authUser}
        onRequireAuth={(msg) => handleOpenAuth(msg)}
      />

      {/* AI Personal Spending Coach Modal (Premium Only) */}
      <AiSpendingCoachModal
        isOpen={isAiCoachOpen}
        onClose={() => setIsAiCoachOpen(false)}
        transactions={transactions}
        budget={budget}
        currency={currency}
        onOpenUpgrade={() => handleOpenUpgrade('ai_spending_coach')}
        authUser={authUser}
        onRequireAuth={(msg) => handleOpenAuth(msg)}
      />

      {/* Firebase Authentication Sign-In / Registration Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => {
          setIsAuthModalOpen(false);
          setAuthModalContext(null);
        }}
        contextMessage={authModalContext}
        authUser={authUser}
        onSignOut={handleSignOut}
        onDeleteAccount={handleDeleteAccount}
        onAuthenticated={() => {
          syncSubscriptionOnAppActive({ force: true }).catch(() => {});
        }}
      />

      {/* Privacy Policy & Data Safety Modal */}
      <PrivacyPolicyModal
        isOpen={isPrivacyModalOpen}
        onClose={() => setIsPrivacyModalOpen(false)}
      />

      {/* Edit Modal (strictly for editing existing transactions) */}
      <ExpenseModal
        isOpen={Boolean(editingExpense)}
        onClose={() => setEditingExpense(null)}
        onSave={handleSaveExpense}
        initialExpense={editingExpense}
        currency={currency}
      />

      {/* Budget Modal */}
      <BudgetModal
        isOpen={isBudgetModalOpen}
        onClose={() => setIsBudgetModalOpen(false)}
        currentBudget={budget.monthlyBudget}
        onSaveBudget={updateBudget}
        currency={currency}
        readStatus={budgetReadStatus}
        errorMessage={budgetErrorMessage}
      />

      {/* Delete Confirmation Modal */}
      <DeleteConfirmModal
        isOpen={Boolean(deletingExpense)}
        onClose={() => setDeletingExpense(null)}
        onConfirm={handleConfirmDelete}
        expense={deletingExpense}
        currency={currency}
      />
    </div>
  );
}
