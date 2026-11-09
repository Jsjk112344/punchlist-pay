// PayPal REST client: OAuth token cache + refresh, sandbox/live base URL, idempotent writes.
// Owner: lib/paypal (PayPal layer). No database access here; callers persist results.
// Raw fetch against https://api-m.sandbox.paypal.com (or live). Never logs tokens or full response bodies.
import { env } from "@/lib/config";

export class PayPalError extends Error {
  constructor(message: string, public status: number, public body: unknown, public debugId?: string) { super(message); this.name = "PayPalError"; }
  /** First `details[].issue` code PayPal returned, e.g. ORDER_ALREADY_AUTHORIZED, or undefined. */
  get issue(): string | undefined {
    const details = (this.body as { details?: { issue?: string }[] } | null)?.details;
    return Array.isArray(details) ? details.find(d => typeof d?.issue === "string")?.issue : undefined;
  }
}

export function paypalBaseUrl(): string {
  return env.paypal.env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

type TokenCache = { token: string; expiresAt: number };
let tokenCache: TokenCache | null = null;
let inflight: Promise<string> | null = null;
const REFRESH_SKEW_MS = 60_000;

/** Drops the cached token so the next request fetches a fresh one (used after a 401 and by tests). */
export function invalidateAccessToken(): void { tokenCache = null; }

function parseJson(text: string): unknown { if (!text) return null; try { return JSON.parse(text); } catch { return { raw: text.slice(0, 500) }; } }

function summarize(body: unknown, status: number, fallback: string): string {
  const b = body as { name?: string; message?: string; error?: string; error_description?: string; details?: { issue?: string; description?: string }[] } | null;
  if (!b || typeof b !== "object") return `${fallback} (${status})`;
  const head = b.name ?? b.error ?? fallback;
  const msg = b.message ?? b.error_description ?? "";
  const issue = Array.isArray(b.details) ? b.details.find(d => d?.issue)?.issue : undefined;
  return `${head}${msg ? `: ${msg}` : ""}${issue ? ` [${issue}]` : ""} (${status})`;
}

async function fetchToken(): Promise<string> {
  const basic = Buffer.from(`${env.paypal.clientId}:${env.paypal.clientSecret}`).toString("base64");
  const res = await fetch(`${paypalBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: "grant_type=client_credentials",
  });
  const body = parseJson(await res.text()) as { access_token?: string; expires_in?: number | string } | null;
  if (!res.ok || !body?.access_token) {
    throw new PayPalError(summarize(body, res.status, "PayPal OAuth failed"), res.status, body && typeof body === "object" ? { ...body, access_token: undefined } : body, res.headers.get("paypal-debug-id") ?? undefined);
  }
  const ttlMs = Math.max(0, Number(body.expires_in ?? 0)) * 1000;
  tokenCache = { token: body.access_token, expiresAt: Date.now() + ttlMs };
  return body.access_token;
}

/** Client-credentials token, cached in memory and refreshed ~60s before expiry. */
export async function getAccessToken(): Promise<string> {
  if (!env.paypal.clientId || !env.paypal.clientSecret) throw new PayPalError("PayPal credentials are not configured (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET)", 0, null);
  if (tokenCache && tokenCache.expiresAt - REFRESH_SKEW_MS > Date.now()) return tokenCache.token;
  if (!inflight) inflight = fetchToken().finally(() => { inflight = null; });
  return inflight;
}

export interface PayPalRequestOptions { body?: unknown; requestId?: string; headers?: Record<string, string>; }
/**
 * Authenticated JSON request. When `requestId` is given it is sent as `PayPal-Request-Id` so retries are idempotent.
 * Throws PayPalError on non-2xx (never logs the token or the full response body). A 204 resolves to undefined.
 */
export async function paypalRequest<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, opts: PayPalRequestOptions = {}): Promise<T> {
  const send = async (token: string) => fetch(`${paypalBaseUrl()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: "return=representation",
      ...(opts.requestId ? { "PayPal-Request-Id": opts.requestId } : {}),
      ...(opts.headers ?? {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  let res = await send(await getAccessToken());
  if (res.status === 401) { // expired or revoked token: refresh exactly once
    invalidateAccessToken();
    res = await send(await getAccessToken());
  }
  const debugId = res.headers.get("paypal-debug-id") ?? undefined;
  if (res.status === 204) return undefined as T;
  const body = parseJson(await res.text());
  if (!res.ok) throw new PayPalError(summarize(body, res.status, `PayPal ${method} ${path} failed`), res.status, body, debugId);
  return body as T;
}

export function centsToAmount(cents: number): string { return (cents / 100).toFixed(2); }
export function amountToCents(value: string | number): number { return Math.round(Number(value) * 100); }
