import { Capacitor } from '@capacitor/core';

export class ApiConfigurationError extends Error {
  public readonly code = 'API_CONFIGURATION_REQUIRED';

  constructor(message: string) {
    super(message);
    this.name = 'ApiConfigurationError';
  }
}

export interface ResolveApiUrlOptions {
  apiBaseUrl?: string;
  isNative?: boolean;
  origin?: string;
}

function getEnvApiBaseUrl(): string {
  try {
    const metaEnv = (import.meta as unknown as { env?: Record<string, string | undefined> })?.env;
    if (metaEnv && typeof metaEnv.VITE_API_BASE_URL === 'string') {
      return metaEnv.VITE_API_BASE_URL.trim();
    }
  } catch {
    // Ignore in non-Vite runtime
  }

  if (typeof process !== 'undefined' && process.env && typeof process.env.VITE_API_BASE_URL === 'string') {
    return process.env.VITE_API_BASE_URL.trim();
  }

  return '';
}

function detectNativePlatform(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

function detectWindowOrigin(): string {
  if (typeof window !== 'undefined' && window.location && typeof window.location.origin === 'string') {
    return window.location.origin;
  }
  return '';
}

function isLocalhostHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return lower === 'localhost' || lower === '127.0.0.1' || lower === '[::1]';
}

/**
 * Resolves an API endpoint path against VITE_API_BASE_URL.
 *
 * Rules:
 * - On Capacitor native Android (or capacitor:// / file:// / https://localhost WebView origin):
 *   VITE_API_BASE_URL MUST be explicitly configured with a non-localhost HTTPS URL.
 *   Never silently falls back to localhost or relative paths.
 * - On Web:
 *   If VITE_API_BASE_URL is configured, validates and uses it.
 *   If omitted on standard web origin, returns relative path for same-origin Express serving.
 */
export function resolveApiUrl(endpointPath: string, options?: ResolveApiUrlOptions): string {
  const normalizedPath = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`;
  const rawBaseUrl =
    options?.apiBaseUrl !== undefined ? options.apiBaseUrl.trim() : getEnvApiBaseUrl();
  const baseUrl = rawBaseUrl.replace(/\/+$/, '');

  const isNative = options?.isNative !== undefined ? options.isNative : detectNativePlatform();
  const origin = options?.origin !== undefined ? options.origin : detectWindowOrigin();

  const isCapacitorWebViewOrigin =
    origin === 'https://localhost' ||
    origin.startsWith('capacitor://') ||
    origin.startsWith('file://');

  if (isNative || isCapacitorWebViewOrigin) {
    if (!baseUrl) {
      throw new ApiConfigurationError(
        'Production backend URL (VITE_API_BASE_URL) is not configured for the Android app. Configure an HTTPS backend URL before verifying purchases or calling AI services.'
      );
    }

    let parsed: URL;
    try {
      parsed = new URL(baseUrl);
    } catch {
      throw new ApiConfigurationError(
        `Invalid VITE_API_BASE_URL "${baseUrl}". Expected a valid https:// backend URL.`
      );
    }

    if (parsed.protocol !== 'https:' || isLocalhostHost(parsed.hostname)) {
      throw new ApiConfigurationError(
        `Insecure or local VITE_API_BASE_URL "${baseUrl}" is not permitted on Android builds. A public https:// backend URL is required.`
      );
    }

    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}${normalizedPath}`;
  }

  if (baseUrl) {
    let parsed: URL;
    try {
      parsed = new URL(baseUrl);
    } catch {
      throw new ApiConfigurationError(
        `Invalid VITE_API_BASE_URL "${baseUrl}". Expected a valid URL.`
      );
    }

    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocalhostHost(parsed.hostname))) {
      throw new ApiConfigurationError(
        `VITE_API_BASE_URL "${baseUrl}" must use https:// (http:// is only allowed for local development).`
      );
    }

    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}${normalizedPath}`;
  }

  return normalizedPath;
}
