import {NextRequest} from "next/server";
import {confirmFunding} from "@/lib/flows";
import {ok,handleError} from "@/lib/http";
export const runtime="nodejs";
export const dynamic="force-dynamic";
// POST {paypal_order_id} after the PM approves in the PayPal popup → authorize → {work_order} (status funded)
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;const body=await req.json().catch(()=>({}));
 try{return ok({work_order:await confirmFunding(id,typeof body?.paypal_order_id==="string"?body.paypal_order_id:undefined)})}catch(e){return handleError(e,"Fund confirm")}
}
