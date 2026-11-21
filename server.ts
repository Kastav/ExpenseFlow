import express, { Express, Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import {
  handleCoachStatus,
  createCoachChatHandler,
  createAiRecommendationsHandler,
  createAdvancedAiInsightsHandler,
  CoachRouteDeps,
} from './src/server/aiCoachRoute.ts';
import {
  handleBillingStatus,
  createVerifyPurchaseHandler,
  createRtdnHandler,
  createMyEntitlementHandler,
  isPlayBillingConfigured,
  isRtdnConfigured,
  BillingVerificationDeps,
} from './src/server/playBillingVerification.ts';
import { getEntitlementStoreStatus } from './src/server/entitlementStore.ts';
import { getAdminFirestore, isFirebaseAdminConfigured } from './src/server/firebaseAdmin.ts';
import {
  CloudSyncRouteDeps,
  createCloudSyncStatusHandler,
  createCloudSyncGetHandler,
  createCloudSyncPutHandler,
  createCloudSyncRestorePreviousHandler,
} from './src/server/cloudSyncRoute.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getPort(): number {
  const portArgIndex = process.argv.indexOf('--port');
  if (portArgIndex !== -1 && process.argv[portArgIndex + 1]) {
    const parsed = parseInt(process.argv[portArgIndex + 1], 10);
    if (!isNaN(parsed)) return parsed;
  }
  if (process.env.NODE_ENV === 'production') {
    return parseInt(process.env.PORT || '3000', 10);
  }
  return 3000;
}

function getHost(): string {
  const hostArgIndex = process.argv.indexOf('--host');
  if (hostArgIndex !== -1 && process.argv[hostArgIndex + 1]) {
    return process.argv[hostArgIndex + 1];
  }
  return '0.0.0.0';
}

export function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // Allow same-origin or non-browser server-to-server requests
  const cleanOrigin = origin.replace(/\/$/, '');

  const configuredOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);

  // 1. Explicitly configured origins
  if (configuredOrigins.includes(cleanOrigin)) return true;

  // 2. AI Studio App URL if defined
  if (process.env.APP_URL && cleanOrigin === process.env.APP_URL.replace(/\/$/, '')) {
    return true;
  }

  // 3. Capacitor Android WebView origin (androidScheme: 'https')
  if (cleanOrigin === 'https://localhost') return true;

  // 4. Legitimate ExpenseFlow domains
  if (cleanOrigin === 'https://expenseflow-2984.ai.studio') return true;

  // 5. Dev/Preview-only conveniences (never wildcard-trusted in strict production mode)
  if (process.env.NODE_ENV !== 'production') {
    if (/^https:\/\/[a-z0-9-]+\.ai\.studio$/i.test(cleanOrigin)) return true;
    if (/^https:\/\/[a-z0-9-]+\.(?:[a-z0-9-]+\.)?run\.app$/i.test(cleanOrigin)) return true;
    if (/^http:\/\/localhost:\d+$/i.test(cleanOrigin)) return true;
    if (/^http:\/\/127\.0\.0\.1:\d+$/i.test(cleanOrigin)) return true;
  }

  return false;
}

export interface CreateAppOptions {
  billingDeps?: BillingVerificationDeps;
  coachDeps?: CoachRouteDeps;
  cloudSyncDeps?: CloudSyncRouteDeps;
  checkFirestoreConnectivity?: () => Promise<boolean>;
  disableVite?: boolean;
}

export async function createApp(options: CreateAppOptions = {}): Promise<Express> {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(express.json({ limit: '256kb' }));

  // Baseline Security & CORS Headers Middleware (strict allowlist, no wildcard *)
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), geolocation=()');

    const origin = req.headers.origin;

    if (origin && isOriginAllowed(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Requested-With, X-ExpenseFlow-Entitlement-Tier, X-Client-Device-ID'
    );

    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }

    next();
  });

  // Health-check endpoints with non-secret deployment readiness status
  const handleHealthCheck = (_req: Request, res: Response) => {
    const storeStatus = getEntitlementStoreStatus();
    res.status(200).json({
      status: 'healthy',
      service: 'expenseflow-core-service',
      version: '1.0.0',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      readiness: {
        persistenceBackend: storeStatus.backend,
        persistenceReady: storeStatus.ready,
        firebaseAdminConfigured: isFirebaseAdminConfigured(),
        playBillingConfigured: isPlayBillingConfigured(),
        rtdnConfigured: isRtdnConfigured(),
        coachAvailable: Boolean(process.env.GEMINI_API_KEY?.trim()),
      },
    });
  };

  app.get('/health', handleHealthCheck);
  app.get('/api/health', handleHealthCheck);

  app.get('/api/ready', async (_req: Request, res: Response) => {
    const storeStatus = getEntitlementStoreStatus();
    const isProd = (process.env.NODE_ENV ?? '').trim().toLowerCase() === 'production';
    const rawBackend = (process.env.ENTITLEMENT_STORE_BACKEND ?? '').trim().toLowerCase();
    const needsFirestore = isProd || rawBackend === 'firestore';

    if (!storeStatus.ready || (isProd && !isFirebaseAdminConfigured())) {
      res.status(503).json({
        ready: false,
        persistenceBackend: storeStatus.backend,
        firestoreConnected: false,
        firebaseAdminConfigured: isFirebaseAdminConfigured(),
      });
      return;
    }

    let firestoreConnected = !needsFirestore;
    if (needsFirestore) {
      try {
        if (options.checkFirestoreConnectivity) {
          firestoreConnected = await options.checkFirestoreConnectivity();
        } else {
          const db = await getAdminFirestore();
          if (db) {
            await db.collection('billing_entitlements').limit(1).get();
            firestoreConnected = true;
          } else {
            firestoreConnected = false;
          }
        }
      } catch {
        firestoreConnected = false;
      }
    }

    if (!firestoreConnected) {
      res.status(503).json({
        ready: false,
        persistenceBackend: storeStatus.backend,
        firestoreConnected: false,
        firebaseAdminConfigured: isFirebaseAdminConfigured(),
      });
      return;
    }

    res.status(200).json({
      ready: true,
      persistenceBackend: storeStatus.backend,
      firestoreConnected: true,
      firebaseAdminConfigured: isFirebaseAdminConfigured(),
      playBillingConfigured: isPlayBillingConfigured(),
      coachAvailable: Boolean(process.env.GEMINI_API_KEY?.trim()),
    });
  });

  // Permanent public Privacy Policy and Account Deletion endpoints
  const publicPrivacyPath = path.join(__dirname, 'public', 'privacy.html');
  app.get('/privacy.html', (_req: Request, res: Response) => {
    if (fs.existsSync(publicPrivacyPath)) {
      res.sendFile(publicPrivacyPath);
      return;
    }
    res.status(404).type('text/plain').send('Privacy policy not found.');
  });

  const publicDeleteAccountPath = path.join(__dirname, 'public', 'delete-account.html');
  app.get('/delete-account.html', (_req: Request, res: Response) => {
    if (fs.existsSync(publicDeleteAccountPath)) {
      res.sendFile(publicDeleteAccountPath);
      return;
    }
    res.status(404).type('text/plain').send('Account deletion page not found.');
  });

  // AI Spending Coach, Recommendations & Advanced AI Insights Endpoints (Server-side Gemini proxy)
  app.get('/api/coach/status', handleCoachStatus);
  app.post('/api/coach/chat', createCoachChatHandler(options.coachDeps));
  app.post('/api/coach/recommendations', createAiRecommendationsHandler(options.coachDeps));
  app.post('/api/coach/insights', createAdvancedAiInsightsHandler(options.coachDeps));

  // Google Play In-App Billing Verification, Entitlement Lookup & RTDN Endpoints
  app.get('/api/billing/status', handleBillingStatus);
  app.post('/api/billing/verify', createVerifyPurchaseHandler(options.billingDeps));
  app.post('/api/billing/rtdn', createRtdnHandler(options.billingDeps));
  app.get('/api/entitlements/me', createMyEntitlementHandler(options.billingDeps));

  // Premium-Only Cloud Sync & Backup Endpoints (UID & entitlement verified server-side)
  const cloudSyncDeps: CloudSyncRouteDeps = options.cloudSyncDeps || {
    store: options.billingDeps?.store,
    verifyCallerToken: options.billingDeps?.verifyCallerToken,
  };
  app.get('/api/cloud-sync/status', createCloudSyncStatusHandler(cloudSyncDeps));
  app.get('/api/cloud-sync/snapshot', createCloudSyncGetHandler(cloudSyncDeps));
  app.put('/api/cloud-sync/snapshot', createCloudSyncPutHandler(cloudSyncDeps));
  app.post('/api/cloud-sync/restore-previous', createCloudSyncRestorePreviousHandler(cloudSyncDeps));

  if (options.disableVite) {
    return app;
  }

  // Static serving or Vite middleware
  const distPath = path.join(__dirname, 'dist');
  const hasDist = fs.existsSync(distPath) && fs.existsSync(path.join(distPath, 'index.html'));

  if (process.env.NODE_ENV === 'production') {
    if (hasDist) {
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    } else {
      app.get('/', (_req, res) => {
        res.status(200).json({
          service: 'ExpenseFlow Core Service',
          status: 'online',
          healthCheck: '/health',
        });
      });
    }
  } else {
    // Development mode with Vite middlewares mounted
    try {
      const { createServer } = await import('vite');
      const vite = await createServer({
        server: {
          middlewareMode: true,
          hmr: false,
        },
        appType: 'spa',
      });
      app.use(vite.middlewares);

      // Handle HTML transformation for SPA routes in dev
      app.use('*', async (req, res, next) => {
        const url = req.originalUrl;
        if (url.startsWith('/api') || url.startsWith('/health')) {
          return next();
        }
        try {
          const indexPath = path.resolve(__dirname, 'index.html');
          if (fs.existsSync(indexPath)) {
            let template = fs.readFileSync(indexPath, 'utf-8');
            template = await vite.transformIndexHtml(url, template);
            res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
          } else {
            next();
          }
        } catch (e) {
          vite.ssrFixStacktrace(e as Error);
          next(e);
        }
      });
    } catch (err) {
      console.warn('[ExpenseFlow Server] Vite middleware note:', err);
    }
  }

  return app;
}

export async function startServer() {
  const PORT = getPort();
  const HOST = getHost();
  const app = await createApp();

  const storeStatus = getEntitlementStoreStatus();
  const server = app.listen(PORT, HOST, () => {
    console.log(
      `[ExpenseFlow Server] Running on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT} ` +
        `(env=${process.env.NODE_ENV || 'development'}, persistence=${storeStatus.backend}:${storeStatus.ready ? 'ready' : 'unconfigured'}, ` +
        `playBilling=${isPlayBillingConfigured()}, rtdn=${isRtdnConfigured()}, coach=${Boolean(process.env.GEMINI_API_KEY?.trim())})`
    );
  });

  const shutdown = (signal: string) => {
    console.log(`[ExpenseFlow Server] Received ${signal}, shutting down gracefully...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));

  return server;
}

const isMainModule = (() => {
  try {
    if (!process.argv[1]) return false;
    return fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(__filename);
  } catch {
    return false;
  }
})();

if (isMainModule) {
  startServer().catch((err) => {
    console.error('[ExpenseFlow Server] Startup failed:', err);
    process.exit(1);
  });
}
