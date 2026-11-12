// Single source of truth for environment-driven behaviour. Secrets only ever come from env.
// Any provider whose credentials are missing degrades to an explicitly simulated fixture provider;
// responses carry X-Punchlist-Mode so the UI and smoke tests can tell which one answered.
import path from "node:path";

// Values are trimmed: a secret pasted into a dashboard with a trailing space or newline fails auth invisibly.
function str(name: string, fallback = ""): string { const v = process.env[name]?.trim(); return v === undefined || v === "" ? fallback : v; }

export const env = {
  // Render sets RENDER_EXTERNAL_URL on every web service, so APP_URL is optional there.
  appUrl: str("APP_URL", str("RENDER_EXTERNAL_URL", "http://localhost:3000")),
  paypal: {
    env: (str("PAYPAL_ENV", "sandbox") === "live" ? "live" : "sandbox") as "sandbox" | "live",
    clientId: str("PAYPAL_CLIENT_ID"),
    clientSecret: str("PAYPAL_CLIENT_SECRET"),
    webhookId: str("PAYPAL_WEBHOOK_ID"),
    publicClientId: str("NEXT_PUBLIC_PAYPAL_CLIENT_ID"),
  },
  anthropicApiKey: str("ANTHROPIC_API_KEY"),
  claudeModel: str("CLAUDE_MODEL", "claude-sonnet-5-5"),
  databaseUrl: str("DATABASE_URL"),
  pgliteDir: path.resolve(process.cwd(), str("PGLITE_DIR", "data/pglite")),
  uploadDir: path.resolve(process.cwd(), str("UPLOAD_DIR", "uploads")),
  contractorEmails: {
    mike: str("CONTRACTOR_EMAIL_MIKE", "sb-mike@personal.example.com"),
    sara: str("CONTRACTOR_EMAIL_SARA", "sb-sara@personal.example.com"),
    leo: str("CONTRACTOR_EMAIL_LEO", "sb-leo@personal.example.com"),
  },
};

export function paypalConfigured(): boolean { return Boolean(env.paypal.clientId && env.paypal.clientSecret); }
export function claudeConfigured(): boolean { return Boolean(env.anthropicApiKey); }
export function webhooksConfigured(): boolean { return paypalConfigured() && Boolean(env.paypal.webhookId); }
export function postgresConfigured(): boolean { return Boolean(env.databaseUrl); }

export type ProviderMode = "live" | "fixture";
export function moneyMode(): ProviderMode { return paypalConfigured() ? "live" : "fixture"; }
export function agentMode(): ProviderMode { return claudeConfigured() ? "live" : "fixture"; }

/** Response headers every API route sends. Mode reflects the money rail, which is what the UI must never misreport. */
export function modeHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { "X-Punchlist-Mode": moneyMode(), "X-Punchlist-Agents": agentMode(), "Cache-Control": "no-store", ...extra };
}

/** Hard guardrail from PLAN.md: no automatic payment on fail or confidence below this. */
export const AUTO_PAY_MIN_CONFIDENCE = 0.8;
export const DEFAULT_DEPOSIT_PCT = 20;
export const MAX_NEGOTIATION_TURNS = 4;

/** Demo timezone (PLAN.md timeline is in ET). Agents get "now" with this offset so "today" and "4 PM" mean local time. */
export const DEMO_TZ = process.env.DEMO_TZ || "America/New_York";
export function localNowIso(date: Date = new Date(), timeZone: string = DEMO_TZ): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "longOffset" }).formatToParts(date).map(p => [p.type, p.value]));
  const offset = (parts.timeZoneName ?? "GMT").replace("GMT", "") || "+00:00";
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}
