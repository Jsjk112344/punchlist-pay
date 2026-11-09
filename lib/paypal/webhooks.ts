// Webhook signature verification + event parsing. Owner: lib/paypal. State changes happen in lib/money.ts.
// Request/response shape confirmed against developer.paypal.com/api/webhooks/v1/schema.json
// (verify_webhook_signature: auth_algo, cert_url, transmission_id, transmission_sig, transmission_time, webhook_id, webhook_event → verification_status SUCCESS|FAILURE).
import { env } from "@/lib/config";
import { paypalRequest } from "./client";

export interface PayPalWebhookEvent { id: string; event_type: string; create_time: string; resource_type?: string; resource: Record<string, unknown>; summary?: string }

export const HANDLED_EVENTS = [
  "CHECKOUT.ORDER.APPROVED",
  "PAYMENT.AUTHORIZATION.CREATED",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.PAYOUTSBATCH.SUCCESS",
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
  "PAYMENT.PAYOUTS-ITEM.FAILED",
] as const;
export type HandledEvent = (typeof HANDLED_EVENTS)[number];
export function isHandledEvent(type: string): type is HandledEvent { return (HANDLED_EVENTS as readonly string[]).includes(type); }

/** Header names PayPal sends with every webhook delivery (case-insensitive). */
export const SIGNATURE_HEADERS = {
  auth_algo: "paypal-auth-algo",
  cert_url: "paypal-cert-url",
  transmission_id: "paypal-transmission-id",
  transmission_sig: "paypal-transmission-sig",
  transmission_time: "paypal-transmission-time",
} as const;

/** POST /v1/notifications/verify-webhook-signature. Returns false (never throws) on any failure so callers reply 400 and mutate nothing. */
export async function verifySignature(headers: Headers, rawBody: string): Promise<boolean> {
  try {
    if (!env.paypal.webhookId) return false;
    const read = (name: string) => headers.get(name)?.trim() ?? "";
    const auth_algo = read(SIGNATURE_HEADERS.auth_algo);
    const cert_url = read(SIGNATURE_HEADERS.cert_url);
    const transmission_id = read(SIGNATURE_HEADERS.transmission_id);
    const transmission_sig = read(SIGNATURE_HEADERS.transmission_sig);
    const transmission_time = read(SIGNATURE_HEADERS.transmission_time);
    if (!auth_algo || !cert_url || !transmission_id || !transmission_sig || !transmission_time) return false;
    // Only trust certificates served by PayPal.
    const certHost = new URL(cert_url).hostname;
    if (!/(^|\.)paypal\.com$/i.test(certHost)) return false;
    const webhook_event = JSON.parse(rawBody) as unknown;
    if (!webhook_event || typeof webhook_event !== "object") return false;
    const result = await paypalRequest<{ verification_status?: string }>("POST", "/v1/notifications/verify-webhook-signature", {
      body: { auth_algo, cert_url, transmission_id, transmission_sig, transmission_time, webhook_id: env.paypal.webhookId, webhook_event },
    });
    return result?.verification_status === "SUCCESS";
  } catch {
    return false;
  }
}

/** Parses the raw body; throws on malformed JSON or a missing id/event_type. */
export function parseEvent(rawBody: string): PayPalWebhookEvent {
  let parsed: unknown;
  try { parsed = JSON.parse(rawBody); } catch { throw new Error("Webhook body is not valid JSON"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Webhook body must be a JSON object");
  const e = parsed as Record<string, unknown>;
  if (typeof e.id !== "string" || !e.id) throw new Error("Webhook event is missing id");
  if (typeof e.event_type !== "string" || !e.event_type) throw new Error("Webhook event is missing event_type");
  const resource = e.resource && typeof e.resource === "object" && !Array.isArray(e.resource) ? (e.resource as Record<string, unknown>) : {};
  return {
    id: e.id,
    event_type: e.event_type,
    create_time: typeof e.create_time === "string" ? e.create_time : new Date().toISOString(),
    resource_type: typeof e.resource_type === "string" ? e.resource_type : undefined,
    resource,
    summary: typeof e.summary === "string" ? e.summary : undefined,
  };
}
