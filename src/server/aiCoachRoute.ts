/**
 * Server-Side Gemini Proxy for ExpenseFlow AI Features:
 * - AI Personal Spending Coach (POST /api/coach/chat)
 * - AI-Generated Financial Recommendations (POST /api/coach/recommendations)
 * - Advanced AI Insights & Cash-Flow Forecasts (POST /api/coach/insights)
 *
 * Security & Cost Protection Guarantees:
 * - Never trusts client-only tier flags; requires cryptographic Play entitlement or verified server-side user entitlement.
 * - Unconditionally enforces Firebase ID Token verification in production (never skips if Firebase Admin is missing).
 * - Enforces rate limits (5 req/min) & monthly quota (100 req/month) persisted per verified subscription tokenId.
 * - Strict Data Minimization: accepts ONLY aggregated category/month summaries, never raw transactions, IDs, or notes.
 */

import { Request, Response } from 'express';
import { GoogleGenAI } from '@google/genai';
import {
  AdvancedAiInsightsRequestPayload,
  AdvancedAiInsightsResponsePayload,
  AiAnomalyAlert,
  AiRecommendationItem,
  AiRecommendationsRequestPayload,
  AiRecommendationsResponsePayload,
  CoachBackendStatus,
  CoachChatRequestPayload,
  CoachChatResponsePayload,
  CoachUsageSummary,
  SafeAdvancedAnalyticsContext,
  SafeFinancialSummary,
} from '../types/coach';
import {
  AuthenticatedBillingCaller,
  isPurchaseRecordActivePremium,
  validateEntitlementTokenWithStore,
  validateVerifiedEntitlementToken,
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

function extractEntitlementToken(
  req: Request,
  payload: { entitlementToken?: string }
): string | null {
  let token = payload?.entitlementToken;
  const bearer = extractBearerToken(req);
  if (!token && bearer && bearer.startsWith('play_sub_')) {
    token = bearer;
  }
  return token && token.trim().length > 0 ? token.trim() : null;
}

/**
 * Validates whether the incoming request possesses a verified Google Play Premium entitlement.
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
  payload: { entitlementToken?: string },
  store: EntitlementStore = getDefaultEntitlementStore(),
  nowMs: number = Date.now(),
  expectedUserId?: string
): Promise<{ valid: boolean; tokenId?: string; reason?: string }> {
  const token = extractEntitlementToken(req, payload);
  if (token) {
    return validateEntitlementTokenWithStore(token, store, undefined, nowMs, expectedUserId);
  }
  if (expectedUserId && store.getPurchaseRecordByUserId) {
    const record = await store.getPurchaseRecordByUserId(expectedUserId);
    if (record && isPurchaseRecordActivePremium(record, expectedUserId, nowMs)) {
      return { valid: true, tokenId: record.tokenId };
    }
    if (record?.revoked) {
      return { valid: false, reason: 'revoked' };
    }
    if (record && record.expiryTimeMillis <= nowMs) {
      return { valid: false, reason: 'expired' };
    }
  }
  return { valid: false, reason: 'missing_token' };
}

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

function buildRecommendationsSystemInstruction(): string {
  return `You are ExpenseFlow's financial recommendation engine. Analyze the provided aggregated category totals, monthly pacing, and historical comparisons, then return ONLY valid JSON matching:
{
  "summary": "1-2 sentence executive takeaway grounded in the provided numbers.",
  "anomalyAlerts": [
    { "category": "Category Name", "severity": "info" | "warning" | "critical", "detail": "Concise mathematical observation." }
  ],
  "recommendations": [
    {
      "id": "rec_1",
      "title": "Actionable title",
      "category": "Category Name",
      "priority": "high" | "medium" | "low",
      "potentialMonthlySavings": 0,
      "actionStep": "Concrete next step under 30 words.",
      "rationale": "Grounded explanation referencing user's numbers."
    }
  ]
}
Rules:
1. Provide 2-4 practical recommendations and 0-3 anomalyAlerts.
2. Base EVERY figure strictly on the provided aggregates; never invent transactions or merchant names.
3. potentialMonthlySavings must be non-negative and realistic relative to the category spend.
4. Output raw JSON only without markdown fences.`;
}

function buildAdvancedInsightsSystemInstruction(): string {
  return `You are ExpenseFlow's predictive cash-flow & recurring spend analyzer. Analyze the provided current-month pace, multi-month historical category aggregates, and recurring spend cadence summaries, then return ONLY valid JSON matching:
{
  "summary": "1-2 sentence strategic forecast overview grounded in the user's trend.",
  "forecast": {
    "projectedMonthEndSpend": 0,
    "projectedNextMonthSpend": 0,
    "projectedBudgetVariance": 0,
    "cashFlowRiskLevel": "low" | "moderate" | "high",
    "confidenceNote": "Short explanation of forecast basis and educational caveat."
  },
  "recurringLeaks": [
    {
      "category": "Category Name",
      "estimatedMonthlyCost": 0,
      "annualizedCost": 0,
      "observation": "Concise observation on frequency and annual impact."
    }
  ],
  "strategicGuidance": [
    "Concise actionable recommendation 1",
    "Concise actionable recommendation 2"
  ]
}
Rules:
1. Base all projections strictly on the provided numeric aggregates and pacing.
2. projectedBudgetVariance = monthlyBudget - projectedMonthEndSpend (negative means projected overspend).
3. Include 0-4 recurringLeaks and 2-4 strategicGuidance bullets.
4. Output raw JSON only without markdown fences.`;
}

function formatFinancialContext(summary?: SafeFinancialSummary): string {
  if (!summary) return 'No financial summary provided.';

  const categoriesText =
    summary.topCategories && summary.topCategories.length > 0
      ? summary.topCategories
          .map(
            (c) =>
              `- ${c.category}: ${summary.currency}${c.amount.toFixed(2)} (${c.percentage.toFixed(1)}%)`
          )
          .join('\n')
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
${categoriesText}${
    summary.priorMonthComparison
      ? `\n- Prior Month Spend: ${summary.currency}${summary.priorMonthComparison.priorMonthSpend.toFixed(2)} (Change: ${summary.priorMonthComparison.spendChangePct >= 0 ? '+' : ''}${summary.priorMonthComparison.spendChangePct.toFixed(1)}%)`
      : ''
  }`;
}

function formatAdvancedAnalyticsContext(ctx: SafeAdvancedAnalyticsContext): string {
  const baseBlock = formatFinancialContext(ctx.currentMonth);
  const histBlock =
    ctx.historicalMonths.length > 0
      ? ctx.historicalMonths
          .map((m) => {
            const cats = m.topCategories
              .map((c) => `${c.category}: ${ctx.currentMonth.currency}${c.amount.toFixed(2)}`)
              .join(', ');
            return `- ${m.yearMonth}: Total ${ctx.currentMonth.currency}${m.totalSpent.toFixed(2)} across ${m.transactionCount} entries${cats ? ` (${cats})` : ''}`;
          })
          .join('\n')
      : 'No prior months recorded.';

  const recurringBlock =
    ctx.recurringPatterns.length > 0
      ? ctx.recurringPatterns
          .map(
            (r) =>
              `- ${r.category}: ~${ctx.currentMonth.currency}${r.averageAmount.toFixed(2)} avg (${r.cadence}, ${r.occurrences} occurrences, est. ${ctx.currentMonth.currency}${r.estimatedMonthlyCost.toFixed(2)}/mo)`
          )
          .join('\n')
      : 'No recurring cadence patterns detected yet.';

  return `${baseBlock}

Multi-Month Historical Trend (Up to 6 Months):
${histBlock}

Aggregated Recurring Cadence Signals:
${recurringBlock}

Active Savings Challenges: ${ctx.activeChallengeCount}`;
}

function validateSafeFinancialSummary(raw: unknown): raw is SafeFinancialSummary {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const s = raw as Record<string, unknown>;
  if ('transactions' in s || 'notes' in s || 'paymentMethod' in s) return false;
  return (
    typeof s.currency === 'string' &&
    s.currency.length <= 8 &&
    typeof s.monthlyBudget === 'number' &&
    Number.isFinite(s.monthlyBudget) &&
    typeof s.currentMonthTotalSpent === 'number' &&
    Number.isFinite(s.currentMonthTotalSpent) &&
    typeof s.budgetUtilizationPct === 'number' &&
    Number.isFinite(s.budgetUtilizationPct) &&
    typeof s.remainingMonthlyBudget === 'number' &&
    Number.isFinite(s.remainingMonthlyBudget) &&
    typeof s.recommendedDailyAllowance === 'number' &&
    Number.isFinite(s.recommendedMonthlyBudget === undefined ? s.recommendedDailyAllowance : s.recommendedDailyAllowance) &&
    typeof s.daysRemainingInMonth === 'number' &&
    Number.isFinite(s.daysRemainingInMonth) &&
    Array.isArray(s.topCategories) &&
    s.topCategories.length <= 24
  );
}

function validateAdvancedAnalyticsContext(raw: unknown): raw is SafeAdvancedAnalyticsContext {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const ctx = raw as Record<string, unknown>;
  if ('transactions' in ctx || 'notes' in ctx) return false;
  if (!validateSafeFinancialSummary(ctx.currentMonth)) return false;
  if (!Array.isArray(ctx.historicalMonths) || ctx.historicalMonths.length > 12) return false;
  for (const m of ctx.historicalMonths) {
    if (!m || typeof m !== 'object' || Array.isArray(m)) return false;
    const item = m as Record<string, unknown>;
    if (
      typeof item.yearMonth !== 'string' ||
      !/^\d{4}-\d{2}$/.test(item.yearMonth) ||
      typeof item.totalSpent !== 'number' ||
      !Number.isFinite(item.totalSpent) ||
      typeof item.transactionCount !== 'number' ||
      !Number.isFinite(item.transactionCount) ||
      !Array.isArray(item.topCategories) ||
      item.topCategories.length > 12
    ) {
      return false;
    }
  }
  if (!Array.isArray(ctx.recurringPatterns) || ctx.recurringPatterns.length > 16) return false;
  for (const r of ctx.recurringPatterns) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return false;
    const pat = r as Record<string, unknown>;
    if (
      typeof pat.category !== 'string' ||
      pat.category.length > 80 ||
      typeof pat.occurrences !== 'number' ||
      typeof pat.averageAmount !== 'number' ||
      typeof pat.estimatedMonthlyCost !== 'number' ||
      typeof pat.cadence !== 'string'
    ) {
      return false;
    }
  }
  return typeof ctx.activeChallengeCount === 'number' && Number.isFinite(ctx.activeChallengeCount);
}

function extractJsonObjectFromModelOutput(rawText: string): Record<string, unknown> | null {
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        const sliced = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
        if (sliced && typeof sliced === 'object' && !Array.isArray(sliced)) {
          return sliced as Record<string, unknown>;
        }
      } catch {
        return null;
      }
    }
  }
  return null;
}

async function callGeminiWithTimeout(
  apiKey: string | undefined,
  finalPrompt: string,
  systemInstruction: string,
  deps: CoachRouteDeps,
  responseMimeType?: string
): Promise<string> {
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
            ...(responseMimeType ? { responseMimeType } : {}),
          },
        });
        return response.text ? response.text.trim() : '';
      })();

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('REQUEST_TIMEOUT')), REQUEST_TIMEOUT_MS);
  });

  return (await Promise.race([apiCallPromise, timeoutPromise])).trim();
}

async function authorizeAndConsumeAiQuota(
  req: Request,
  res: Response,
  deps: CoachRouteDeps,
  nowMs: number,
  featureLabel: string
): Promise<{
  ok: true;
  apiKey: string | undefined;
  usage: CoachUsageSummary;
} | {
  ok: false;
}> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!deps.generateReply && (!apiKey || apiKey.trim().length === 0)) {
    res.status(503).json({
      success: false,
      error: 'configuration_required',
      message:
        'Gemini API key is not configured on the server. Please add GEMINI_API_KEY to the server environment.',
    });
    return { ok: false };
  }

  const isProduction = (process.env.NODE_ENV ?? '').trim().toLowerCase() === 'production';
  if (isProduction && !deps.verifyCallerToken && !isFirebaseAdminConfigured()) {
    res.status(503).json({
      success: false,
      error: 'configuration_required',
      message:
        'Firebase Admin authentication must be configured in production before accessing AI Premium features.',
    });
    return { ok: false };
  }

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
        message: `Sign in with your ExpenseFlow account to use ${featureLabel}.`,
      });
      return { ok: false };
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
      });
      return { ok: false };
    }
    expectedUserId = caller.uid;
  }

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
    });
    return { ok: false };
  }

  const payload = req.body as { entitlementToken?: string } | undefined;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    res.status(400).json({
      success: false,
      error: 'invalid_request',
      message: 'Request body must be a valid JSON object.',
    });
    return { ok: false };
  }

  const entitlement = await verifyCoachEntitlementWithStore(
    req,
    payload,
    store,
    nowMs,
    expectedUserId
  );
  if (!entitlement.valid || !entitlement.tokenId) {
    const message =
      entitlement.reason === 'revoked'
        ? 'Your ExpenseFlow Premium subscription was revoked or refunded.'
        : entitlement.reason === 'ownership_mismatch'
        ? 'This Premium subscription is linked to a different ExpenseFlow account.'
        : `${featureLabel} is an ExpenseFlow Premium feature. An active verified subscription is required.`;
    res.status(403).json({
      success: false,
      error: 'entitlement_required',
      message,
    });
    return { ok: false };
  }

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
      });
      return { ok: false };
    }
    res.status(429).json({
      success: false,
      error: 'quota_exceeded',
      message: `Monthly AI query quota reached (${MAX_REQUESTS_PER_MONTH} queries/month). Your quota resets at the start of next month.`,
      usage: {
        monthlyRequestsUsed: quotaResult.monthlyRequestsUsed,
        monthlyQuota: quotaResult.monthlyQuota,
      },
    });
    return { ok: false };
  }

  return {
    ok: true,
    apiKey,
    usage: {
      monthlyRequestsUsed: quotaResult.monthlyRequestsUsed,
      monthlyQuota: quotaResult.monthlyQuota,
    },
  };
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
    features: {
      chat: isAvailable,
      recommendations: isAvailable,
      advancedInsights: isAvailable,
    },
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
 */
export function createCoachChatHandler(deps: CoachRouteDeps = {}) {
  return async function handleCoachChat(req: Request, res: Response): Promise<void> {
    const nowMs = deps.now ? deps.now() : Date.now();
    const payload = req.body as CoachChatRequestPayload;

    // Validate message before consuming quota if body shape is clearly invalid? Wait:
    // keep auth/entitlement BEFORE payload content details except object shape!
    const authz = await authorizeAndConsumeAiQuota(
      req,
      res,
      deps,
      nowMs,
      'the AI Personal Spending Coach'
    );
    if (!authz.ok) return;

    const rawMessage = typeof payload.message === 'string' ? payload.message.trim() : '';
    if (!rawMessage) {
      res.status(400).json({
        success: false,
        error: 'invalid_request',
        message: 'Please provide a non-empty question for your Spending Coach.',
      } satisfies CoachChatResponsePayload);
      return;
    }

    if (rawMessage.length > MAX_MESSAGE_LENGTH) {
      res.status(400).json({
        success: false,
        error: 'invalid_request',
        message: `Message is too long (${rawMessage.length} characters). Maximum allowed is ${MAX_MESSAGE_LENGTH} characters.`,
      } satisfies CoachChatResponsePayload);
      return;
    }

    const contextBlock = formatFinancialContext(payload.financialSummary);
    const promptContents: string[] = [
      `[Aggregated Financial Context]\n${contextBlock}\n\n[User Question]\n${rawMessage}`,
    ];
    if (Array.isArray(payload.history) && payload.history.length > 0) {
      const sanitizedHistory = payload.history
        .slice(-MAX_HISTORY_LENGTH)
        .filter((h) => h && typeof h.text === 'string' && (h.role === 'user' || h.role === 'model'))
        .map(
          (h) =>
            `${h.role === 'user' ? 'User' : 'Coach'}: ${h.text.substring(0, MAX_MESSAGE_LENGTH)}`
        )
        .join('\n');
      if (sanitizedHistory.length > 0) {
        promptContents.unshift(`[Recent Conversation History]\n${sanitizedHistory}\n`);
      }
    }

    try {
      const generatedText = await callGeminiWithTimeout(
        authz.apiKey,
        promptContents.join('\n\n'),
        buildSystemInstruction(),
        deps
      );
      if (!generatedText) {
        throw new Error('EMPTY_GEMINI_RESPONSE');
      }
      res.status(200).json({
        success: true,
        reply: generatedText,
        usage: authz.usage,
      } satisfies CoachChatResponsePayload);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (errorMessage === 'REQUEST_TIMEOUT') {
        res.status(504).json({
          success: false,
          error: 'server_error',
          message: 'The AI Spending Coach request timed out. Please try again.',
        } satisfies CoachChatResponsePayload);
        return;
      }
      console.error('[ExpenseFlow Coach Error]', err);
      res.status(500).json({
        success: false,
        error: 'server_error',
        message: 'Failed to generate financial coach advice. Please try again later.',
      } satisfies CoachChatResponsePayload);
    }
  };
}

export const handleCoachChat = createCoachChatHandler();

/**
 * Factory for POST /api/coach/recommendations handler (`ai_recommendations`).
 */
export function createAiRecommendationsHandler(deps: CoachRouteDeps = {}) {
  return async function handleAiRecommendations(req: Request, res: Response): Promise<void> {
    const nowMs = deps.now ? deps.now() : Date.now();
    const authz = await authorizeAndConsumeAiQuota(
      req,
      res,
      deps,
      nowMs,
      'AI-Generated Financial Recommendations'
    );
    if (!authz.ok) return;

    const payload = req.body as AiRecommendationsRequestPayload;
    if (!validateAdvancedAnalyticsContext(payload.analyticsContext)) {
      res.status(400).json({
        success: false,
        error: 'invalid_request',
        message: 'Invalid or non-minimized financial analytics context provided.',
      } satisfies AiRecommendationsResponsePayload);
      return;
    }

    const prompt = `[Aggregated Spending & Historical Context]\n${formatAdvancedAnalyticsContext(
      payload.analyticsContext
    )}\n\nGenerate personalized anomaly alerts and budget optimization recommendations.`;

    try {
      const rawText = await callGeminiWithTimeout(
        authz.apiKey,
        prompt,
        buildRecommendationsSystemInstruction(),
        deps,
        'application/json'
      );
      const parsed = extractJsonObjectFromModelOutput(rawText);
      if (!parsed) {
        throw new Error('INVALID_RECOMMENDATIONS_JSON');
      }

      const anomalyAlerts: AiAnomalyAlert[] = Array.isArray(parsed.anomalyAlerts)
        ? parsed.anomalyAlerts
            .filter((a): a is Record<string, unknown> => Boolean(a && typeof a === 'object'))
            .slice(0, 4)
            .map((a): AiAnomalyAlert => ({
              category: typeof a.category === 'string' ? a.category.slice(0, 60) : 'Spending',
              severity:
                a.severity === 'critical' || a.severity === 'warning' || a.severity === 'info'
                  ? a.severity
                  : 'info',
              detail: typeof a.detail === 'string' ? a.detail.slice(0, 260) : '',
            }))
            .filter((a) => a.detail.length > 0)
        : [];

      const recommendations: AiRecommendationItem[] = Array.isArray(parsed.recommendations)
        ? parsed.recommendations
            .filter((r): r is Record<string, unknown> => Boolean(r && typeof r === 'object'))
            .slice(0, 5)
            .map((r, idx): AiRecommendationItem => ({
              id: typeof r.id === 'string' ? r.id.slice(0, 40) : `rec_${idx + 1}`,
              title: typeof r.title === 'string' ? r.title.slice(0, 100) : 'Budget Optimization',
              category: typeof r.category === 'string' ? r.category.slice(0, 60) : 'General',
              priority:
                r.priority === 'high' || r.priority === 'medium' || r.priority === 'low'
                  ? r.priority
                  : 'medium',
              potentialMonthlySavings:
                typeof r.potentialMonthlySavings === 'number' &&
                Number.isFinite(r.potentialMonthlySavings) &&
                r.potentialMonthlySavings >= 0
                  ? Math.round(r.potentialMonthlySavings * 100) / 100
                  : 0,
              actionStep: typeof r.actionStep === 'string' ? r.actionStep.slice(0, 240) : '',
              rationale: typeof r.rationale === 'string' ? r.rationale.slice(0, 320) : '',
            }))
            .filter((r) => r.actionStep.length > 0)
        : [];

      res.status(200).json({
        success: true,
        summary:
          typeof parsed.summary === 'string'
            ? parsed.summary.slice(0, 400)
            : 'Personalized budget optimization opportunities prepared from your monthly pace.',
        anomalyAlerts,
        recommendations,
        generatedAt: new Date(nowMs).toISOString(),
        usage: authz.usage,
      } satisfies AiRecommendationsResponsePayload);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (errorMessage === 'REQUEST_TIMEOUT') {
        res.status(504).json({
          success: false,
          error: 'server_error',
          message: 'AI Recommendations timed out. Please try again.',
        } satisfies AiRecommendationsResponsePayload);
        return;
      }
      console.error('[ExpenseFlow AI Recommendations Error]', err);
      res.status(500).json({
        success: false,
        error: 'server_error',
        message: 'Failed to generate AI recommendations. Please try again later.',
      } satisfies AiRecommendationsResponsePayload);
    }
  };
}

/**
 * Factory for POST /api/coach/insights handler (`advanced_ai_insights`).
 */
export function createAdvancedAiInsightsHandler(deps: CoachRouteDeps = {}) {
  return async function handleAdvancedAiInsights(req: Request, res: Response): Promise<void> {
    const nowMs = deps.now ? deps.now() : Date.now();
    const authz = await authorizeAndConsumeAiQuota(
      req,
      res,
      deps,
      nowMs,
      'Advanced AI Insights & Cash-Flow Forecasts'
    );
    if (!authz.ok) return;

    const payload = req.body as AdvancedAiInsightsRequestPayload;
    if (!validateAdvancedAnalyticsContext(payload.analyticsContext)) {
      res.status(400).json({
        success: false,
        error: 'invalid_request',
        message: 'Invalid or non-minimized financial analytics context provided.',
      } satisfies AdvancedAiInsightsResponsePayload);
      return;
    }

    const prompt = `[Aggregated Multi-Month & Recurring Pattern Context]\n${formatAdvancedAnalyticsContext(
      payload.analyticsContext
    )}\n\nGenerate predictive month-end and next-month cash-flow forecasts, recurring leak findings, and strategic guidance.`;

    try {
      const rawText = await callGeminiWithTimeout(
        authz.apiKey,
        prompt,
        buildAdvancedInsightsSystemInstruction(),
        deps,
        'application/json'
      );
      const parsed = extractJsonObjectFromModelOutput(rawText);
      if (!parsed || !parsed.forecast || typeof parsed.forecast !== 'object') {
        throw new Error('INVALID_INSIGHTS_JSON');
      }

      const rawForecast = parsed.forecast as Record<string, unknown>;
      const num = (val: unknown, fallback: number) =>
        typeof val === 'number' && Number.isFinite(val) ? Math.round(val * 100) / 100 : fallback;

      const recurringLeaks = Array.isArray(parsed.recurringLeaks)
        ? parsed.recurringLeaks
            .filter((l): l is Record<string, unknown> => Boolean(l && typeof l === 'object'))
            .slice(0, 5)
            .map((l) => {
              const monthly = Math.max(0, num(l.estimatedMonthlyCost, 0));
              return {
                category: typeof l.category === 'string' ? l.category.slice(0, 60) : 'Recurring',
                estimatedMonthlyCost: monthly,
                annualizedCost: Math.max(0, num(l.annualizedCost, Math.round(monthly * 12 * 100) / 100)),
                observation: typeof l.observation === 'string' ? l.observation.slice(0, 260) : '',
              };
            })
            .filter((l) => l.observation.length > 0)
        : [];

      const strategicGuidance = Array.isArray(parsed.strategicGuidance)
        ? parsed.strategicGuidance
            .filter((g): g is string => typeof g === 'string' && g.trim().length > 0)
            .slice(0, 5)
            .map((g) => g.trim().slice(0, 260))
        : [];

      const currentSpend = payload.analyticsContext.currentMonth.currentMonthTotalSpent;
      const monthlyBudget = payload.analyticsContext.currentMonth.monthlyBudget;
      const projectedMonthEndSpend = Math.max(0, num(rawForecast.projectedMonthEndSpend, currentSpend));
      const projectedNextMonthSpend = Math.max(
        0,
        num(rawForecast.projectedNextMonthSpend, projectedMonthEndSpend)
      );
      const projectedBudgetVariance = num(
        rawForecast.projectedBudgetVariance,
        monthlyBudget - projectedMonthEndSpend
      );

      res.status(200).json({
        success: true,
        summary:
          typeof parsed.summary === 'string'
            ? parsed.summary.slice(0, 400)
            : 'Predictive cash-flow projection generated from your recent monthly spend velocity.',
        forecast: {
          projectedMonthEndSpend,
          projectedNextMonthSpend,
          projectedBudgetVariance,
          cashFlowRiskLevel:
            rawForecast.cashFlowRiskLevel === 'high' ||
            rawForecast.cashFlowRiskLevel === 'moderate' ||
            rawForecast.cashFlowRiskLevel === 'low'
              ? rawForecast.cashFlowRiskLevel
              : 'moderate',
          confidenceNote:
            typeof rawForecast.confidenceNote === 'string'
              ? rawForecast.confidenceNote.slice(0, 260)
              : 'Educational projection based on your aggregated category history.',
        },
        recurringLeaks,
        strategicGuidance,
        generatedAt: new Date(nowMs).toISOString(),
        usage: authz.usage,
      } satisfies AdvancedAiInsightsResponsePayload);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (errorMessage === 'REQUEST_TIMEOUT') {
        res.status(504).json({
          success: false,
          error: 'server_error',
          message: 'Advanced AI Insights timed out. Please try again.',
        } satisfies AdvancedAiInsightsResponsePayload);
        return;
      }
      console.error('[ExpenseFlow Advanced AI Insights Error]', err);
      res.status(500).json({
        success: false,
        error: 'server_error',
        message: 'Failed to generate Advanced AI Insights. Please try again later.',
      } satisfies AdvancedAiInsightsResponsePayload);
    }
  };
}
