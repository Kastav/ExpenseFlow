import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CurrencyCode, ExpenseCategory, CATEGORIES, PAYMENT_METHODS } from '../types/expense';
import { parseVoiceExpense, ParsedVoiceExpense } from '../utils/voiceExpenseParser';
import {
  Mic,
  MicOff,
  Square,
  AlertCircle,
  CheckCircle2,
  Sparkles,
  RotateCcw,
  X,
  Pencil,
  Loader2,
  ArrowRight,
  CreditCard,
  Check,
  ChevronDown,
  Tag,
  Calendar,
} from 'lucide-react';
import { CategorySelectorModal, getCategoryIcon } from './CategorySelectorModal';
import { PaymentMethodSelectorModal, getPaymentMethodIcon } from './PaymentMethodSelectorModal';
import { DatePickerModal } from './DatePickerModal';
import { formatDate, getTodayDateString } from '../utils/formatters';

interface VoiceExpenseControlProps {
  currentCurrency: CurrencyCode;
  onApplyParsedExpense?: (parsed: ParsedVoiceExpense) => void;
  onDirectSaveExpense?: (expenseData: {
    amount: number;
    category: ExpenseCategory;
    date: string;
    paymentMethod?: string;
    notes?: string;
  }) => boolean;
  className?: string;
  buttonVariant?: 'header' | 'compact' | 'pill';
}

type VoiceStatus = 'idle' | 'listening' | 'processing' | 'reviewed' | 'error' | 'unsupported';

export interface VoiceDiagnostics {
  isSecureContext: boolean;
  hasMediaDevices: boolean;
  hasGetUserMedia: boolean;
  hasSpeechRecognition: boolean;
  hasWebkitSpeechRecognition: boolean;
  stage: string;
  exceptionName?: string;
  exceptionMessage?: string;
  recognitionCalled: boolean;
  onStartFired: boolean;
}

interface VoiceDiagnosticError {
  title: string;
  message: string;
  diagnostics?: VoiceDiagnostics;
}

export const VoiceExpenseControl: React.FC<VoiceExpenseControlProps> = ({
  currentCurrency,
  onApplyParsedExpense,
  onDirectSaveExpense,
  className = '',
}) => {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [interimTranscript, setInterimTranscript] = useState<string>('');
  const [finalTranscript, setFinalTranscript] = useState<string>('');
  const [errorDetails, setErrorDetails] = useState<VoiceDiagnosticError | null>(null);
  const [parsedResult, setParsedResult] = useState<ParsedVoiceExpense | null>(null);

  // Direct save and review edit state
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);
  const [directSaveError, setDirectSaveError] = useState<string | null>(null);
  const [isEditingInline, setIsEditingInline] = useState<boolean>(false);
  const [editableAmount, setEditableAmount] = useState<string>('');
  const [editableCategory, setEditableCategory] = useState<ExpenseCategory>('Groceries');
  const [editableDate, setEditableDate] = useState<string>('');
  const [editablePaymentMethod, setEditablePaymentMethod] = useState<string>('');
  const [editableNotes, setEditableNotes] = useState<string>('');
  const [isVoiceCategoryModalOpen, setIsVoiceCategoryModalOpen] = useState<boolean>(false);
  const [isVoicePaymentModalOpen, setIsVoicePaymentModalOpen] = useState<boolean>(false);
  const [isVoiceDateModalOpen, setIsVoiceDateModalOpen] = useState<boolean>(false);

  const recognitionRef = useRef<any>(null);
  const silenceTimeoutRef = useRef<any>(null);
  const isStartingRef = useRef<boolean>(false);

  // Fully cleanup any existing recognition session, timers, and event listeners
  const cleanupRecognition = useCallback(() => {
    isStartingRef.current = false;
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        const rec = recognitionRef.current;
        rec.onstart = null;
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        rec.abort();
      } catch {
        // Safe ignore
      }
      recognitionRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupRecognition();
    };
  }, [cleanupRecognition]);

  // Listen dynamically for microphone permission changes in browser settings
  useEffect(() => {
    let permStatusObj: any = null;
    let isMounted = true;

    if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'microphone' as PermissionName })
        .then((permStatus) => {
          if (!isMounted) return;
          permStatusObj = permStatus;
          permStatus.onchange = () => {
            if (!isMounted) return;
            if (permStatus.state === 'granted') {
              // Permission was granted in browser settings! Automatically clear denial error
              setErrorDetails(null);
              setStatus('idle');
            }
          };
        })
        .catch(() => {
          // Safe ignore if permissions query fails
        });
    }

    return () => {
      isMounted = false;
      if (permStatusObj) {
        permStatusObj.onchange = null;
      }
    };
  }, []);

  const stopRecognition = useCallback(() => {
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        cleanupRecognition();
      }
    }
  }, [cleanupRecognition]);

  const handleStartListening = useCallback(async () => {
    // 0. Prevent concurrent duplicate calls from rapid clicks
    if (isStartingRef.current) return;
    isStartingRef.current = true;

    // 1. Clean up any active session before starting a fresh one
    cleanupRecognition();

    // Clear previous error states immediately so user doesn't see premature error flashes while prompt is active
    setErrorDetails(null);
    setDirectSaveError(null);
    setSaveSuccessMessage(null);
    setInterimTranscript('');
    setFinalTranscript('');
    setParsedResult(null);
    setIsEditingInline(false);

    // Collect initial browser environment capabilities for safe diagnostics
    const isSecure = typeof window !== 'undefined' ? Boolean(window.isSecureContext) : false;
    const isEmbeddedIframe = typeof window !== 'undefined' && window.self !== window.top;
    const hasMediaDevs = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices);
    const hasGUM = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
    const SpeechRecognition =
      typeof window !== 'undefined'
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null;

    // 2. Secure context validation
    if (!isSecure) {
      isStartingRef.current = false;
      setStatus('error');
      setErrorDetails({
        title: 'Voice Entry Note',
        message: 'Microphone access requires a secure HTTPS connection. Please enter your expense details manually below.',
      });
      return;
    }

    // 3. Feature detection for Web Speech API
    if (!SpeechRecognition) {
      isStartingRef.current = false;
      setStatus('unsupported');
      setErrorDetails({
        title: 'Voice Entry Note',
        message: 'Speech recognition is not supported in this browser window. You can enter details manually below.',
      });
      return;
    }

    // 4. Query existing microphone permission state if Permissions API is supported
    let permState: PermissionState | 'unknown' = 'unknown';
    if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
      try {
        const permStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        permState = permStatus.state;
      } catch {
        // Safe ignore if Permissions API not supported or restricted
      }
    }

    // If permission is known to be explicitly denied in browser settings, inform the user immediately
    if (permState === 'denied') {
      isStartingRef.current = false;
      setStatus('error');
      setErrorDetails({
        title: 'Voice Entry Note',
        message: isEmbeddedIframe
          ? 'Microphone access is restricted in this embedded preview frame or blocked in browser settings. Manual expense entry is fully functional below.'
          : 'Microphone access is currently blocked in your browser settings. To use voice entry, tap the lock or site settings icon in your address bar, set Microphone to Allow, then tap Try Again. Manual entry is always available below.',
      });
      return;
    }

    // 5. Directly start SpeechRecognition
    // Browser engines (Chromium, Safari, Edge) handle microphone authorization natively upon start()
    // Calling getUserMedia and stopping tracks prior to start() causes an audio device release race condition.
    try {
      const recognition = new SpeechRecognition();
      // Continuous mode allows natural pauses without premature cutoffs
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      try {
        recognition.lang =
          typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en-US';
      } catch {
        recognition.lang = 'en-US';
      }

      recognition.onstart = () => {
        isStartingRef.current = false;
        setStatus('listening');
        setErrorDetails(null);
      };

      recognition.onresult = (event: any) => {
        let finalAccum = '';
        let interimAccum = '';

        for (let i = 0; i < event.results.length; ++i) {
          const res = event.results[i];
          if (res.isFinal) {
            finalAccum += res[0].transcript + ' ';
          } else {
            interimAccum += res[0].transcript;
          }
        }

        const trimmedFinal = finalAccum.trim();
        const trimmedInterim = interimAccum.trim();

        if (trimmedInterim) setInterimTranscript(trimmedInterim);
        if (trimmedFinal) {
          setFinalTranscript(trimmedFinal);
        }

        if (silenceTimeoutRef.current) {
          clearTimeout(silenceTimeoutRef.current);
          silenceTimeoutRef.current = null;
        }

        if (trimmedFinal) {
          silenceTimeoutRef.current = setTimeout(() => {
            stopRecognition();
          }, 3500);
        }
      };

      recognition.onerror = (event: any) => {
        isStartingRef.current = false;
        const errCode = event.error;

        if (errCode === 'not-allowed') {
          setStatus('error');
          setErrorDetails({
            title: 'Voice Entry Note',
            message: isEmbeddedIframe
              ? 'Microphone access is restricted in this preview frame. If you recently updated your browser settings to allow the microphone, reload the page to apply, or enter your expense manually.'
              : 'Microphone access was denied. If you recently changed browser permissions to Allow, reload the page or tap Try Again.',
          });
        } else if (errCode === 'no-speech') {
          setStatus('error');
          setErrorDetails({
            title: 'Voice Entry Note',
            message: 'No speech was detected. Tap Try Again and speak clearly near your microphone.',
          });
        } else if (errCode === 'audio-capture') {
          setStatus('error');
          setErrorDetails({
            title: 'Voice Entry Note',
            message:
              'No microphone was detected or audio hardware is busy in another app. Please tap Try Again or enter details manually.',
          });
        } else if (errCode === 'network') {
          setStatus('error');
          setErrorDetails({
            title: 'Voice Entry Note',
            message:
              'Speech recognition service could not be reached. Please check your network connection or enter details manually below.',
          });
        } else if (errCode === 'service-not-allowed') {
          setStatus('error');
          setErrorDetails({
            title: 'Voice Entry Note',
            message:
              'Speech recognition service is restricted by your browser or system settings. You can enter details manually below.',
          });
        } else if (errCode === 'aborted') {
          // Normal abort from user or session reset
          setStatus('idle');
          return;
        } else if (errCode === 'language-not-supported') {
          setStatus('error');
          setErrorDetails({
            title: 'Voice Entry Note',
            message: 'The selected language is not supported by your browser speech engine. Please enter details manually.',
          });
        } else {
          setStatus('error');
          setErrorDetails({
            title: 'Voice Entry Note',
            message: `Speech input could not be processed (${errCode || 'error'}). Please enter details manually below.`,
          });
        }
      };

      recognition.onend = () => {
        isStartingRef.current = false;
        if (silenceTimeoutRef.current) {
          clearTimeout(silenceTimeoutRef.current);
          silenceTimeoutRef.current = null;
        }
        setStatus((prev) => {
          if (prev === 'listening') {
            return 'processing';
          }
          return prev;
        });
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err: any) {
      cleanupRecognition();
      isStartingRef.current = false;
      const errName = err?.name || '';
      const isDenied = errName === 'NotAllowedError' || errName === 'SecurityError';
      setStatus('error');
      setErrorDetails({
        title: 'Voice Entry Note',
        message: isDenied
          ? 'Microphone access is not permitted in this context. Please allow microphone access or enter details manually below.'
          : `Microphone could not be started (${errName || 'error'}). Tap Try Again or enter details manually below.`,
      });
    }
  }, [cleanupRecognition, stopRecognition]);

  // Reliable Try Again handler that thoroughly resets state and retries cleanly
  const handleTryAgain = useCallback(() => {
    cleanupRecognition();
    isStartingRef.current = false;
    setErrorDetails(null);
    setDirectSaveError(null);
    setInterimTranscript('');
    setFinalTranscript('');
    setParsedResult(null);
    setIsEditingInline(false);
    setEditablePaymentMethod('');
    setStatus('idle');

    handleStartListening();
  }, [cleanupRecognition, handleStartListening]);

  // When speech concludes and we enter processing, parse the final transcript
  useEffect(() => {
    if (status === 'processing') {
      const textToParse = (finalTranscript || interimTranscript).trim();
      if (!textToParse) {
        setStatus('error');
        setErrorDetails({
          title: 'Voice Entry Note',
          message: 'No speech was detected. Please tap Try Again and speak your transaction details clearly.',
        });
        return;
      }

      const parsed = parseVoiceExpense(textToParse, currentCurrency);
      setParsedResult(parsed);
      setEditableAmount(parsed.amount !== null ? parsed.amount.toString() : '');
      setEditableCategory(parsed.category);
      setEditableDate(parsed.date);
      setEditablePaymentMethod(parsed.suggestedPaymentMethod || '');
      setEditableNotes(parsed.notes);
      // Auto-open inline editor if amount is missing so user can specify it immediately
      setIsEditingInline(parsed.amount === null);
      setDirectSaveError(null);
      setStatus('reviewed');
    }
  }, [status, finalTranscript, interimTranscript, currentCurrency]);

  const handleCancel = () => {
    cleanupRecognition();
    setStatus('idle');
    setInterimTranscript('');
    setFinalTranscript('');
    setParsedResult(null);
    setErrorDetails(null);
    setDirectSaveError(null);
    setEditablePaymentMethod('');
    setIsEditingInline(false);
  };

  // Direct Save handler: saves directly to persistent storage with validation and duplicate prevention
  const handleDirectSave = useCallback(() => {
    if (isSaving || !parsedResult) return;

    // Validate amount
    const amtStr = isEditingInline ? editableAmount.trim() : (parsedResult.amount !== null ? parsedResult.amount.toString() : editableAmount.trim());
    const amtNum = parseFloat(amtStr);

    if (!amtStr || isNaN(amtNum) || !isFinite(amtNum) || amtNum <= 0) {
      setDirectSaveError('Please enter a valid expense amount greater than 0 before saving.');
      setIsEditingInline(true);
      return;
    }

    if (amtNum > 100000000) {
      setDirectSaveError('Amount exceeds maximum allowable threshold (100,000,000).');
      return;
    }

    const cleanAmount = Math.round(amtNum * 100) / 100;
    const cat = isEditingInline ? editableCategory : parsedResult.category;
    const dt = isEditingInline ? (editableDate.trim() || parsedResult.date) : parsedResult.date;
    const nts = (isEditingInline ? editableNotes.trim() : parsedResult.notes.trim()) || undefined;
    const pm = isEditingInline
      ? (editablePaymentMethod.trim() || undefined)
      : parsedResult.suggestedPaymentMethod;

    setIsSaving(true);
    setDirectSaveError(null);

    try {
      if (onDirectSaveExpense) {
        const saved = onDirectSaveExpense({
          amount: cleanAmount,
          category: cat,
          date: dt,
          notes: nts,
          paymentMethod: pm,
        });

        if (saved) {
          const formatted = `${currentCurrency} ${cleanAmount.toFixed(2)}`;
          setSaveSuccessMessage(`Expense of ${formatted} saved successfully.`);
          cleanupRecognition();
          setStatus('idle');
          setParsedResult(null);
          setIsEditingInline(false);
          setEditablePaymentMethod('');
          setInterimTranscript('');
          setFinalTranscript('');
          setIsSaving(false);

          setTimeout(() => {
            setSaveSuccessMessage(null);
          }, 4500);
          return;
        } else {
          setDirectSaveError('Could not save expense to storage. Your changes could not be persisted.');
          setIsSaving(false);
          return;
        }
      } else if (onApplyParsedExpense) {
        // Fallback to applying to form if onDirectSaveExpense is not passed
        onApplyParsedExpense({
          ...parsedResult,
          amount: cleanAmount,
          category: cat,
          date: dt,
          notes: nts || '',
          suggestedPaymentMethod: pm,
        });
        cleanupRecognition();
        setStatus('idle');
        setParsedResult(null);
        setIsEditingInline(false);
        setEditablePaymentMethod('');
        setIsSaving(false);
      }
    } catch (err: any) {
      setDirectSaveError(`Failed to save expense: ${err?.message || 'Storage error'}`);
      setIsSaving(false);
    }
  }, [
    isSaving,
    parsedResult,
    isEditingInline,
    editableAmount,
    editableCategory,
    editableDate,
    editablePaymentMethod,
    editableNotes,
    onDirectSaveExpense,
    onApplyParsedExpense,
    currentCurrency,
    cleanupRecognition,
  ]);

  // Secondary option: Apply to the full manual form for editing
  const handleApplyToForm = () => {
    if (!parsedResult) return;
    const amtStr = isEditingInline ? editableAmount.trim() : (parsedResult.amount !== null ? parsedResult.amount.toString() : '');
    const amtNum = parseFloat(amtStr);
    const cleanAmount = !isNaN(amtNum) && amtNum > 0 ? Math.round(amtNum * 100) / 100 : null;

    if (onApplyParsedExpense) {
      onApplyParsedExpense({
        ...parsedResult,
        amount: cleanAmount,
        category: isEditingInline ? editableCategory : parsedResult.category,
        date: isEditingInline ? (editableDate || parsedResult.date) : parsedResult.date,
        notes: isEditingInline ? editableNotes : parsedResult.notes,
        suggestedPaymentMethod: isEditingInline
          ? (editablePaymentMethod.trim() || undefined)
          : parsedResult.suggestedPaymentMethod,
      });
    }
    cleanupRecognition();
    setStatus('idle');
    setParsedResult(null);
    setIsEditingInline(false);
    setEditablePaymentMethod('');
  };

  return (
    <div className={`relative ${className}`}>
      {/* Trigger Button: User explicitly initiates recording directly in-app */}
      {status === 'idle' && (
        <button
          type="button"
          onClick={handleStartListening}
          aria-label="Record expense with voice"
          title="Speak transaction details"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-[#142D4E] hover:border-slate-300 text-xs font-semibold shadow-2xs transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#142D4E] cursor-pointer min-h-[36px]"
        >
          <Mic className="w-3.5 h-3.5 text-teal-600" />
          <span className="hidden sm:inline">Voice Entry</span>
          <span className="sm:hidden">Voice</span>
        </button>
      )}

      {/* Direct Save Success Notification */}
      {saveSuccessMessage && (
        <div
          role="status"
          className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-semibold flex items-center justify-between gap-2 my-2 animate-in fade-in"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{saveSuccessMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setSaveSuccessMessage(null)}
            className="text-emerald-700 hover:text-emerald-950 p-1 cursor-pointer"
            aria-label="Dismiss success message"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Active Listening Overlay / Banner directly inside ExpenseFlow */}
      {status === 'listening' && (
        <div
          role="region"
          aria-live="polite"
          className="p-3.5 rounded-2xl bg-teal-50 border border-teal-200 text-teal-950 shadow-xs animate-in fade-in space-y-2.5 my-2"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-teal-600"></span>
              </span>
              <span className="text-xs font-bold uppercase tracking-wider text-teal-800">
                Listening...
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={stopRecognition}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold shadow-2xs transition-all cursor-pointer"
              >
                <Square className="w-3 h-3 fill-current" />
                <span>Done</span>
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="p-1 rounded-lg hover:bg-teal-100 text-teal-800 transition-colors cursor-pointer"
                aria-label="Cancel voice input"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <p className="text-xs text-teal-900 font-medium italic min-h-[20px] bg-white/70 p-2 rounded-xl border border-teal-100">
            {interimTranscript || finalTranscript || 'Speak naturally (e.g. "I spent 250 rupees on groceries")'}
          </p>
        </div>
      )}

      {/* Processing State */}
      {status === 'processing' && (
        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 text-xs font-medium flex items-center gap-2 my-2 animate-in fade-in">
          <div className="w-3.5 h-3.5 border-2 border-teal-600 border-t-transparent rounded-full animate-spin shrink-0" />
          <span>Interpreting speech...</span>
        </div>
      )}

      {/* Review & Direct Save Card */}
      {status === 'reviewed' && parsedResult && (
        <div
          role="dialog"
          aria-labelledby="voice-review-title"
          className="p-4 rounded-2xl bg-white border-2 border-teal-600 shadow-md my-3 space-y-3 animate-in fade-in"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-teal-50 text-teal-700 flex items-center justify-center shrink-0">
                <Sparkles className="w-4 h-4 text-teal-600" />
              </div>
              <div>
                <h3 id="voice-review-title" className="text-sm font-bold text-[#142D4E]">
                  Verify Spoken Transaction
                </h3>
                <p className="text-[11px] text-[#64748B]">
                  Spoken: &ldquo;{parsedResult.rawTranscript}&rdquo;
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleCancel}
              className="text-slate-400 hover:text-slate-600 p-1 rounded-lg cursor-pointer"
              aria-label="Dismiss voice review"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Direct Save Error Feedback if any */}
          {directSaveError && (
            <div
              role="alert"
              className="flex items-start gap-2 p-2.5 bg-red-50 border border-red-200 rounded-xl text-red-900 text-xs font-medium animate-in fade-in"
            >
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{directSaveError}</span>
            </div>
          )}

          {/* Ambiguity notice if any */}
          {parsedResult.isAmbiguous && parsedResult.ambiguityReason && (
            <div className="flex items-start gap-2 p-2 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-xs">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>{parsedResult.ambiguityReason}</span>
            </div>
          )}

          {/* Spoken currency notice if different from active currency */}
          {parsedResult.currencySpoken && parsedResult.currencySpoken !== currentCurrency && (
            <p className="text-[11px] text-slate-500 italic">
              Note: Spoken in {parsedResult.currencySpoken}. Transaction will be saved in your active currency ({currentCurrency}).
            </p>
          )}

          {/* Standard View: Clean summary breakdown */}
          {!isEditingInline ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200/80 text-xs">
              <div>
                <span className="text-[10px] text-slate-500 block uppercase font-bold">Amount</span>
                <span className="font-extrabold text-sm text-[#142D4E]">
                  {parsedResult.amount !== null
                    ? `${currentCurrency} ${parsedResult.amount.toFixed(2)}`
                    : 'Unclear Amount'}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 block uppercase font-bold">Category</span>
                <span className="font-semibold text-slate-800 truncate block">
                  {parsedResult.category}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 block uppercase font-bold">Date</span>
                <span className="font-semibold text-slate-800">{parsedResult.date}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 block uppercase font-bold">Description</span>
                <span className="font-semibold text-slate-800 truncate block">
                  {parsedResult.notes || '—'}
                </span>
              </div>
            </div>
          ) : (
            /* Inline Edit View: Quick adjustment before saving */
            <div className="space-y-2.5 bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-[#142D4E] uppercase tracking-wider text-[10px]">
                  Edit Details Before Saving
                </span>
                {onApplyParsedExpense && (
                  <button
                    type="button"
                    onClick={handleApplyToForm}
                    className="inline-flex items-center gap-1 text-[11px] text-teal-700 hover:text-teal-900 font-semibold cursor-pointer"
                  >
                    <span>Open in Full Form</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label htmlFor="voice-edit-amount" className="block text-[10px] font-bold text-slate-600 mb-1">
                    Amount ({currentCurrency}) *
                  </label>
                  <input
                    id="voice-edit-amount"
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="0.00"
                    value={editableAmount}
                    onChange={(e) => {
                      setEditableAmount(e.target.value);
                      if (directSaveError) setDirectSaveError(null);
                    }}
                    className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold text-[#142D4E] focus:outline-none focus:border-teal-600 min-h-[36px]"
                  />
                </div>
                {/* Category Custom Selector matching main screen */}
                <div>
                  <label id="voice-edit-category-label" className="block text-[10px] font-bold text-slate-600 mb-1">
                    Category *
                  </label>
                  <div className="relative rounded-lg shadow-2xs">
                    <button
                      type="button"
                      id="voice-edit-category"
                      aria-labelledby="voice-edit-category-label"
                      onClick={() => setIsVoiceCategoryModalOpen(true)}
                      className="w-full flex items-center justify-between rounded-lg border border-slate-200 bg-white py-1.5 px-2.5 text-xs font-semibold text-[#142D4E] hover:border-teal-500 focus:outline-none focus:border-teal-600 focus:ring-1 focus:ring-teal-100 transition-all cursor-pointer min-h-[36px]"
                    >
                      <div className="flex items-center gap-2 truncate">
                        <div
                          className={`w-5 h-5 rounded flex items-center justify-center shrink-0 ${
                            CATEGORIES.find((c) => c.name === editableCategory)?.bgColor || 'bg-teal-50'
                          } ${
                            CATEGORIES.find((c) => c.name === editableCategory)?.textColor || 'text-teal-700'
                          }`}
                        >
                          {getCategoryIcon(editableCategory, 'w-3 h-3')}
                        </div>
                        <span
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{
                            backgroundColor:
                              CATEGORIES.find((c) => c.name === editableCategory)?.color || '#0D9488',
                          }}
                          aria-hidden="true"
                        />
                        <span className="truncate">{editableCategory}</span>
                      </div>
                      <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-1" />
                    </button>
                  </div>

                  {/* Popular Category Quick Chips matching main screen */}
                  <div className="flex flex-wrap items-center gap-1 mt-1.5">
                    <span className="text-[10px] font-semibold text-slate-400 mr-0.5">Popular:</span>
                    {Array.from(new Set(['Groceries', 'Dining Out', 'Utilities', 'Transportation', editableCategory])).map((catName) => {
                      const isSelected = editableCategory === catName;
                      return (
                        <button
                          key={catName}
                          type="button"
                          onClick={() => setEditableCategory(catName as ExpenseCategory)}
                          className={`px-2 py-0.5 text-[11px] font-semibold rounded-md transition-all min-h-[26px] cursor-pointer ${
                            isSelected
                              ? 'bg-teal-600 text-white shadow-2xs'
                              : 'bg-white hover:bg-slate-200 text-slate-700 border border-slate-200/80'
                          }`}
                        >
                          {catName}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <label id="voice-edit-date-label" className="block text-[10px] font-bold text-slate-600 mb-1">
                    Date *
                  </label>
                  <button
                    type="button"
                    id="voice-edit-date"
                    aria-labelledby="voice-edit-date-label"
                    onClick={() => setIsVoiceDateModalOpen(true)}
                    className="w-full flex items-center justify-between rounded-lg border border-slate-200 bg-white py-1.5 px-2.5 text-xs text-[#142D4E] font-semibold hover:border-teal-500 focus:outline-none focus:border-teal-600 focus:ring-1 focus:ring-teal-100 transition-all cursor-pointer min-h-[36px]"
                  >
                    <div className="flex items-center gap-1.5 truncate">
                      <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="truncate">
                        {editableDate ? (editableDate === getTodayDateString() ? `Today · ${formatDate(editableDate)}` : formatDate(editableDate)) : 'Select Date'}
                      </span>
                    </div>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-1" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {/* Payment Method Selector matching main screen */}
                <div>
                  <label id="voice-edit-payment-method-label" className="block text-[10px] font-bold text-slate-600 mb-1">
                    Payment Method <span className="text-slate-400 font-normal">(Optional)</span>
                  </label>
                  <div className="relative rounded-lg shadow-2xs">
                    <button
                      type="button"
                      id="voice-edit-payment-method"
                      aria-labelledby="voice-edit-payment-method-label"
                      onClick={() => setIsVoicePaymentModalOpen(true)}
                      className="w-full flex items-center justify-between rounded-lg border border-slate-200 bg-white py-1.5 px-2.5 text-xs font-semibold text-[#142D4E] hover:border-teal-500 focus:outline-none focus:border-teal-600 focus:ring-1 focus:ring-teal-100 transition-all cursor-pointer min-h-[36px]"
                    >
                      <div className="flex items-center gap-2 truncate">
                        <div className="w-5 h-5 rounded bg-teal-50 text-teal-700 flex items-center justify-center shrink-0">
                          {getPaymentMethodIcon(editablePaymentMethod, 'w-3 h-3')}
                        </div>
                        <span className={editablePaymentMethod ? 'truncate' : 'text-slate-400 truncate'}>
                          {editablePaymentMethod || 'Select (optional)'}
                        </span>
                      </div>
                      <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-1" />
                    </button>
                  </div>

                  {/* Popular Payment Method Quick Chips matching main screen */}
                  <div className="flex flex-wrap items-center gap-1 mt-1.5">
                    <span className="text-[10px] font-semibold text-slate-400 mr-0.5">Quick:</span>
                    {['Credit Card', 'Debit Card', 'Cash', 'Digital Wallet'].map((pm) => {
                      const isSelected = editablePaymentMethod === pm;
                      return (
                        <button
                          key={pm}
                          type="button"
                          onClick={() => setEditablePaymentMethod(isSelected ? '' : pm)}
                          className={`px-2 py-0.5 text-[11px] font-semibold rounded-md transition-all min-h-[26px] cursor-pointer ${
                            isSelected
                              ? 'bg-teal-600 text-white shadow-2xs'
                              : 'bg-white hover:bg-slate-200 text-slate-700 border border-slate-200/80'
                          }`}
                        >
                          {pm}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <label htmlFor="voice-edit-notes" className="block text-[10px] font-bold text-slate-600 mb-1">
                    Description / Notes <span className="text-slate-400 font-normal">(Optional)</span>
                  </label>
                  <input
                    id="voice-edit-notes"
                    type="text"
                    placeholder="e.g. Groceries at supermarket"
                    value={editableNotes}
                    onChange={(e) => setEditableNotes(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-[#142D4E] focus:outline-none focus:border-teal-600 min-h-[36px]"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Action Buttons: Prominent Save Expense + Edit Before Saving */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleTryAgain}
                className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-[#142D4E] p-1 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Re-record</span>
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>

            <div className="flex items-center gap-2">
              {/* Secondary Option: Edit Before Saving */}
              {!isEditingInline ? (
                <button
                  type="button"
                  onClick={() => setIsEditingInline(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 hover:border-slate-300 text-xs font-semibold shadow-2xs transition-all cursor-pointer"
                >
                  <Pencil className="w-3.5 h-3.5 text-slate-500" />
                  <span>Edit Before Saving</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsEditingInline(false)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                >
                  Close Edit
                </button>
              )}

              {/* Primary Prominent Action: Save Expense directly */}
              <button
                type="button"
                disabled={isSaving}
                onClick={handleDirectSave}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold shadow-2xs transition-all active:scale-[0.98] cursor-pointer disabled:opacity-60"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Save Expense</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clear In-App Error State with Reliable Try Again */}
      {status === 'error' && errorDetails && (
        <div
          role="alert"
          className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-950 text-xs space-y-2.5 my-2 animate-in fade-in"
        >
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-bold text-amber-950 text-xs">Voice Entry Note</p>
              <p className="text-[11px] text-amber-900 mt-1 leading-relaxed">
                {errorDetails.message}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                cleanupRecognition();
                setStatus('idle');
                setErrorDetails(null);
              }}
              className="text-amber-700 hover:text-amber-950 p-1 cursor-pointer"
              aria-label="Dismiss error"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-amber-200/60">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleTryAgain}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-200/90 hover:bg-amber-300 text-amber-950 font-bold text-xs cursor-pointer transition-colors shadow-2xs"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Try Again</span>
              </button>
            </div>

            <span className="text-[10px] text-amber-800">
              Manual entry is fully active below.
            </span>
          </div>
        </div>
      )}

      {/* Unsupported Browser State */}
      {status === 'unsupported' && (
        <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 text-slate-700 text-xs space-y-2 my-2 animate-in fade-in">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-1.5 font-bold text-[#142D4E]">
              <MicOff className="w-4 h-4 text-slate-400" />
              <span>Browser Speech Recognition Not Supported</span>
            </div>
            <button
              type="button"
              onClick={() => setStatus('idle')}
              className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
              aria-label="Dismiss notice"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Speech recognition requires browser Web Speech API support (available in Google Chrome, Microsoft Edge, and Safari). Manual transaction entry is fully functional below.
          </p>
        </div>
      )}

      {/* Category Selector Modal for Voice Edit */}
      <CategorySelectorModal
        isOpen={isVoiceCategoryModalOpen}
        onClose={() => setIsVoiceCategoryModalOpen(false)}
        selectedCategory={editableCategory}
        onSelectCategory={(cat) => setEditableCategory(cat)}
      />

      {/* Payment Method Selector Modal for Voice Edit */}
      <PaymentMethodSelectorModal
        isOpen={isVoicePaymentModalOpen}
        onClose={() => setIsVoicePaymentModalOpen(false)}
        selectedPaymentMethod={editablePaymentMethod}
        onSelectPaymentMethod={(pm) => setEditablePaymentMethod(pm)}
      />

      {/* Date Selector Modal for Voice Edit */}
      <DatePickerModal
        isOpen={isVoiceDateModalOpen}
        onClose={() => setIsVoiceDateModalOpen(false)}
        selectedDate={editableDate || getTodayDateString()}
        onSelectDate={(newDate) => setEditableDate(newDate)}
      />
    </div>
  );
};
