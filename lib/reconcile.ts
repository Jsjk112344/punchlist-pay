// Keeps the ledger in step with PayPal: a throttled poll (every 3s from GET /api/ledger) and the webhook handler.
// Pre-decided fallback from the plan: if webhooks never arrive, the poll alone is enough to settle orders and payouts.
import { moneyMode } from "@/lib/config";
import { ensureDb } from "@/lib/db/client";
import * as repo from "@/lib/db/repo";
import { moneyRail } from "@/lib/money";
import { mapPayoutStatus } from "@/lib/paypal/payouts";
import type { PayPalWebhookEvent } from "@/lib/paypal/webhooks";
import * as flows from "@/lib/flows";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
let lastRun = 0;
let running: Promise<void> | null = null;

/** Reconciles pending payouts and orders awaiting funding. No-op in fixture mode; at most once per 3s unless forced. */
export async function reconcilePending(force = false): Promise<void> {
  if (moneyMode() !== "live") return;
  if (running) return running;
  if (!force && Date.now() - lastRun < 3000) return;
  lastRun = Date.now();
  running = (async () => {
    try {
      await ensureDb();
      const rail = moneyRail();
      for (const payout of await repo.listPendingPayouts()) {
        try {
          const s = await rail.payoutStatus(payout.paypal_batch_id);
          if (s.status !== "pending") await flows.applyPayoutUpdate(payout, s.status, s.paid_at, s.item_id);
        } catch (e) { console.error(`[reconcile] payout ${payout.id}:`, errMsg(e)); }
      }
      for (const order of await repo.listOrdersAwaitingFunding()) {
        const paypalOrderId = order.contract?.paypal_order_id; if (!paypalOrderId) continue;
        try {
          const s = await rail.orderStatus(paypalOrderId);
          if (s.authorization_id) await flows.markAuthorized(order.id, s.authorization_id);
          else if (s.status === "APPROVED") await flows.confirmFunding(order.id, paypalOrderId);
          if (s.capture_id) await flows.markCaptured(order.id, s.capture_id);
        } catch (e) { console.error(`[reconcile] order ${order.id}:`, errMsg(e)); }
      }
    } finally { running = null; }
  })();
  return running;
}

type Resource = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const relatedOrderId = (r: Resource) => str((r.supplementary_data as { related_ids?: { order_id?: string } } | undefined)?.related_ids?.order_id);

/** Applies one verified, de-duplicated webhook event. Returns a short note for logging/response. */
export async function handleWebhookEvent(event: PayPalWebhookEvent): Promise<{ handled: boolean; note: string }> {
  await ensureDb();
  const r = event.resource ?? {};
  switch (event.event_type) {
    case "CHECKOUT.ORDER.APPROVED": {
      const orderId = str(r.id); if (!orderId) return { handled: false, note: "no order id" };
      const wo = await repo.findWorkOrderByPaypalOrderId(orderId); if (!wo) return { handled: false, note: `unknown order ${orderId}` };
      await flows.confirmFunding(wo.id, orderId); return { handled: true, note: `authorized ${wo.id}` };
    }
    case "PAYMENT.AUTHORIZATION.CREATED": {
      const authId = str(r.id); const orderId = relatedOrderId(r);
      if (!authId || !orderId) return { handled: false, note: "missing authorization/order id" };
      const wo = await repo.findWorkOrderByPaypalOrderId(orderId); if (!wo) return { handled: false, note: `unknown order ${orderId}` };
      await flows.markAuthorized(wo.id, authId); return { handled: true, note: `authorization recorded ${wo.id}` };
    }
    case "PAYMENT.CAPTURE.COMPLETED": {
      const captureId = str(r.id); const orderId = relatedOrderId(r);
      if (!captureId || !orderId) return { handled: false, note: "missing capture/order id" };
      const wo = await repo.findWorkOrderByPaypalOrderId(orderId); if (!wo) return { handled: false, note: `unknown order ${orderId}` };
      await flows.markCaptured(wo.id, captureId); return { handled: true, note: `capture recorded ${wo.id}` };
    }
    case "PAYMENT.PAYOUTSBATCH.SUCCESS":
    case "PAYMENT.PAYOUTSBATCH.DENIED": {
      const header = (r.batch_header ?? r) as Resource; const batchId = str(header.payout_batch_id);
      if (!batchId) return { handled: false, note: "no batch id" };
      const payout = await repo.findPayoutByBatchId(batchId); if (!payout) return { handled: false, note: `unknown batch ${batchId}` };
      const status = mapPayoutStatus(str(header.batch_status) ?? (event.event_type.endsWith("SUCCESS") ? "SUCCESS" : "DENIED"));
      await flows.applyPayoutUpdate(payout, status, str(header.time_completed) ?? event.create_time); return { handled: true, note: `payout batch ${status}` };
    }
    case "PAYMENT.PAYOUTS-ITEM.SUCCEEDED":
    case "PAYMENT.PAYOUTS-ITEM.FAILED":
    case "PAYMENT.PAYOUTS-ITEM.RETURNED":
    case "PAYMENT.PAYOUTS-ITEM.BLOCKED":
    case "PAYMENT.PAYOUTS-ITEM.UNCLAIMED": {
      const batchId = str(r.payout_batch_id); if (!batchId) return { handled: false, note: "no batch id" };
      const payout = await repo.findPayoutByBatchId(batchId); if (!payout) return { handled: false, note: `unknown batch ${batchId}` };
      const status = mapPayoutStatus("PROCESSING", str(r.transaction_status) ?? (event.event_type.endsWith("SUCCEEDED") ? "SUCCESS" : "FAILED"));
      if (status !== "pending") await flows.applyPayoutUpdate(payout, status, str(r.time_processed) ?? event.create_time, str(r.payout_item_id));
      return { handled: true, note: `payout item ${status}` };
    }
    default:
      return { handled: false, note: `ignored ${event.event_type}` };
  }
}
