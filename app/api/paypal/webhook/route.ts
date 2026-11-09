import {NextRequest} from "next/server";
import {verifySignature,parseEvent} from "@/lib/paypal/webhooks";
import {recordWebhookEvent} from "@/lib/db/repo";
import {ensureDb} from "@/lib/db/client";
import {handleWebhookEvent} from "@/lib/reconcile";
import {ok,fail} from "@/lib/http";
export const runtime="nodejs";
export const dynamic="force-dynamic";
// Signed PayPal webhooks only. Unsigned or unverifiable → 400 and no state change. Duplicates are acknowledged and skipped.
export async function POST(req:NextRequest){
 const raw=await req.text();
 if(!(await verifySignature(req.headers,raw)))return fail("Invalid webhook signature",400);
 let event;try{event=parseEvent(raw)}catch{return fail("Malformed webhook event",400)}
 await ensureDb();
 // Store type + resource id only; never the full payload (payer PII).
 const r=event.resource as Record<string,unknown>;
 const fresh=await recordWebhookEvent(event.id,event.event_type,{resource_type:event.resource_type??null,resource_id:typeof r.id==="string"?r.id:null,create_time:event.create_time});
 if(!fresh)return ok({ok:true,duplicate:true});
 try{const result=await handleWebhookEvent(event);return ok({ok:true,...result})}
 catch(e){console.error("[webhook]",event.event_type,e instanceof Error?e.message:e);return fail("Webhook handling failed",500)}
}
