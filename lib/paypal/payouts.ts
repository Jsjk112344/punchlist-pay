// Payouts v1. Owner: lib/paypal.
// Shapes confirmed against developer.paypal.com/api/payments.payouts-batch/v1/schema.json:
//   batch_status ∈ DENIED | PENDING | PROCESSING | SUCCESS | CANCELED
//   items[].transaction_status ∈ SUCCESS | FAILED | PENDING | UNCLAIMED | RETURNED | ONHOLD | BLOCKED | REFUNDED | REVERSED
//   A sender_batch_id reused within 30 days is rejected with an error that carries a HATEOAS link to the original batch.
import type { PayoutKind, PayoutStatus } from "@/lib/types";
import { centsToAmount, paypalRequest, PayPalError } from "./client";

export interface PayoutResult { batch_id: string; item_id: string; status: PayoutStatus; batch_status: string; item_status?: string; paid_at?: string }

interface BatchHeader { payout_batch_id: string; batch_status: string; time_created?: string; time_completed?: string; time_closed?: string; sender_batch_header?: { sender_batch_id?: string } }
interface BatchItem { payout_item_id: string; transaction_status?: string; time_processed?: string; payout_batch_id?: string }
interface CreatePayoutResponse { batch_header: BatchHeader; links?: { href: string; rel: string }[] }
interface PayoutBatchResponse { batch_header: BatchHeader; items?: BatchItem[] }

/**
 * sender_batch_id = `${work_order_id}:${kind}[:${scope}]` so a retry returns the existing batch instead of paying twice.
 * Pass the PayPal order id as scope: work-order ids repeat across databases, and an unscoped id would resolve to another run's payout.
 */
export function senderBatchId(work_order_id: string, kind: PayoutKind, scope?: string): string { return scope ? `${work_order_id}:${kind}:${scope}` : `${work_order_id}:${kind}`; }

const PAID_ITEM = new Set(["SUCCESS"]);
const FAILED_ITEM = new Set(["FAILED", "RETURNED", "BLOCKED", "REFUNDED", "REVERSED", "CANCELED"]);
const FAILED_BATCH = new Set(["DENIED", "CANCELED"]);

/** PayPal batch_status / transaction_status → our pending | paid | failed. The item status wins when present. */
export function mapPayoutStatus(batchStatus: string, itemStatus?: string): PayoutStatus {
  const item = itemStatus?.toUpperCase();
  if (item) {
    if (PAID_ITEM.has(item)) return "paid";
    if (FAILED_ITEM.has(item)) return "failed";
    return "pending"; // PENDING, UNCLAIMED, ONHOLD, anything new
  }
  const batch = batchStatus?.toUpperCase() ?? "";
  if (batch === "SUCCESS") return "paid";
  if (FAILED_BATCH.has(batch)) return "failed";
  return "pending"; // PENDING, PROCESSING, NEW
}

function toResult(batch: PayoutBatchResponse | CreatePayoutResponse): PayoutResult {
  const header = batch.batch_header;
  const item = (batch as PayoutBatchResponse).items?.[0];
  const status = mapPayoutStatus(header.batch_status, item?.transaction_status);
  return {
    batch_id: header.payout_batch_id,
    item_id: item?.payout_item_id ?? "",
    status,
    batch_status: header.batch_status,
    item_status: item?.transaction_status,
    paid_at: status === "paid" ? (item?.time_processed ?? header.time_completed ?? header.time_closed) : undefined,
  };
}

/** Finds a payout batch id in any HATEOAS link of an error body (PayPal puts it under details[].links or links). */
export function existingBatchIdFromError(body: unknown): string | undefined {
  const re = /\/v1\/payments\/payouts\/([A-Za-z0-9_-]+)/;
  let found: string | undefined;
  const walk = (node: unknown, depth: number): void => {
    if (found || depth > 6 || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const n of node) walk(n, depth + 1); return; }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (found) return;
      if (key === "href" && typeof value === "string") { const m = re.exec(value); if (m) { found = m[1]; return; } }
      else walk(value, depth + 1);
    }
  };
  walk(body, 0);
  return found;
}

/** POST /v1/payments/payouts. A duplicate sender_batch_id must resolve to the existing batch, not throw. */
export async function sendPayout(args: { work_order_id: string; kind: PayoutKind; receiver_email: string; amount_cents: number; note?: string; scope?: string }): Promise<PayoutResult> {
  if (!Number.isSafeInteger(args.amount_cents) || args.amount_cents <= 0) throw new PayPalError("amount_cents must be a positive integer", 0, null);
  if (!args.receiver_email || !args.receiver_email.includes("@")) throw new PayPalError("receiver_email must be an email address", 0, null);
  const sender_batch_id = senderBatchId(args.work_order_id, args.kind, args.scope);
  const body = {
    sender_batch_header: {
      sender_batch_id,
      email_subject: "Punchlist Pay payout",
      email_message: `Punchlist Pay released your ${args.kind} for work order ${args.work_order_id}.`,
    },
    items: [{
      recipient_type: "EMAIL",
      receiver: args.receiver_email,
      amount: { value: centsToAmount(args.amount_cents), currency: "USD" },
      note: (args.note ?? `${args.kind} · ${args.work_order_id}`).slice(0, 4000),
      sender_item_id: sender_batch_id,
    }],
  };
  let batchId: string;
  try {
    const created = await paypalRequest<CreatePayoutResponse>("POST", "/v1/payments/payouts", { body, requestId: sender_batch_id });
    batchId = created.batch_header.payout_batch_id;
    // The create response has no items; fetch the batch for the item id and status. Fall back to header data if that fails.
    try { return await getPayoutBatch(batchId); } catch { return toResult(created); }
  } catch (e) {
    if (e instanceof PayPalError) {
      const existing = existingBatchIdFromError(e.body);
      if (existing) return getPayoutBatch(existing); // duplicate sender_batch_id → the original payout
    }
    throw e;
  }
}

/** GET /v1/payments/payouts/{batch_id} */
export async function getPayoutBatch(batchId: string): Promise<PayoutResult> {
  const batch = await paypalRequest<PayoutBatchResponse>("GET", `/v1/payments/payouts/${encodeURIComponent(batchId)}`);
  return toResult(batch);
}
