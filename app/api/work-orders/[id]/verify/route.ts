import {verifyWorkOrder} from "@/lib/flows";
import {ok,handleError} from "@/lib/http";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=120;
// POST → Verifier → {verdict}. pass/partial ≥ 0.8 → capture + payout; fail or < 0.8 → escalated, nothing paid.
export async function POST(_:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;
 try{return ok({verdict:await verifyWorkOrder(id)})}catch(e){return handleError(e,"Verify")}
}
