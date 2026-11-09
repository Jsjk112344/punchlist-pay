import {NextRequest} from "next/server";
import {negotiateWorkOrder,mustGet} from "@/lib/flows";
import {modeHeaders} from "@/lib/config";
import {fail,handleError} from "@/lib/http";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=120;
// POST {contractor_id} → SSE: one `data:` line per TranscriptTurn, then `data: {contract, approve_url, paypal_order_id}`.
// A walk-away ends with `data: {error, outcome:"walked_away"}`; the UI client treats a stream without a contract as a failure.
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;const body=await req.json().catch(()=>null);
 if(typeof body?.contractor_id!=="string")return fail("contractor_id required",400);
 try{await mustGet(id)}catch(e){return handleError(e,"Negotiation")}
 const encoder=new TextEncoder();
 const stream=new ReadableStream<Uint8Array>({async start(controller){
  const send=(v:unknown)=>controller.enqueue(encoder.encode(`data: ${JSON.stringify(v)}\n\n`));
  try{
   const r=await negotiateWorkOrder(id,body.contractor_id,turn=>send(turn));
   if(r.outcome==="agreed")send({contract:r.contract,approve_url:r.approve_url,paypal_order_id:r.paypal_order_id,status:r.work_order.status});
   else send({error:`No agreement: ${r.reason}`,outcome:"walked_away"});
  }catch(e){console.error("[negotiate]",e instanceof Error?e.message:e);send({error:e instanceof Error&&e.name==="FlowError"?e.message:"Negotiation failed"})}
  finally{controller.close()}
 }});
 return new Response(stream,{headers:{...modeHeaders(),"Content-Type":"text/event-stream; charset=utf-8","Connection":"keep-alive","X-Accel-Buffering":"no"}});
}
