import React, { useState, useEffect } from 'react';
import {
  PRICING_TIERS,
  BillingCycle,
  PremiumFeatureId,
  FEATURE_REGISTRY,
  getCurrentUserPlanTier,
} from '../utils/premium';
import {
  PLAY_PRODUCT_IDS,
  PlayProductId,
  PlayProductDetails,
  StoredSubscriptionEntitlement,
} from '../types/billing';
import {
  fetchPlaySubscriptionProducts,
  initiateSubscriptionPurchase,
  restoreSubscriptionPurchases,
  getStoredSubscriptionEntitlement,
  DEFAULT_SUBSCRIPTION_DETAILS,
} from '../services/playBillingService';
import {
  X,
  Sparkles,
  Check,
  Shield,
  Bot,
  Cloud,
  ArrowRight,
  AlertCircle,
  CreditCard,
  Lock,
  RefreshCw,
  ExternalLink,
  CheckCircle2,
  Loader2,
} from 'lucide-react';

import { AuthUser, getObfuscatedAccountIdForUser } from '../services/authService';
import { useModalBackHandler } from '../utils/backNavigation';
import { useStageAvailability } from '../utils/stageAvailability';

interface PremiumUpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  featureTrigger?: PremiumFeatureId | null;
  authUser?: AuthUser | null;
  onRequireAuth?: (contextMessage: string) => void;
}

export const PremiumUpgradeModal: React.FC<PremiumUpgradeModalProps> = ({
  isOpen,
  onClose,
  featureTrigger,
  authUser,
  onRequireAuth,
}) => {
  const [cycle, setCycle] = useState<BillingCycle>('annual');
  const [isPurchasing, setIsPurchasing] = useState<boolean>(false);
  const [isRestoring, setIsRestoring] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: 'success' | 'pending' | 'error' | 'info';
    text: string;
  } | null>(null);
  const [playProducts, setPlayProducts] = useState<Record<PlayProductId, PlayProductDetails>>(
    DEFAULT_SUBSCRIPTION_DETAILS
  );
  const [isLiveFromPlayStore, setIsLiveFromPlayStore] = useState<boolean>(false);
  const [entitlement, setEntitlement] = useState<StoredSubscriptionEntitlement>(() =>
    getStoredSubscriptionEntitlement()
  );

  const stageAvailability = useStageAvailability(isOpen);

  useModalBackHandler(isOpen, onClose);

  useEffect(() => {
    if (isOpen) {
      setStatusMessage(null);
      setEntitlement(getStoredSubscriptionEntitlement());

      if (stageAvailability.purchasesEnabled) {
        fetchPlaySubscriptionProducts().then((res) => {
          setPlayProducts(res.products);
          setIsLiveFromPlayStore(res.isLiveFromPlayStore);
        });
      } else {
        setPlayProducts(DEFAULT_SUBSCRIPTION_DETAILS);
        setIsLiveFromPlayStore(false);
      }
    }
  }, [isOpen, authUser, stageAvailability.purchasesEnabled]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const currentTier = getCurrentUserPlanTier();
  const isCurrentlyPremium = currentTier === 'premium';
  const selectedProductId: PlayProductId =
    cycle === 'monthly' ? PLAY_PRODUCT_IDS.MONTHLY : PLAY_PRODUCT_IDS.ANNUAL;
  const currentProduct = playProducts[selectedProductId] || DEFAULT_SUBSCRIPTION_DETAILS[selectedProductId];
  const triggerFeatureObj = featureTrigger ? FEATURE_REGISTRY[featureTrigger] : null;

  const handleStartSubscription = async () => {
    if (isPurchasing) return;
    if (!stageAvailability.purchasesEnabled) {
      setStatusMessage({
        type: 'info',
        text: stageAvailability.billingReason,
      });
      return;
    }

    if (!authUser) {
      if (onRequireAuth) {
        onRequireAuth('Sign in or create an ExpenseFlow account before subscribing so your Google Play entitlement is bound securely to your account.');
      } else {
        setStatusMessage({
          type: 'error',
          text: 'Please sign in with your ExpenseFlow account before starting a subscription.',
        });
      }
      return;
    }

    setIsPurchasing(true);
    setStatusMessage(null);

    try {
      const obfuscatedAccountId = await getObfuscatedAccountIdForUser(authUser.uid);
      const res = await initiateSubscriptionPurchase(selectedProductId, {
        obfuscatedAccountId,
      });

      if (res.success) {
        setStatusMessage({
          type: 'success',
          text: res.message || 'Subscription confirmed! Welcome to ExpenseFlow Premium.',
        });
        setEntitlement(getStoredSubscriptionEntitlement());
      } else if (res.status === 'pending') {
        setStatusMessage({
          type: 'pending',
          text: res.message,
        });
      } else if (res.status === 'canceled') {
        setStatusMessage({
          type: 'info',
          text: 'Purchase was canceled.',
        });
      } else {
        setStatusMessage({
          type: 'error',
          text: res.message,
        });
      }
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: 'An unexpected error occurred during subscription processing.',
      });
    } finally {
      setIsPurchasing(false);
    }
  };

  const handleRestore = async () => {
    if (isRestoring) return;
    if (!stageAvailability.purchasesEnabled) {
      setStatusMessage({
        type: 'info',
        text: stageAvailability.billingReason,
      });
      return;
    }

    if (!authUser) {
      if (onRequireAuth) {
        onRequireAuth('Sign in to your ExpenseFlow account to restore and re-verify your existing Google Play subscription.');
      } else {
        setStatusMessage({
          type: 'error',
          text: 'Please sign in with your ExpenseFlow account to restore purchases.',
        });
      }
      return;
    }

    setIsRestoring(true);
    setStatusMessage(null);

    try {
      const res = await restoreSubscriptionPurchases();
      if (res.restored) {
        setStatusMessage({
          type: 'success',
          text: res.message,
        });
        setEntitlement(getStoredSubscriptionEntitlement());
      } else {
        setStatusMessage({
          type: 'info',
          text: res.message,
        });
      }
    } catch {
      setStatusMessage({
        type: 'error',
        text: 'Failed to restore purchases from Google Play.',
      });
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="premium-modal-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs overflow-hidden animate-in fade-in"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-xl bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 overflow-hidden max-h-[92dvh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Ribbon / Banner */}
        <div className="bg-gradient-to-r from-[#142D4E] via-[#1E3E66] to-teal-800 text-white p-4 sm:p-7 relative shrink-0">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close upgrade dialog"
            className="absolute top-3 right-3 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex flex-wrap items-center gap-2 mb-2 pr-12">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-400 text-slate-950 uppercase tracking-wider shadow-2xs">
              <Sparkles className="w-3.5 h-3.5 fill-current" />
              ExpenseFlow Premium
            </span>
            <span className="text-xs text-teal-200 font-medium">
              {!stageAvailability.purchasesEnabled
                ? 'Stage 2 · Coming Later'
                : isLiveFromPlayStore
                ? 'Google Play Connected'
                : 'Google Play Billing'}
            </span>
          </div>

          <h2 id="premium-modal-title" className="text-xl sm:text-3xl font-extrabold tracking-tight pr-8">
            Unlock Advanced AI &amp; Cloud Power
          </h2>
          <p className="text-xs sm:text-sm text-teal-100/90 mt-1.5 max-w-md leading-relaxed">
            Supercharge your finances with the AI Spending Coach, automated recommendations, and multi-device cloud synchronization.
          </p>

          {/* Contextual Feature Notification if triggered from a specific entry point */}
          {triggerFeatureObj && (
            <div className="mt-4 p-3 bg-white/10 backdrop-blur-xs rounded-xl border border-white/15 flex items-center gap-2.5 text-xs text-white">
              <Bot className="w-4 h-4 text-amber-300 shrink-0" />
              <span>
                <strong>{triggerFeatureObj.name}</strong> is a Premium feature because it incurs ongoing AI/cloud compute costs.
              </span>
            </div>
          )}
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-4 sm:p-6 overflow-y-auto overscroll-contain space-y-5 sm:space-y-6 flex-1">
          {/* Active Subscription State Banner if user is currently Premium */}
          {isCurrentlyPremium && (
            <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-200 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div className="text-xs space-y-1">
                <p className="font-bold text-emerald-950">Active ExpenseFlow Premium Subscription</p>
                <p className="text-emerald-800">
                  Plan: <strong>{entitlement.productId === PLAY_PRODUCT_IDS.ANNUAL ? 'Annual' : 'Monthly'}</strong>
                  {entitlement.expiryTimeMillis && (
                    <span> · Valid through {new Date(entitlement.expiryTimeMillis).toLocaleDateString()}</span>
                  )}
                </p>
                <a
                  href="https://play.google.com/store/account/subscriptions"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-teal-700 hover:text-teal-800 underline mt-1"
                >
                  <span>Manage subscription in Google Play</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          )}

          {/* Transparent Pricing Switcher */}
          <div className="bg-slate-50 p-1.5 rounded-2xl border border-slate-200/80 grid grid-cols-1 min-[360px]:grid-cols-2 w-full sm:max-w-md mx-auto gap-1.5">
            <button
              type="button"
              onClick={() => setCycle('monthly')}
              className={`min-h-[44px] py-2 px-3 text-xs sm:text-sm font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center ${
                cycle === 'monthly'
                  ? 'bg-white text-[#142D4E] shadow-xs border border-slate-200/60'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Monthly ({playProducts[PLAY_PRODUCT_IDS.MONTHLY]?.formattedPrice || '$14.99'})
            </button>
            <button
              type="button"
              onClick={() => setCycle('annual')}
              className={`min-h-[44px] py-2 px-3 text-xs sm:text-sm font-bold rounded-xl transition-all cursor-pointer flex flex-wrap items-center justify-center gap-1 ${
                cycle === 'annual'
                  ? 'bg-teal-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>Annual ({playProducts[PLAY_PRODUCT_IDS.ANNUAL]?.formattedPrice || '$109.99'})</span>
              <span
                className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded-md ${
                  cycle === 'annual' ? 'bg-amber-400 text-slate-950' : 'bg-emerald-100 text-emerald-800'
                }`}
              >
                Save 38%
              </span>
            </button>
          </div>

          {/* Pricing Highlight Card */}
          <div className="p-5 rounded-2xl border-2 border-teal-500/40 bg-teal-50/20 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-teal-800">
                {currentProduct.title || (cycle === 'monthly' ? 'Monthly Plan' : 'Annual Plan')}
              </span>
              <div className="flex items-baseline gap-1 mt-1">
                <span className="text-3xl font-extrabold text-[#142D4E] tabular-nums">
                  {currentProduct.formattedPrice}
                </span>
                <span className="text-xs font-medium text-slate-500">
                  {cycle === 'monthly' ? '/month' : '/year'}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {cycle === 'annual' ? 'Billed annually (~$9.16/mo)' : 'Billed monthly via Google Play'}
              </p>
            </div>

            {cycle === 'annual' && (
              <div className="sm:text-right p-2.5 bg-emerald-50 rounded-xl border border-emerald-200 text-emerald-900 text-xs">
                <span className="font-bold block">Best Value Plan</span>
                <span className="text-[11px] text-emerald-800">Equivalent to ~$9.16 / month</span>
              </div>
            )}
          </div>

          {/* Free vs Premium Plan Comparison Matrix */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
              Free vs. Premium Plan Comparison
            </h3>

            <div className="rounded-2xl border border-slate-200 overflow-hidden text-xs">
              {/* Table Header */}
              <div className="grid grid-cols-12 bg-slate-100/80 p-2.5 sm:p-3 font-bold text-slate-700 border-b border-slate-200 gap-1">
                <span className="col-span-6 sm:col-span-7">Capability</span>
                <span className="col-span-3 sm:col-span-2 text-center text-slate-600">Free</span>
                <span className="col-span-3 text-center text-teal-700 font-extrabold">Premium</span>
              </div>

              {/* Rows */}
              <div className="divide-y divide-slate-100">
                <div className="grid grid-cols-12 p-2.5 sm:p-3 items-center gap-1">
                  <div className="col-span-6 sm:col-span-7 font-medium text-slate-800 min-w-0">
                    Local Expense Tracking
                    <span className="block text-[10px] text-slate-400 font-normal">Offline-ready on device</span>
                  </div>
                  <div className="col-span-3 sm:col-span-2 text-center text-emerald-600 font-bold">
                    <Check className="w-4 h-4 mx-auto" />
                  </div>
                  <div className="col-span-3 text-center text-teal-700 font-bold">
                    <Check className="w-4 h-4 mx-auto" />
                  </div>
                </div>

                <div className="grid grid-cols-12 p-2.5 sm:p-3 items-center bg-slate-50/50 gap-1">
                  <div className="col-span-6 sm:col-span-7 font-medium text-slate-800 min-w-0">
                    Monthly Budget &amp; Daily Burn Rate
                    <span className="block text-[10px] text-slate-400 font-normal">Deterministic allowance math</span>
                  </div>
                  <div className="col-span-3 sm:col-span-2 text-center text-emerald-600 font-bold">
                    <Check className="w-4 h-4 mx-auto" />
                  </div>
                  <div className="col-span-3 text-center text-teal-700 font-bold">
                    <Check className="w-4 h-4 mx-auto" />
                  </div>
                </div>

                <div className="grid grid-cols-12 p-2.5 sm:p-3 items-center gap-1">
                  <div className="col-span-6 sm:col-span-7 font-medium text-slate-800 min-w-0">
                    Universal CSV Export
                    <span className="block text-[10px] text-slate-400 font-normal">Download full ledger anytime</span>
                  </div>
                  <div className="col-span-3 sm:col-span-2 text-center text-emerald-600 font-bold">
                    <Check className="w-4 h-4 mx-auto" />
                  </div>
                  <div className="col-span-3 text-center text-teal-700 font-bold">
                    <Check className="w-4 h-4 mx-auto" />
                  </div>
                </div>

                <div className="grid grid-cols-12 p-2.5 sm:p-3 items-center bg-teal-50/20 gap-1">
                  <div className="col-span-6 sm:col-span-7 font-medium text-[#142D4E] min-w-0">
                    AI Personal Spending Coach
                    <span className="block text-[10px] text-slate-500 font-normal">Gemini reasoning &amp; velocity tips</span>
                  </div>
                  <div className="col-span-3 sm:col-span-2 text-center text-slate-300 font-bold">—</div>
                  <div className="col-span-3 text-center text-teal-700 font-bold flex items-center justify-center gap-0.5 text-[11px]">
                    <Sparkles className="w-3 h-3 text-amber-500 shrink-0" />
                    <span>Included</span>
                  </div>
                </div>

                <div className="grid grid-cols-12 p-2.5 sm:p-3 items-center bg-teal-50/20 gap-1">
                  <div className="col-span-6 sm:col-span-7 font-medium text-[#142D4E] min-w-0">
                    AI Financial Recommendations
                    <span className="block text-[10px] text-slate-500 font-normal">Anomaly detection &amp; optimizations</span>
                  </div>
                  <div className="col-span-3 sm:col-span-2 text-center text-slate-300 font-bold">—</div>
                  <div className="col-span-3 text-center text-teal-700 font-bold flex items-center justify-center gap-0.5 text-[11px]">
                    <Sparkles className="w-3 h-3 text-amber-500 shrink-0" />
                    <span>Included</span>
                  </div>
                </div>

                <div className="grid grid-cols-12 p-2.5 sm:p-3 items-center bg-teal-50/20 gap-1">
                  <div className="col-span-6 sm:col-span-7 font-medium text-[#142D4E] min-w-0">
                    Multi-Device Cloud Sync &amp; Backup
                    <span className="block text-[10px] text-slate-500 font-normal">Encrypted off-device backup</span>
                  </div>
                  <div className="col-span-3 sm:col-span-2 text-center text-slate-300 font-bold">—</div>
                  <div className="col-span-3 text-center text-teal-700 font-bold flex items-center justify-center gap-0.5 text-[11px]">
                    <Cloud className="w-3 h-3 text-teal-600 shrink-0" />
                    <span>Included</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Google Play Subscription Action */}
          <div className="p-5 bg-gradient-to-br from-slate-50 to-teal-50/40 rounded-2xl border border-teal-200/60 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-teal-700 shrink-0" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  {stageAvailability.purchasesEnabled ? 'Subscribe with Google Play' : 'Stage 1 Offline-First Core Build'}
                </h4>
              </div>
              <span className="text-[11px] font-bold text-teal-800 bg-teal-100 px-2 py-0.5 rounded-md">
                {stageAvailability.purchasesEnabled
                  ? `${currentProduct.formattedPrice} ${cycle === 'monthly' ? '/mo' : '/yr'}`
                  : 'Stage 2 Planned'}
              </span>
            </div>

            {!stageAvailability.purchasesEnabled ? (
              <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-950 space-y-1.5">
                <p className="font-bold">Premium Purchases Not Active in Stage 1</p>
                <p className="text-[11px] text-amber-900 leading-relaxed">
                  All core ExpenseFlow features—local expense logging, monthly budgets, daily burn rate, affordability planner, insights charts, voice entry, and CSV export—are <strong>100% free right now</strong>. In-app Google Play subscriptions, AI Spending Coach, and cloud sync will activate later in Stage 2.
                </p>
              </div>
            ) : (
              <>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Google Play In-App Billing handles payment security, receipt validation, and automatic renewal with one-tap cancellation anytime.
                </p>

                {!authUser && (
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-950 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
                    <span>Sign in with your ExpenseFlow account to link your subscription.</span>
                    {onRequireAuth && (
                      <button
                        type="button"
                        onClick={() =>
                          onRequireAuth('Sign in or create an ExpenseFlow account so your Google Play subscription stays linked to your account.')
                        }
                        className="min-h-[44px] px-4 py-2 rounded-xl bg-[#142D4E] hover:bg-[#1E3E66] text-white font-bold text-xs shrink-0 cursor-pointer"
                      >
                        Sign In
                      </button>
                    )}
                  </div>
                )}
              </>
            )}

            <button
              type="button"
              disabled={!stageAvailability.purchasesEnabled || isPurchasing}
              onClick={handleStartSubscription}
              className="w-full min-h-[48px] py-3 px-4 bg-teal-600 hover:bg-teal-700 active:bg-teal-800 text-white text-xs sm:text-sm font-bold rounded-xl transition-all shadow-xs cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {!stageAvailability.purchasesEnabled ? (
                <>
                  <Lock className="w-4 h-4 shrink-0" />
                  <span className="truncate">Unavailable in Stage 1 — Coming Later</span>
                </>
              ) : isPurchasing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Connecting to Google Play...</span>
                </>
              ) : (
                <>
                  <Shield className="w-4 h-4 shrink-0" />
                  <span className="truncate">Subscribe to {currentProduct.title || 'ExpenseFlow Premium'}</span>
                  <ArrowRight className="w-3.5 h-3.5 ml-auto shrink-0" />
                </>
              )}
            </button>

            {statusMessage && (
              <div
                className={`p-3 rounded-xl border text-xs flex items-start gap-2 ${
                  statusMessage.type === 'success'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : statusMessage.type === 'pending'
                    ? 'bg-amber-50 border-amber-200 text-amber-900'
                    : statusMessage.type === 'info'
                    ? 'bg-slate-100 border-slate-300 text-slate-800'
                    : 'bg-rose-50 border-rose-200 text-rose-900'
                }`}
              >
                {statusMessage.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                )}
                <span className="leading-relaxed">{statusMessage.text}</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] sm:pb-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 shrink-0">
          <div className="text-[11px] text-slate-500">
            Current Tier:{' '}
            <strong className="text-slate-800 uppercase font-bold">
              {currentTier} ({currentTier === 'premium' ? 'Active' : '$0'})
            </strong>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={!stageAvailability.purchasesEnabled || isRestoring}
              onClick={handleRestore}
              className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 rounded-xl transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isRestoring ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              <span>Restore Purchases</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-4 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-xl transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
