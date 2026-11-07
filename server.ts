import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { handleCoachStatus, handleCoachChat } from './src/server/aiCoachRoute.ts';
import { handleBillingStatus, handleVerifyPurchase } from './src/server/playBillingVerification.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '3000', 10);

  app.use(express.json());

  // Strict CORS Evaluation for ExpenseFlow
  const configuredOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);

  const isOriginAllowed = (origin: string | undefined): boolean => {
    if (!origin) return true; // Allow same-origin or non-browser server-to-server requests
    const cleanOrigin = origin.replace(/\/$/, '');

    // 1. Explicitly configured origins
    if (configuredOrigins.includes(cleanOrigin)) return true;

    // 2. AI Studio App URL if defined
    if (process.env.APP_URL && cleanOrigin === process.env.APP_URL.replace(/\/$/, '')) {
      return true;
    }

    // 3. Legitimate ExpenseFlow domains
    if (cleanOrigin === 'https://expenseflow-2984.ai.studio') return true;

    // 4. AI Studio preview environments (*.run.app and *.ai.studio)
    if (/^https:\/\/[a-z0-9-]+\.ai\.studio$/i.test(cleanOrigin)) return true;
    if (/^https:\/\/[a-z0-9-]+\.(?:[a-z0-9-]+\.)?run\.app$/i.test(cleanOrigin)) return true;

    // 5. Localhost development
    if (/^http:\/\/localhost:\d+$/i.test(cleanOrigin)) return true;
    if (/^http:\/\/127\.0\.0\.1:\d+$/i.test(cleanOrigin)) return true;

    return false;
  };

  // CORS Middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;

    if (origin && isOriginAllowed(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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

  // Health-check endpoints
  const handleHealthCheck = (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'healthy',
      service: 'expenseflow-core-service',
      version: '1.0.0',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  };

  app.get('/health', handleHealthCheck);
  app.get('/api/health', handleHealthCheck);

  // AI Spending Coach Endpoints (Server-side Gemini proxy)
  app.get('/api/coach/status', handleCoachStatus);
  app.post('/api/coach/chat', handleCoachChat);

  // Google Play In-App Billing Verification Endpoints
  app.get('/api/billing/status', handleBillingStatus);
  app.post('/api/billing/verify', handleVerifyPurchase);

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
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } catch (err) {
      console.warn('[ExpenseFlow Server] Vite middleware note:', err);
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[ExpenseFlow Server] Running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[ExpenseFlow Server] Startup failed:', err);
  process.exit(1);
});
