import {ensureDb} from "@/lib/db/client";
import {listWorkOrders} from "@/lib/db/repo";
import {reconcilePending} from "@/lib/reconcile";
import {ok,handleError} from "@/lib/http";
export const runtime="nodejs";
export const dynamic="force-dynamic";
// GET → WorkOrder[] (the UI polls every 3s). Each poll also reconciles pending PayPal orders/payouts (throttled to 3s).
export async function GET(){
 try{
  await ensureDb();
  await reconcilePending().catch(e=>console.error("[ledger] reconcile",e instanceof Error?e.message:e));
  return ok(await listWorkOrders());
 }catch(e){return handleError(e,"Ledger")}
}
