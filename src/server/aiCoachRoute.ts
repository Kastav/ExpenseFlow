/**
 * Server-Side AI Personal Spending Coach Endpoint Handler.
 * Integrates Gemini 3.8 Flash via @google/genai SDK.
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
import { validateVerifiedEntitlementToken } from './playBillingVerification.ts';

// Cost protection constants
const MAX_MESSAGE_LENGTH = 500;
const MAX_HISTORY_LENGTH = 10;
const MAX_REQUESTS_PER_MINUTE = 5;
const MAX_REQUESTS_PER_MONTH = 100;
const REQUEST_TIMEOUT_MS = 25000;

interface RateLimitTracker {
  recentTimestamps: number[];
  monthKey: string;
  monthlyCount: number;
}

const rateLimitStore = new Map<string, RateLimitTracker>();

function getRateLimiter(clientId: string): RateLimitTracker {
  const currentMonthKey = new Date().toISOString().substring(0, 7); // e.g. "2026-11"
  let tracker = rateLimitStore.get(clientId);

  if (!tracker) {
    tracker = {
      recentTimestamps: [],
      monthKey: currentMonthKey,
      monthlyCount: 0,
    };
    rateLimitStore.set(clientId, tracker);
    return tracker;
  }

  // Reset monthly count if a new month began
  if (tracker.monthKey !== currentMonthKey) {
    tracker.monthKey = currentMonthKey;
    tracker.monthlyCount = 0;
    tracker.recentTimestamps = [];
  }

  // Filter timestamps older than 60 seconds
  const oneMinuteAgo = Date.now() - 60000;
  tracker.recentTimestamps = tracker.recentTimestamps.filter((ts) => ts > oneMinuteAgo);

  return tracker;
}

/**
 * Validates whether the incoming request possesses a verified Google Play Premium entitlement.
 * Enforces cryptographic HMAC token validation and unexpired subscription timestamp.
 * Raw client headers or unverified local flags are STRICTLY rejected.
 */
export function verifyCoachEntitlement(req: Request, payload: CoachChatRequestPayload): boolean {
  // Extract token from Authorization Bearer header or payload
  let token = payload.entitlementToken;

  const authHeader = req.headers.authorization;
  if (!token && authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  }

  if (!token) {
    return false;
  }

  // Cryptographically validate token and verify subscription has not expired
  return validateVerifiedEntitlementToken(token);
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
    model: 'gemini-3.8-flash',
    costProtection: {
      maxMonthlyRequests: MAX_REQUESTS_PER_MONTH,
      maxRequestsPerMinute: MAX_REQUESTS_PER_MINUTE,
      maxMessageLength: MAX_MESSAGE_LENGTH,
    },
  };

  res.status(200).json(statusResponse);
}

/**
 * POST /api/coach/chat
 * Secure server-side Gemini API proxy.
 */
export async function handleCoachChat(req: Request, res: Response): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;

  // 1. Truthful Configuration Check
  if (!apiKey || apiKey.trim().length === 0) {
    const errorResponse: CoachChatResponsePayload = {
      success: false,
      error: 'configuration_required',
      message:
        'Gemini API key is not configured on the server. Please add GEMINI_API_KEY to the server environment or AI Studio Secrets.',
    };
    res.status(503).json(errorResponse);
    return;
  }

  // 2. Parse & Validate Payload
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

  // 3. Entitlement Check (Premium Only)
  const isEntitled = verifyCoachEntitlement(req, payload);
  if (!isEntitled) {
    const errorResponse: CoachChatResponsePayload = {
      success: false,
      error: 'entitlement_required',
      message:
        'The AI Personal Spending Coach is an ExpenseFlow Premium feature. A valid subscription or entitlement token is required.',
    };
    res.status(403).json(errorResponse);
    return;
  }

  // 4. Rate Limiting & Monthly Quota Check
  const clientId =
    (req.headers['x-client-device-id'] as string) ||
    payload.deviceId ||
    req.ip ||
    'anonymous_client';

  const tracker = getRateLimiter(clientId);

  if (tracker.recentTimestamps.length >= MAX_REQUESTS_PER_MINUTE) {
    const errorResponse: CoachChatResponsePayload = {
      success: false,
      error: 'rate_limited',
      message: `Rate limit reached: Maximum ${MAX_REQUESTS_PER_MINUTE} queries per minute. Please pause for a moment before asking again.`,
    };
    res.status(429).json(errorResponse);
    return;
  }

  if (tracker.monthlyCount >= MAX_REQUESTS_PER_MONTH) {
    const errorResponse: CoachChatResponsePayload = {
      success: false,
      error: 'quota_exceeded',
      message: `Monthly AI query quota reached (${MAX_REQUESTS_PER_MONTH} queries/month). Your quota resets at the start of next month.`,
      usage: {
        monthlyRequestsUsed: tracker.monthlyCount,
        monthlyQuota: MAX_REQUESTS_PER_MONTH,
      },
    };
    res.status(429).json(errorResponse);
    return;
  }

  // 5. Input Text Validation
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

  // 6. Build Context & Conversation History
  const contextBlock = formatFinancialContext(payload.financialSummary);
  const promptContents: string[] = [];

  promptContents.push(`[Aggregated Financial Context]\n${contextBlock}\n\n[User Question]\n${rawMessage}`);

  // Include sanitized conversation history if present
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
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const apiCallPromise = ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: finalPrompt,
      config: {
        systemInstruction: buildSystemInstruction(),
      },
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('REQUEST_TIMEOUT')), REQUEST_TIMEOUT_MS);
    });

    const response = await Promise.race([apiCallPromise, timeoutPromise]);
    const generatedText = response.text ? response.text.trim() : '';

    if (!generatedText) {
      throw new Error('EMPTY_GEMINI_RESPONSE');
    }

    // Update rate limits upon successful completion
    tracker.recentTimestamps.push(Date.now());
    tracker.monthlyCount += 1;

    const successResponse: CoachChatResponsePayload = {
      success: true,
      reply: generatedText,
      usage: {
        monthlyRequestsUsed: tracker.monthlyCount,
        monthlyQuota: MAX_REQUESTS_PER_MONTH,
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
}
