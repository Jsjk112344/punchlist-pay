// The money rail. Live = PayPal sandbox/live REST via lib/paypal. Fixture = explicitly simulated ids (FIXTURE-*)
// used only when PAYPAL_CLIENT_ID/SECRET are absent. Nothing outside this file decides which one runs.
import { env, moneyMode } from "@/lib/config";
import * as orders from "@/lib/paypal/orders";
import * as payouts from "@/lib/paypal/payouts";
import type { PayoutKind, PayoutStatus } from "@/lib/types";

export interface CreateOrderArgs { work_order_id: string; amount_cents: number; description: string }
export interface CreateOrderResult { order_id: string; approve_url?: string; status: string; authorized: boolean; authorization_id?: string }
export interface PayoutArgs { work_order_id: string; kind: PayoutKind; receiver_email: string; amount_cents: number; note?: string }
export interface PayoutRailResult { batch_id: string; item_id: string; status: PayoutStatus; paid_at?: string }

export interface MoneyRail {
  mode: "live" | "fixture";
  createOrder(args: CreateOrderArgs): Promise<CreateOrderResult>;
  authorize(args: { work_order_id: string; order_id: string }): Promise<{ authorization_id: string; amount_cents: number }>;
  capture(args: { work_order_id: string; authorization_id: string; amount_cents?: number }): Promise<{ capture_id: string; status: string }>;
  voidAuthorization(args: { authorization_id: string }): Promise<void>;
  payout(args: PayoutArgs): Promise<PayoutRailResult>;
  payoutStatus(batch_id: string): Promise<PayoutRailResult>;
  orderStatus(order_id: string): Promise<{ status: string; authorization_id?: string; capture_id?: string }>;
}

const liveRail: MoneyRail = {
  mode: "live",
  async createOrder(args) {
    const created = await orders.createAuthorizeOrder({ ...args, return_url: `${env.appUrl}/dashboard?fixture=0&funded=${args.work_order_id}`, cancel_url: `${env.appUrl}/dashboard?fixture=0` });
    return { order_id: created.order_id, approve_url: created.approve_url, status: created.status, authorized: false };
  },
  async authorize({ order_id }) { const a = await orders.authorizeOrder(order_id); return { authorization_id: a.authorization_id, amount_cents: a.amount_cents }; },
  async capture({ work_order_id, authorization_id, amount_cents }) { const c = await orders.captureAuthorization(authorization_id, amount_cents, `${work_order_id}:capture`); return { capture_id: c.capture_id, status: c.status }; },
  async voidAuthorization({ authorization_id }) { await orders.voidAuthorization(authorization_id); },
  async payout(args) { const p = await payouts.sendPayout(args); return { batch_id: p.batch_id, item_id: p.item_id, status: p.status, paid_at: p.paid_at }; },
  async payoutStatus(batch_id) { const p = await payouts.getPayoutBatch(batch_id); return { batch_id: p.batch_id, item_id: p.item_id, status: p.status, paid_at: p.paid_at }; },
  async orderStatus(order_id) { const o = await orders.getOrder(order_id); return { status: o.status, authorization_id: o.authorization_id, capture_id: o.capture_id }; },
};

// Simulated rail. Every id is prefixed FIXTURE- and every transfer settles instantly. Never a PayPal transaction.
const fixtureRail: MoneyRail = {
  mode: "fixture",
  async createOrder({ work_order_id }) {
    const tag = work_order_id.toUpperCase();
    return { order_id: `FIXTURE-ORDER-${tag}`, status: "COMPLETED", authorized: true, authorization_id: `FIXTURE-AUTH-${tag}` };
  },
  async authorize({ work_order_id }) { return { authorization_id: `FIXTURE-AUTH-${work_order_id.toUpperCase()}`, amount_cents: 0 }; },
  async capture({ work_order_id }) { return { capture_id: `FIXTURE-CAPTURE-${work_order_id.toUpperCase()}`, status: "COMPLETED" }; },
  async voidAuthorization() { /* nothing to void */ },
  async payout({ work_order_id, kind }) {
    const tag = `${work_order_id}-${kind}`.toUpperCase();
    return { batch_id: `FIXTURE-${tag}`, item_id: `FIXTURE-ITEM-${kind.toUpperCase()}`, status: "paid", paid_at: new Date().toISOString() };
  },
  async payoutStatus(batch_id) { return { batch_id, item_id: "FIXTURE-ITEM", status: "paid", paid_at: new Date().toISOString() }; },
  async orderStatus() { return { status: "COMPLETED" }; },
};

export function moneyRail(): MoneyRail { return moneyMode() === "live" ? liveRail : fixtureRail; }
export function depositCents(price_cents: number, deposit_pct: number): number { return Math.round(price_cents * deposit_pct / 100); }
