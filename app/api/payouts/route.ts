import {NextRequest} from "next/server";
import {releasePayout} from "@/lib/flows";
import {ok,fail,handleError} from "@/lib/http";
export const runtime="nodejs";
export const dynamic="force-dynamic";
// POST {work_order_id, amount_cents, kind} → {payout}. Same guards as the automatic path: deposit needs a check-in,
// balance/partial need a pass/partial verdict ≥ 0.8. Never reports `paid` without a confirmed PayPal response.
export async function POST(req:NextRequest){
 const b=await req.json().catch(()=>null);
 if(!b||typeof b.work_order_id!=="string"||!Number.isSafeInteger(b.amount_cents)||!["deposit","balance","partial"].includes(b.kind))return fail("Invalid payout request",400);
 try{return ok({payout:await releasePayout(b.work_order_id,b.amount_cents,b.kind)})}catch(e){return handleError(e,"Payout")}
}
