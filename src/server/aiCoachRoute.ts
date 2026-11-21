/**
 * Server-Side AI Personal Spending Coach Endpoint Handler.
 * Integrates Gemini 4 Hydrogen (gemini-4-hydrogen) via @google/genai SDK.
 *
 * Enforces:
 * - Server-only GEMINI_API_KEY security (never exposed to client/bundle).
 * - Premium entitlement verification.
 * - In-memory rate limiting (max 5 requests/min, max 100 requests/month).
 * - Input validation & strict data minimization.
 * - 15-second execution timeout.
 * - Truthful configuration reporting.
 */

import { Request, Response } from 'express';
import { GoogleGenAI } from '@google/genai';
import {
  CoachChatRequestPayload,
  CoachChatResponsePayload,
  CoachBackendStatus,
  SafeFinancialSummary,
} from '../types/coach';
import {
  AuthenticatedBillingCaller,
  validateVerifiedEntitlementToken,
  validateEntitlementTokenWithStore,
} from './playBillingVerification.ts';
import {
  EntitlementStore,
  EntitlementStoreConfigurationError,
  getConfiguredEntitlementStore,
  getDefaultEntitlementStore,
} from './entitlementStore.ts';
import { isFirebaseAdminConfigured, verifyFirebaseIdToken } from './firebaseAdmin.ts';

// Cost protection constants
const MAX_MESSAGE_LENGTH = 500;
const MAX_HISTORY_LENGTH = 10;
const MAX_REQUESTS_PER_MINUTE = 5;
const MAX_REQUESTS_PER_MONTH = 100;
const REQUEST_TIMEOUT_MS = 25000;

export interface CoachRouteDeps {
  store?: EntitlementStore;
  now?: () => number;
  verifyCallerToken?: (bearerToken: string) => Promise<AuthenticatedBillingCaller | null>;
  requireFirebaseAuth?: boolean;
  generateReply?: (params: {
    apiKey: string;
    finalPrompt: string;
    systemInstruction: string;
  }) => Promise<string>;
}

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers?.authorization;
  if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.substring(7).trim();
  return token || null;
}

function extractEntitlementToken(req: Request, payload: CoachChatRequestPayload): string | null {
  let token = payload?.entitlementToken;

  const bearer = extractBearerToken(req);
  if (!token && bearer && bearer.startsWith('play_sub_')) {
    token = bearer;
  }

  return token && token.trim().length > 0 ? token.trim() : null;
}

/**
 * Validates whether the incoming request possesses a verified Google Play Premium entitlement.
 * Enforces cryptographic HMAC token validation and unexpired subscription timestamp.
 * Raw client headers or unverified local flags are STRICTLY rejected.
 */
export function verifyCoachEntitlement(req: Request, payload: CoachChatRequestPayload): boolean {
  const token = extractEntitlementToken(req, payload);
  if (!token) {
    return false;
  }

  return validateVerifiedEntitlementToken(token);
}

/**
 * Async entitlement check backed by durable EntitlementStore to reject revoked/expired
 * subscriptions or cross-user entitlement tokens immediately.
 */
export async function verifyCoachEntitlementWithStore(
  req: Request,
  payload: CoachChatRequestPayload,
  store: EntitlementStore = getDefaultEntitlementStore(),
  nowMs: number = Date.now(),
  expectedUserId?: string
): Promise<{ valid: boolean; tokenId?: string; reason?: string }> {
  const token = extractEntitlementToken(req, payload);
  if (!token) {
    return { valid: false, reason: 'missing_token' };
  }

  return validateEntitlementTokenWithStore(token, store, undefined, nowMs, expectedUserId);
}

/**
 * Builds the system instruction prompt with strict financial coaching guidelines.
 */
function buildSystemInstruction(): string {
  return `You are ExpenseFlow's AI Personal Spending Coach. Your role is to provide empathetic, practical, and mathematically sound personal financial guidance based strictly on the aggregated financial summary provided by the user.

Core Guidelines:
1. Be concise, direct, and actionable. Keep responses under 150 words unless the user explicitly requests an in-depth breakdown.
2. Reference specific numbers from the provided summary (e.g., monthly budget, current spend, daily allowance, category distribution) to ground your advice.
3. Suggest practical ways to manage discretionary spending and stay within recommended daily allowances.
4. Maintain a supportive, non-judgmental tone. Never shame the user for past spending.
5. Explicitly state that you provide educational guidance and are not a licensed financial advisor, CPA, or fiduciary.
6. Do not invent or assume expenses that were not provided in the summary or conversation.`;
}

/**
 * Formats the safe financial summary into a clean context block.
 */
function formatFinancialContext(summary?: SafeFinancialSummary): string {
  if (!summary) return 'No financial summary provided.';

  const categoriesText = summary.topCategories && summary.topCategories.length > 0
    ? summary.topCategories.map((c) => `- ${c.category}: ${summary.currency}${c.amount.toFixed(2)} (${c.percentage.toFixed(1)}%)`).join('\n')
    : 'None recorded';

  return `Financial Snapshot for Current Month:
- Currency: ${summary.currency}
- Monthly Budget: ${summary.currency}${summary.monthlyBudget.toFixed(2)}
- Current Month Spend: ${summary.currency}${summary.currentMonthTotalSpent.toFixed(2)} (${summary.budgetUtilizationPct.toFixed(1)}% of budget)
- Remaining Budget: ${summary.currency}${summary.remainingMonthlyBudget.toFixed(2)}
- Days Remaining: ${summary.daysRemainingInMonth} days
- Recommended Daily Allowance: ${summary.currency}${summary.recommendedDailyAllowance.toFixed(2)} / day
- Spending Velocity: ${summary.spendingVelocityStatus.toUpperCase()}
- Top Categories:
${categoriesText}
${summary.priorMonthComparison ? `- Prior Month Spend: ${summary.currency}${summary.priorMonthComparison.priorMonthSpend.toFixed(2)} (Change: ${summary.priorMonthComparison.spendChangePct >= 0 ? '+' : ''}${summary.priorMonthComparison.spendChangePct.toFixed(1)}%)` : ''}`;
}

/**
 * GET /api/coach/status
 * Returns backend availability and cost protection policy limits without exposing keys.
 */
export function handleCoachStatus(_req: Request, res: Response): void {
  const apiKey = process.env.GEMINI_API_KEY;
  const isAvailable = Boolean(apiKey && apiKey.trim().length > 0);

  const statusResponse: CoachBackendStatus = {
    available: isAvailable,
    requiresConfig: !isAvailable,
    model: 'gemini-4-hydrogen',
    costProtection: {
      maxMonthlyRequests: MAX_REQUESTS_PER_MONTH,
      maxRequestsPerMinute: MAX_REQUESTS_PER_MINUTE,
      maxMessageLength: MAX_MESSAGE_LENGTH,
    },
  };

  res.status(200).json(statusResponse);
}

/**
 * Factory for POST /api/coach/chat handler.
 * Enforces Firebase ID token verification, durable ownership & revocation validation,
 * and per-subscription-token AI quota persistence.
 */
export function createCoachChatHandler(deps: CoachRouteDeps = {}) {
  return async function handleCoachChat(req: Request, res: Response): Promise<void> {
    const apiKey = process.env.GEMINI_API_KEY;
    const nowMs = deps.now ? deps.now() : Date.now();

    // 1. Truthful Configuration Check
    if (!deps.generateReply && (!apiKey || apiKey.trim().length === 0)) {
      const errorResponse: CoachChatResponsePayload = {
        success: false,
        error: 'configuration_required',
        message:
          'Gemini API key is not configured on the server. Please add GEMINI_API_KEY to the server environment or AI Studio Secrets.',
      };
      res.status(503).json(errorResponse);
      return;
    }

    // 2. Verify Firebase ID Token (unconditionally mandatory in production; never bypassed if Admin is unavailable)
    const isProduction = (process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
    const enforceFirebaseAuth = Boolean(
      isProduction || deps.requireFirebaseAuth || deps.verifyCallerToken || isFirebaseAdminConfigured()
    );
    let expectedUserId: string | undefined;

    if (enforceFirebaseAuth) {
      const bearer = extractBearerToken(req);
      if (!bearer || bearer.startsWith('play_sub_')) {
        res.status(401).json({
          success: false,
          error: 'unauthorized',
          message: 'Sign in with your ExpenseFlow account to use the AI Personal Spending Coach.',
        } satisfies CoachChatResponsePayload);
        return;
      }

      if (!deps.verifyCallerToken && !isFirebaseAdminConfigured()) {
        res.status(503).json({
          success: false,
          error: 'configuration_required',
          message: 'Firebase authentication verification is unavailable because server credentials are not configured.',
        } satisfies CoachChatResponsePayload);
        return;
      }

      const verifyCaller =
        deps.verifyCallerToken ||
        (async (token: string): Promise<AuthenticatedBillingCaller | null> => {
          const decoded = await verifyFirebaseIdToken(token);
          if (!decoded) return null;
          return { uid: decoded.uid, obfuscatedAccountId: decoded.obfuscatedAccountId };
        });

      const caller = await verifyCaller(bearer);
      if (!caller || !caller.uid) {
        res.status(401).json({
          success: false,
          error: 'unauthorized',
          message: 'Invalid or expired authentication session. Please sign in again.',
        } satisfies CoachChatResponsePayload);
        return;
      }

      expectedUserId = caller.uid;
    }

    // 3. Resolve durable store (fails closed in production if Firestore is missing)
    let store: EntitlementStore;
    try {
      store = deps.store || (await getConfiguredEntitlementStore());
    } catch (err) {
      res.status(503).json({
        success: false,
        error: 'configuration_required',
        message:
          err instanceof EntitlementStoreConfigurationError
            ? err.message
            : 'Entitlement persistence store is not configured.',
      } satisfies CoachChatResponsePayload);
      return;
    }

    // 4. Parse & Validate Payload
    const payload = req.body as CoachChatRequestPayload;
    if (!payload || typeof payload !== 'object') {
      const errorResponse: CoachChatResponsePayload = {
        success: false,
        error: 'invalid_request',
        message: 'Request body must be a valid JSON object.',
      };
      res.status(400).json(errorResponse);
      return;
    }

    // 5. Entitlement Check (Premium Only, bound to caller identity & validated against durable store)
    const entitlement = await verifyCoachEntitlementWithStore(req, payload, store, nowMs, expectedUserId);
    if (!entitlement.valid || !entitlement.tokenId) {
      const message =
        entitlement.reason === 'revoked'
          ? 'Your ExpenseFlow Premium subscription was revoked or refunded.'
          : entitlement.reason === 'ownership_mismatch'
          ? 'This Premium subscription is linked to a different ExpenseFlow account.'
          : 'The AI Personal Spending Coach is an ExpenseFlow Premium feature. A valid subscription or entitlement token is required.';

      const errorResponse: CoachChatResponsePayload = {
        success: false,
        error: 'entitlement_required',
        message,
      };
      res.status(403).json(errorResponse);
      return;
    }

    // 4. Input Text Validation
    const rawMessage = typeof payload.message === 'string' ? payload.message.trim() : '';
    if (!rawMessage) {
      const errorResponse: CoachChatResponsePayload = {
        success: false,
        error: 'invalid_request',
        message: 'Please provide a non-empty question for your Spending Coach.',
      };
      res.status(400).json(errorResponse);
      return;
    }

    if (rawMessage.length > MAX_MESSAGE_LENGTH) {
      const errorResponse: CoachChatResponsePayload = {
        success: false,
        error: 'invalid_request',
        message: `Message is too long (${rawMessage.length} characters). Maximum allowed is ${MAX_MESSAGE_LENGTH} characters.`,
      };
      res.status(400).json(errorResponse);
      return;
    }

    // 5. Durable Rate Limiting & Monthly Quota Check keyed to verified subscription tokenId (not spoofable deviceId)
    const quotaKey = `play_tok_${entitlement.tokenId}`;
    const quotaResult = await store.consumeAiQuota(
      quotaKey,
      MAX_REQUESTS_PER_MINUTE,
      MAX_REQUESTS_PER_MONTH,
      nowMs
    );

    if (!quotaResult.allowed) {
      if (quotaResult.reason === 'rate_limited') {
        res.status(429).json({
          success: false,
          error: 'rate_limited',
          message: `Rate limit reached: Maximum ${MAX_REQUESTS_PER_MINUTE} queries per minute. Please pause for a moment before asking again.`,
        } satisfies CoachChatResponsePayload);
        return;
      }

      res.status(429).json({
        success: false,
        error: 'quota_exceeded',
        message: `Monthly AI query quota reached (${MAX_REQUESTS_PER_MONTH} queries/month). Your quota resets at the start of next month.`,
        usage: {
          monthlyRequestsUsed: quotaResult.monthlyRequestsUsed,
          monthlyQuota: quotaResult.monthlyQuota,
        },
      } satisfies CoachChatResponsePayload);
      return;
    }

    // 6. Build Context & Conversation History
    const contextBlock = formatFinancialContext(payload.financialSummary);
    const promptContents: string[] = [];

    promptContents.push(`[Aggregated Financial Context]\n${contextBlock}\n\n[User Question]\n${rawMessage}`);

    if (Array.isArray(payload.history) && payload.history.length > 0) {
      const sanitizedHistory = payload.history
        .slice(-MAX_HISTORY_LENGTH)
        .filter((h) => h && typeof h.text === 'string' && (h.role === 'user' || h.role === 'model'))
        .map((h) => `${h.role === 'user' ? 'User' : 'Coach'}: ${h.text.substring(0, MAX_MESSAGE_LENGTH)}`)
        .join('\n');

      if (sanitizedHistory.length > 0) {
        promptContents.unshift(`[Recent Conversation History]\n${sanitizedHistory}\n`);
      }
    }

    const finalPrompt = promptContents.join('\n\n');

    // 7. Invoke Gemini API with Timeout Race
    try {
      const systemInstruction = buildSystemInstruction();
      const apiCallPromise = deps.generateReply
        ? deps.generateReply({ apiKey: apiKey || '', finalPrompt, systemInstruction })
        : (async () => {
            const ai = new GoogleGenAI({
              apiKey: apiKey!,
              httpOptions: {
                headers: {
                  'User-Agent': 'aistudio-build',
                },
              },
            });

            const response = await ai.models.generateContent({
              model: 'gemini-4-hydrogen',
              contents: finalPrompt,
              config: {
                systemInstruction,
              },
            });

            return response.text ? response.text.trim() : '';
          })();

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('REQUEST_TIMEOUT')), REQUEST_TIMEOUT_MS);
      });

      const generatedText = (await Promise.race([apiCallPromise, timeoutPromise])).trim();

      if (!generatedText) {
        throw new Error('EMPTY_GEMINI_RESPONSE');
      }

      const successResponse: CoachChatResponsePayload = {
        success: true,
        reply: generatedText,
        usage: {
          monthlyRequestsUsed: quotaResult.monthlyRequestsUsed,
          monthlyQuota: quotaResult.monthlyQuota,
        },
      };

      res.status(200).json(successResponse);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      if (errorMessage === 'REQUEST_TIMEOUT') {
        const errorResponse: CoachChatResponsePayload = {
          success: false,
          error: 'server_error',
          message: 'The AI Spending Coach request timed out. Please try again.',
        };
        res.status(504).json(errorResponse);
        return;
      }

      console.error('[ExpenseFlow Coach Error]', err);

      const errorResponse: CoachChatResponsePayload = {
        success: false,
        error: 'server_error',
        message: 'Failed to generate financial coach advice. Please try again later.',
      };
      res.status(500).json(errorResponse);
    }
  };
}

export const handleCoachChat = createCoachChatHandler();
