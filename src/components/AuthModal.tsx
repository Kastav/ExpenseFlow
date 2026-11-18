import React, { useState, useEffect } from 'react';
import { AuthUser, DeleteAccountOptions, signInWithEmail, registerWithEmail, deleteCurrentUserAccount } from '../services/authService';
import { X, Mail, Lock, ShieldCheck, Loader2, AlertCircle, UserPlus, LogIn, UserCheck, LogOut, Trash2 } from 'lucide-react';
import { useModalBackHandler, scrollInputIntoViewOnFocus } from '../utils/backNavigation';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialMode?: 'signin' | 'register';
  contextMessage?: string | null;
  onAuthenticated?: (user: AuthUser) => void;
  authUser?: AuthUser | null;
  onSignOut?: () => Promise<void> | void;
  onDeleteAccount?: (options?: DeleteAccountOptions) => Promise<{ success: boolean; errorCode?: string; errorMessage?: string }>;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  initialMode = 'signin',
  contextMessage,
  onAuthenticated,
  authUser,
  onSignOut,
  onDeleteAccount,
}) => {
  const [mode, setMode] = useState<'signin' | 'register'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteLocalData, setDeleteLocalData] = useState(false);
  const [requiresReauthPassword, setRequiresReauthPassword] = useState(false);
  const [reauthPassword, setReauthPassword] = useState('');

  useModalBackHandler(isOpen, onClose);

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setErrorMessage(null);
      setPassword('');
      setConfirmPassword('');
      setShowDeleteConfirm(false);
      setDeleteConfirmText('');
      setDeleteLocalData(false);
      setRequiresReauthPassword(false);
      setReauthPassword('');
    }
  }, [isOpen, initialMode]);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const cleanEmail = email.trim();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }

    if (mode === 'register') {
      if (password.length < 6) {
        setErrorMessage('Password must be at least 6 characters long.');
        return;
      }
      if (password !== confirmPassword) {
        setErrorMessage('Passwords do not match.');
        return;
      }
    } else if (!password) {
      setErrorMessage('Please enter your password.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const result =
        mode === 'signin'
          ? await signInWithEmail(cleanEmail, password)
          : await registerWithEmail(cleanEmail, password);

      if (result.success && result.user) {
        setPassword('');
        setConfirmPassword('');
        onAuthenticated?.(result.user);
        onClose();
      } else {
        setErrorMessage(result.errorMessage || 'Authentication failed. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs overflow-hidden animate-in fade-in"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92dvh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-gradient-to-r from-[#142D4E] to-teal-800 text-white p-4 sm:p-6 pr-14 relative shrink-0">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sign in dialog"
            className="absolute top-3 right-3 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>

          <p className="text-[11px] font-bold uppercase tracking-wider text-teal-200 mb-1">
            ExpenseFlow Account
          </p>
          <h2 id="auth-modal-title" className="text-lg sm:text-xl font-extrabold tracking-tight">
            {authUser
              ? 'Signed In Account'
              : mode === 'signin'
              ? 'Sign In to Your Account'
              : 'Create an ExpenseFlow Account'}
          </h2>
          <p className="text-xs text-teal-100/90 mt-1 leading-relaxed">
            {authUser
              ? 'Your ExpenseFlow Firebase account session is active on this device.'
              : 'Optional Firebase Email/Password account. Core expense tracking works offline without signing in.'}
          </p>
        </div>

        {authUser ? (
          <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] sm:pb-6 space-y-4">
            <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-start gap-3">
              <UserCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div className="text-xs space-y-1 min-w-0">
                <p className="font-bold text-emerald-950">Active Firebase Session</p>
                <p className="text-emerald-900 font-medium break-all">{authUser.email || authUser.uid}</p>
                <p className="text-[11px] text-emerald-700 font-mono break-all">UID: {authUser.uid}</p>
              </div>
            </div>

            {errorMessage && (
              <div
                role="alert"
                className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-900 flex items-start gap-2"
              >
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex items-start gap-2 text-[11px] text-slate-600 leading-relaxed">
              <ShieldCheck className="w-4 h-4 text-teal-600 shrink-0 mt-0.5" />
              <span>
                Your local expenses, budgets, and plans remain safely on this device and are never deleted when you sign out.
              </span>
            </div>

            <div className="flex items-center gap-2 pt-1">
              {onSignOut && (
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={async () => {
                    setIsSubmitting(true);
                    try {
                      await onSignOut();
                      onClose();
                    } finally {
                      setIsSubmitting(false);
                    }
                  }}
                  className="flex-1 min-h-[48px] py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-[#142D4E] text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
                  <span>Sign Out</span>
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="flex-1 min-h-[48px] py-2.5 px-4 bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer"
              >
                Done
              </button>
            </div>

            {/* In-App Account Deletion (Google Play Requirement) */}
            <div className="pt-3 border-t border-slate-200 space-y-3">
              {!showDeleteConfirm ? (
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => {
                    setErrorMessage(null);
                    setShowDeleteConfirm(true);
                  }}
                  className="w-full min-h-[44px] py-2 px-3 rounded-xl border border-rose-200 bg-rose-50/70 hover:bg-rose-100/80 text-rose-800 text-xs font-bold transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete ExpenseFlow Account</span>
                </button>
              ) : (
                <div className="p-3.5 rounded-2xl border border-rose-200 bg-rose-50/80 space-y-3">
                  <div className="text-xs text-rose-950 space-y-1">
                    <p className="font-bold">Confirm Permanent Account Deletion</p>
                    <p className="text-[11px] text-rose-900 leading-relaxed">
                      This permanently removes your Firebase Authentication account (email, UID, and login session). Your locally saved expenses remain on this device by default unless you opt in to erase them below.
                    </p>
                  </div>

                  <label className="flex items-start gap-2.5 p-2.5 rounded-xl bg-white border border-rose-200/80 cursor-pointer text-[11px] text-slate-700 leading-snug">
                    <input
                      type="checkbox"
                      checked={deleteLocalData}
                      onChange={(e) => setDeleteLocalData(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500 shrink-0"
                    />
                    <span>
                      <strong className="text-slate-900">Also erase local expenses, budgets, and plans on this device</strong>
                      <span className="block text-[10px] text-slate-500 mt-0.5">
                        Leave unchecked to keep your offline financial records stored locally on this device.
                      </span>
                    </span>
                  </label>

                  <div className="space-y-1">
                    <label htmlFor="delete-account-confirm" className="block text-[11px] font-bold text-rose-900">
                      Type <span className="font-mono">DELETE</span> to confirm
                    </label>
                    <input
                      id="delete-account-confirm"
                      type="text"
                      value={deleteConfirmText}
                      onFocus={scrollInputIntoViewOnFocus}
                      onChange={(e) => setDeleteConfirmText(e.target.value)}
                      placeholder="DELETE"
                      className="w-full min-h-[44px] px-3 py-2 text-sm bg-white border border-rose-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500"
                    />
                  </div>

                  {requiresReauthPassword && (
                    <div className="space-y-1">
                      <label htmlFor="delete-reauth-password" className="block text-[11px] font-bold text-rose-900">
                        Enter your current password to verify security re-authentication
                      </label>
                      <input
                        id="delete-reauth-password"
                        type="password"
                        autoComplete="current-password"
                        value={reauthPassword}
                        onFocus={scrollInputIntoViewOnFocus}
                        onChange={(e) => setReauthPassword(e.target.value)}
                        placeholder="Current account password"
                        className="w-full min-h-[44px] px-3 py-2 text-sm bg-white border border-rose-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500"
                      />
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => {
                        setShowDeleteConfirm(false);
                        setDeleteConfirmText('');
                        setDeleteLocalData(false);
                        setRequiresReauthPassword(false);
                        setReauthPassword('');
                        setErrorMessage(null);
                      }}
                      className="flex-1 min-h-[44px] py-2 px-3 rounded-xl bg-white border border-slate-300 text-slate-700 text-xs font-bold cursor-pointer disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={
                        isSubmitting ||
                        deleteConfirmText.trim().toUpperCase() !== 'DELETE' ||
                        (requiresReauthPassword && !reauthPassword)
                      }
                      onClick={async () => {
                        if (isSubmitting) return;
                        setIsSubmitting(true);
                        setErrorMessage(null);
                        try {
                          const deleteOpts: DeleteAccountOptions = {
                            deleteLocalData,
                            ...(requiresReauthPassword && reauthPassword
                              ? { passwordForReauth: reauthPassword }
                              : {}),
                          };
                          const res = onDeleteAccount
                            ? await onDeleteAccount(deleteOpts)
                            : await deleteCurrentUserAccount(deleteOpts);
                          if (res.success) {
                            onClose();
                          } else if (res.errorCode === 'auth/requires-recent-login') {
                            setRequiresReauthPassword(true);
                            setErrorMessage(
                              res.errorMessage ||
                                'For your security, please enter your current password below to confirm account deletion.'
                            );
                          } else {
                            setErrorMessage(
                              res.errorMessage ||
                                'Failed to delete account. Check your password or internet connection and try again.'
                            );
                          }
                        } finally {
                          setIsSubmitting(false);
                        }
                      }}
                      className="flex-1 min-h-[44px] py-2 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer disabled:opacity-40 flex items-center justify-center gap-1.5"
                    >
                      {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      <span>{requiresReauthPassword ? 'Verify & Delete' : 'Delete Permanently'}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] sm:pb-6 space-y-4">
          {/* Mode Switcher */}
          <div className="grid grid-cols-2 bg-slate-100 p-1 rounded-xl border border-slate-200 gap-1">
            <button
              type="button"
              onClick={() => {
                setMode('signin');
                setErrorMessage(null);
              }}
              className={`min-h-[44px] py-2 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                mode === 'signin'
                  ? 'bg-white text-[#142D4E] shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>Sign In</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setErrorMessage(null);
              }}
              className={`min-h-[44px] py-2 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                mode === 'register'
                  ? 'bg-white text-[#142D4E] shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Create Account</span>
            </button>
          </div>

          {contextMessage && (
            <div className="p-3 rounded-xl bg-teal-50 border border-teal-200 text-xs text-teal-900 leading-relaxed">
              {contextMessage}
            </div>
          )}

          {errorMessage && (
            <div
              role="alert"
              className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-900 flex items-start gap-2"
            >
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="auth-email-input" className="block text-xs font-bold text-[#142D4E]">
              Email Address
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="auth-email-input"
                type="email"
                autoComplete="email"
                required
                value={email}
                onFocus={scrollInputIntoViewOnFocus}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full min-h-[48px] pl-9 pr-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="auth-password-input" className="block text-xs font-bold text-[#142D4E]">
              Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="auth-password-input"
                type="password"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                required
                value={password}
                onFocus={scrollInputIntoViewOnFocus}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'register' ? 'At least 6 characters' : 'Enter your password'}
                className="w-full min-h-[48px] pl-9 pr-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
          </div>

          {mode === 'register' && (
            <div className="space-y-1.5">
              <label htmlFor="auth-confirm-password-input" className="block text-xs font-bold text-[#142D4E]">
                Confirm Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="auth-confirm-password-input"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onFocus={scrollInputIntoViewOnFocus}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your password"
                  className="w-full min-h-[48px] pl-9 pr-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full min-h-[48px] py-3 px-4 bg-teal-600 hover:bg-teal-700 active:bg-teal-800 text-white text-sm font-bold rounded-xl transition-all shadow-xs flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{mode === 'signin' ? 'Signing In...' : 'Creating Account...'}</span>
              </>
            ) : mode === 'signin' ? (
              <>
                <LogIn className="w-4 h-4" />
                <span>Sign In</span>
              </>
            ) : (
              <>
                <UserPlus className="w-4 h-4" />
                <span>Create Account</span>
              </>
            )}
          </button>

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex items-start gap-2 text-[11px] text-slate-600 leading-relaxed">
            <ShieldCheck className="w-4 h-4 text-teal-600 shrink-0 mt-0.5" />
            <span>
              Your local expenses, budgets, and plans remain private on this device and are never deleted or uploaded when you sign in or sign out.
            </span>
          </div>
        </form>
        )}
      </div>
    </div>
  );
};
