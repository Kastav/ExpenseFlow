import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Expense, BudgetSettings, CurrencyCode } from '../types/expense';
import { CoachChatMessage, SafeFinancialSummary, CoachBackendStatus } from '../types/coach';
import {
  buildSafeFinancialSummary,
  sendCoachChatMessage,
  checkCoachBackendStatus,
  getCoachLocalUsage,
  MAX_MONTHLY_QUOTA,
} from '../services/aiCoachService';
import { getCurrentUserPlanTier } from '../utils/premium';
import {
  X,
  Send,
  Sparkles,
  Bot,
  User,
  AlertCircle,
  Clock,
  Shield,
  Loader2,
  Lock,
  ArrowRight,
  TrendingUp,
  AlertTriangle,
} from 'lucide-react';

interface AiSpendingCoachModalProps {
  isOpen: boolean;
  onClose: () => void;
  transactions: Expense[];
  budget: BudgetSettings;
  currency: CurrencyCode;
  onOpenUpgrade?: () => void;
}

export const AiSpendingCoachModal: React.FC<AiSpendingCoachModalProps> = ({
  isOpen,
  onClose,
  transactions,
  budget,
  currency,
  onOpenUpgrade,
}) => {
  const [messages, setMessages] = useState<CoachChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [backendStatus, setBackendStatus] = useState<CoachBackendStatus | null>(null);
  const [statusChecked, setStatusChecked] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [localRequestsCount, setLocalRequestsCount] = useState<number>(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const userTier = getCurrentUserPlanTier();
  const isPremium = userTier === 'premium';

  // Build safe aggregated financial summary (Strict data minimization)
  const financialSummary: SafeFinancialSummary = useMemo(() => {
    return buildSafeFinancialSummary(transactions, budget, currency);
  }, [transactions, budget, currency]);

  // Check backend availability on open
  useEffect(() => {
    if (isOpen) {
      setErrorBanner(null);
      const usage = getCoachLocalUsage();
      setLocalRequestsCount(usage.requestsCount);

      checkCoachBackendStatus().then((status) => {
        setBackendStatus(status);
        setStatusChecked(true);
      });

      // Initialize welcome message if empty
      if (messages.length === 0) {
        const welcomeText = financialSummary.monthlyBudget > 0
          ? `Hello! I'm your ExpenseFlow Personal Spending Coach. For this month, you have spent ${financialSummary.currency}${financialSummary.currentMonthTotalSpent.toFixed(2)} of your ${financialSummary.currency}${financialSummary.monthlyBudget.toFixed(2)} budget (${financialSummary.budgetUtilizationPct}% utilized). You have approximately ${financialSummary.currency}${financialSummary.recommendedDailyAllowance.toFixed(2)}/day available for the remaining ${financialSummary.daysRemainingInMonth} days. How can I assist your financial planning today?`
          : `Hello! I'm your ExpenseFlow Personal Spending Coach. You have recorded ${financialSummary.currency}${financialSummary.currentMonthTotalSpent.toFixed(2)} in expenses this month without a target monthly budget set. Setting a budget helps me recommend personalized daily spending limits! What financial question can I help you with today?`;

        setMessages([
          {
            id: 'msg_welcome',
            sender: 'coach',
            text: welcomeText,
            timestamp: Date.now(),
          },
        ]);
      }
    }
  }, [isOpen, financialSummary, messages.length]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading, isOpen]);

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

  const handleSendMessage = async (customText?: string) => {
    const textToSend = (customText || inputText).trim();
    if (!textToSend || isLoading) return;

    if (!isPremium) {
      setErrorBanner('The AI Spending Coach is an ExpenseFlow Premium feature.');
      return;
    }

    if (textToSend.length > 500) {
      setErrorBanner('Please limit your question to 500 characters.');
      return;
    }

    setErrorBanner(null);
    setInputText('');

    const userMsgId = `msg_user_${Date.now()}`;
    const newMessages: CoachChatMessage[] = [
      ...messages,
      {
        id: userMsgId,
        sender: 'user',
        text: textToSend,
        timestamp: Date.now(),
      },
    ];

    setMessages(newMessages);
    setIsLoading(true);

    // Format chat history for API (last 6 messages)
    const historyPayload = newMessages
      .slice(-6)
      .map((m) => ({
        role: (m.sender === 'user' ? 'user' : 'model') as 'user' | 'model',
        text: m.text,
      }));

    try {
      const result = await sendCoachChatMessage(textToSend, historyPayload, financialSummary);

      if (result.success && result.reply) {
        setMessages((prev) => [
          ...prev,
          {
            id: `msg_coach_${Date.now()}`,
            sender: 'coach',
            text: result.reply!,
            timestamp: Date.now(),
          },
        ]);
        if (result.usage) {
          setLocalRequestsCount(result.usage.monthlyRequestsUsed);
        } else {
          setLocalRequestsCount((c) => c + 1);
        }
      } else {
        const errorMsg = result.message || 'Unable to generate coach response. Please try again.';
        setErrorBanner(errorMsg);
        setMessages((prev) => [
          ...prev,
          {
            id: `msg_err_${Date.now()}`,
            sender: 'coach',
            text: `[Service Notice] ${errorMsg}`,
            timestamp: Date.now(),
            status: 'error',
          },
        ]);
      }
    } catch {
      setErrorBanner('Network error connecting to ExpenseFlow AI Coach service.');
    } finally {
      setIsLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const sampleQuestions = [
    'How is my spending velocity this month?',
    'How much can I safely spend per day?',
    'Which categories should I look to trim?',
    'Tips to build an emergency savings cushion',
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-coach-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-xs overflow-hidden animate-in fade-in"
    >
      <div
        className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col h-[92vh] max-h-[760px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Ribbon */}
        <div className="bg-gradient-to-r from-[#142D4E] via-[#1E3E66] to-teal-800 text-white p-4 sm:p-5 shrink-0 relative">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close AI Coach"
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-2 mb-1.5">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-400 text-slate-950 uppercase tracking-wider shadow-2xs">
              <Sparkles className="w-3 h-3 fill-current" />
              AI Coach
            </span>
            <span className="text-[11px] text-teal-200 font-medium">Gemini 3.8 Flash</span>
          </div>

          <h2 id="ai-coach-title" className="text-xl sm:text-2xl font-extrabold tracking-tight">
            Personal Spending Coach
          </h2>
          <p className="text-xs text-teal-100/90 mt-0.5 max-w-md">
            Empathetic, data-backed financial guidance with strict privacy &amp; data minimization.
          </p>

          {/* Quota & Cost Protection Indicator */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-teal-100/80 bg-white/10 px-3 py-1.5 rounded-xl border border-white/10">
            <span className="flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-teal-300" />
              <span>Data Minimized (Aggregates Only)</span>
            </span>
            <span className="font-mono">
              Monthly Usage: <strong className="text-white">{localRequestsCount} / {MAX_MONTHLY_QUOTA}</strong>
            </span>
          </div>
        </div>

        {/* Aggregated Financial Snapshot Ribbon */}
        <div className="bg-slate-50 border-b border-slate-200 px-4 py-2.5 text-xs text-slate-600 flex items-center justify-between gap-2 overflow-x-auto shrink-0">
          <div className="flex items-center gap-4 shrink-0">
            <span className="flex items-center gap-1">
              <span className="font-semibold text-slate-500">Spend:</span>
              <strong className="text-[#142D4E]">
                {currency}{financialSummary.currentMonthTotalSpent.toFixed(0)}
              </strong>
            </span>
            <span className="flex items-center gap-1">
              <span className="font-semibold text-slate-500">Budget:</span>
              <strong className="text-[#142D4E]">
                {financialSummary.monthlyBudget > 0 ? `${currency}${financialSummary.monthlyBudget.toFixed(0)}` : 'None'}
              </strong>
            </span>
            <span className="flex items-center gap-1">
              <span className="font-semibold text-slate-500">Daily Pace:</span>
              <strong className="text-teal-700">
                {currency}{financialSummary.recommendedDailyAllowance.toFixed(1)}/day
              </strong>
            </span>
          </div>

          <span
            className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full shrink-0 ${
              financialSummary.spendingVelocityStatus === 'critical'
                ? 'bg-rose-100 text-rose-800'
                : financialSummary.spendingVelocityStatus === 'caution'
                ? 'bg-amber-100 text-amber-800'
                : 'bg-emerald-100 text-emerald-800'
            }`}
          >
            Velocity: {financialSummary.spendingVelocityStatus}
          </span>
        </div>

        {/* Not Premium Gating Overlay if user is not on Premium Tier */}
        {!isPremium ? (
          <div className="flex-1 p-6 flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center shadow-xs">
              <Lock className="w-7 h-7" />
            </div>

            <div className="space-y-1.5">
              <h3 className="text-lg font-bold text-[#142D4E]">
                ExpenseFlow Premium Feature
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                The AI Personal Spending Coach generates personalized financial advice using Gemini cloud intelligence. Because this incurs ongoing server &amp; token costs, it is strictly reserved for Premium members.
              </p>
            </div>

            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-700 text-left w-full space-y-1.5">
              <div className="font-bold text-[#142D4E] flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                <span>What you get with Premium:</span>
              </div>
              <ul className="list-disc list-inside space-y-1 text-slate-600 text-[11px]">
                <li>Conversational budget &amp; velocity reasoning</li>
                <li>Actionable tips to reduce discretionary leaks</li>
                <li>100 AI coach queries included every month</li>
                <li>Multi-device cloud backup &amp; sync</li>
              </ul>
            </div>

            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenUpgrade?.();
              }}
              className="w-full py-3 px-4 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs rounded-xl transition-all shadow-xs flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>Explore Premium Plans ($14.99/mo or $109.99/yr)</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <>
            {/* Server Configuration Notice if backend reports unconfigured key */}
            {statusChecked && backendStatus?.requiresConfig && (
              <div className="m-3 p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-3 shrink-0">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h4 className="font-bold text-amber-950">Backend Setup Required</h4>
                  <p className="text-amber-800 leading-relaxed text-[11px]">
                    The Gemini API key (<code className="font-mono bg-white px-1 py-0.5 rounded border border-amber-300">GEMINI_API_KEY</code>) is not yet configured in the server environment. Responses cannot be generated until the key is set in <strong>Settings &gt; Secrets</strong>.
                  </p>
                </div>
              </div>
            )}

            {/* Error Banner */}
            {errorBanner && (
              <div
                role="alert"
                className="mx-3 mt-2 p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-900 text-xs flex items-center gap-2 shrink-0 animate-in fade-in"
              >
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span className="leading-snug">{errorBanner}</span>
              </div>
            )}

            {/* Chat Message Scrollable Body */}
            <div className="flex-1 p-4 overflow-y-auto space-y-4">
              {messages.map((msg) => {
                const isUser = msg.sender === 'user';
                return (
                  <div
                    key={msg.id}
                    className={`flex items-start gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
                  >
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-white text-xs ${
                        isUser ? 'bg-[#142D4E]' : 'bg-teal-600 shadow-2xs'
                      }`}
                    >
                      {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                    </div>

                    <div
                      className={`max-w-[82%] sm:max-w-[75%] rounded-2xl px-4 py-3 text-xs sm:text-sm leading-relaxed whitespace-pre-wrap break-words ${
                        isUser
                          ? 'bg-[#142D4E] text-white rounded-tr-xs'
                          : msg.status === 'error'
                          ? 'bg-rose-50 text-rose-900 border border-rose-200 rounded-tl-xs'
                          : 'bg-slate-100 text-slate-800 rounded-tl-xs border border-slate-200/60'
                      }`}
                    >
                      {msg.text}
                      <span
                        className={`block text-[10px] mt-1.5 opacity-60 text-right ${
                          isUser ? 'text-teal-200' : 'text-slate-500'
                        }`}
                      >
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                );
              })}

              {isLoading && (
                <div className="flex items-start gap-2.5 animate-in fade-in">
                  <div className="w-7 h-7 rounded-lg bg-teal-600 text-white flex items-center justify-center shrink-0">
                    <Bot className="w-4 h-4" />
                  </div>
                  <div className="bg-slate-100 rounded-2xl rounded-tl-xs px-4 py-3 text-xs text-slate-600 border border-slate-200/60 flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-600" />
                    <span>Analyzing spending context and formulating guidance...</span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Quick Prompt Suggestions */}
            <div className="px-3 py-2 bg-slate-50/80 border-t border-slate-200/80 flex items-center gap-1.5 overflow-x-auto shrink-0">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider shrink-0 pl-1">
                Suggested:
              </span>
              {sampleQuestions.map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={isLoading}
                  onClick={() => handleSendMessage(q)}
                  className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg text-[11px] text-slate-700 whitespace-nowrap transition-colors cursor-pointer disabled:opacity-50 shrink-0"
                >
                  {q}
                </button>
              ))}
            </div>

            {/* Input Box Footer */}
            <div className="p-3 bg-white border-t border-slate-200 shrink-0">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendMessage();
                }}
                className="flex items-center gap-2"
              >
                <div className="relative flex-1">
                  <input
                    ref={inputRef}
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="Ask about your budget, spending pace, or savings..."
                    maxLength={500}
                    disabled={isLoading}
                    className="w-full pl-3.5 pr-14 py-2.5 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600 text-slate-800 placeholder-slate-400 disabled:opacity-50"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 font-mono pointer-events-none">
                    {inputText.length}/500
                  </span>
                </div>

                <button
                  type="submit"
                  disabled={isLoading || !inputText.trim()}
                  aria-label="Send question to AI Coach"
                  className="w-10 h-10 rounded-xl bg-teal-600 hover:bg-teal-700 active:bg-teal-800 text-white flex items-center justify-center shrink-0 transition-all shadow-xs disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  {isLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </button>
              </form>

              <p className="text-[10px] text-slate-400 text-center mt-2 leading-tight">
                AI Coach provides general educational financial guidance. It is not a certified financial advisor or fiduciary.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
