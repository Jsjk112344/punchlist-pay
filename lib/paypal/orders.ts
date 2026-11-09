// Orders v2 (intent AUTHORIZE) + Payments v2 authorizations. Owner: lib/paypal.
// Shapes confirmed against developer.paypal.com/api/orders/v2/schema.json and /api/payments/v2/schema.json.
import { env } from "@/lib/config";
import { amountToCents, centsToAmount, paypalRequest, PayPalError } from "./client";

export interface CreatedOrder { order_id: string; status: string; approve_url: string }
export interface AuthorizedOrder { order_id: string; authorization_id: string; status: string; amount_cents: number }
export interface CaptureResult { capture_id: string; status: string; amount_cents: number }
export interface OrderSnapshot { order_id: string; status: string; authorization_id?: string; capture_id?: string; approve_url?: string; amount_cents?: number }

interface Link { href: string; rel: string; method?: string }
interface Money { currency_code?: string; value?: string }
interface PaymentRef { id: string; status?: string; amount?: Money }
interface OrderResponse {
  id: string; status: string; links?: Link[];
  purchase_units?: { reference_id?: string; amount?: Money; payments?: { authorizations?: PaymentRef[]; captures?: PaymentRef[] } }[];
}
interface CaptureResponse { id: string; status: string; amount?: Money }

/** PayPal returns rel "payer-action" for payment_source.paypal orders and "approve" for legacy application_context orders. */
export function approveLink(links: Link[] | undefined, orderId?: string): string | undefined {
  const found = links?.find(l => l.rel === "payer-action")?.href ?? links?.find(l => l.rel === "approve")?.href;
  if (found) return found;
  if (!orderId) return undefined;
  return `${env.paypal.env === "live" ? "https://www.paypal.com" : "https://www.sandbox.paypal.com"}/checkoutnow?token=${encodeURIComponent(orderId)}`;
}

function firstAuthorization(order: OrderResponse | undefined): PaymentRef | undefined { return order?.purchase_units?.[0]?.payments?.authorizations?.[0]; }
function firstCapture(order: OrderResponse | undefined): PaymentRef | undefined { return order?.purchase_units?.[0]?.payments?.captures?.[0]; }

/** POST /v2/checkout/orders with intent AUTHORIZE. PayPal-Request-Id = `${work_order_id}:order`. */
export async function createAuthorizeOrder(args: { work_order_id: string; amount_cents: number; description: string; return_url?: string; cancel_url?: string }): Promise<CreatedOrder> {
  if (!Number.isSafeInteger(args.amount_cents) || args.amount_cents <= 0) throw new PayPalError("amount_cents must be a positive integer", 0, null);
  const fallback = `${env.appUrl}/dashboard?fixture=0`;
  const body = {
    intent: "AUTHORIZE",
    purchase_units: [{
      reference_id: args.work_order_id,
      custom_id: args.work_order_id,
      description: args.description.slice(0, 127),
      amount: { currency_code: "USD", value: centsToAmount(args.amount_cents) },
    }],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: "Punchlist Pay",
          user_action: "PAY_NOW",
          shipping_preference: "NO_SHIPPING",
          return_url: args.return_url ?? fallback,
          cancel_url: args.cancel_url ?? fallback,
        },
      },
    },
  };
  const order = await paypalRequest<OrderResponse>("POST", "/v2/checkout/orders", { body, requestId: `${args.work_order_id}:order` });
  const approve_url = approveLink(order.links, order.id);
  if (!approve_url) throw new PayPalError("PayPal order response had no approve link", 0, { id: order.id, status: order.status });
  return { order_id: order.id, status: order.status, approve_url };
}

/** POST /v2/checkout/orders/{id}/authorize after payer approval. Returns the authorization id. */
export async function authorizeOrder(orderId: string): Promise<AuthorizedOrder> {
  let order: OrderResponse;
  try {
    order = await paypalRequest<OrderResponse>("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, { body: {}, requestId: `${orderId}:authorize` });
  } catch (e) {
    // A retry after a success is reported as 422 ORDER_ALREADY_AUTHORIZED; the authorization still exists on the order.
    if (e instanceof PayPalError && e.status === 422 && e.issue === "ORDER_ALREADY_AUTHORIZED") {
      order = await paypalRequest<OrderResponse>("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
    } else throw e;
  }
  const auth = firstAuthorization(order);
  if (!auth?.id) throw new PayPalError(`PayPal order ${orderId} has no authorization (status ${order.status})`, 0, { id: order.id, status: order.status });
  return { order_id: order.id, authorization_id: auth.id, status: auth.status ?? order.status, amount_cents: amountToCents(auth.amount?.value ?? order.purchase_units?.[0]?.amount?.value ?? "0") };
}

/** POST /v2/payments/authorizations/{id}/capture. Omit amount to capture the full authorization. */
export async function captureAuthorization(authorizationId: string, amount_cents?: number, requestId?: string): Promise<CaptureResult> {
  const body: { final_capture: boolean; amount?: Money } = { final_capture: true };
  if (amount_cents !== undefined) {
    if (!Number.isSafeInteger(amount_cents) || amount_cents <= 0) throw new PayPalError("amount_cents must be a positive integer", 0, null);
    body.amount = { currency_code: "USD", value: centsToAmount(amount_cents) };
  }
  const capture = await paypalRequest<CaptureResponse>("POST", `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`, { body, requestId });
  return { capture_id: capture.id, status: capture.status, amount_cents: capture.amount?.value !== undefined ? amountToCents(capture.amount.value) : (amount_cents ?? 0) };
}

/** POST /v2/payments/authorizations/{id}/void (200 with representation or 204). */
export async function voidAuthorization(authorizationId: string): Promise<void> {
  await paypalRequest<unknown>("POST", `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`, { requestId: `${authorizationId}:void` });
}

/** GET /v2/checkout/orders/{id}; surfaces authorization/capture ids when present. */
export async function getOrder(orderId: string): Promise<OrderSnapshot> {
  const order = await paypalRequest<OrderResponse>("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
  const auth = firstAuthorization(order); const cap = firstCapture(order);
  const amount = order.purchase_units?.[0]?.amount?.value;
  return {
    order_id: order.id,
    status: order.status,
    authorization_id: auth?.id,
    capture_id: cap?.id,
    approve_url: approveLink(order.links),
    amount_cents: amount !== undefined ? amountToCents(amount) : undefined,
  };
}
