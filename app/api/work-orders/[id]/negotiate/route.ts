import {NextRequest,NextResponse} from "next/server";
import {authorizeFixture,orderById,fixtureHeaders} from "@/lib/server-fixtures";
import {seedNegotiation} from "@/lib/fixtures";
export const runtime="nodejs";
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;const body=await req.json().catch(()=>null);
 if(!orderById(id))return NextResponse.json({error:"Not found"},{status:404,headers:fixtureHeaders});
 if(typeof body?.contractor_id!=="string")return NextResponse.json({error:"contractor_id required"},{status:400,headers:fixtureHeaders});
 // TODO(api): Stream real Dispatcher/Contractor agent turns, create and authorize PayPal Order.
 const contract=authorizeFixture(id,body.contractor_id)!;
 const encoder=new TextEncoder();const transcript=seedNegotiation;
 const stream=new ReadableStream<Uint8Array>({async start(controller){
  for(const turn of transcript){controller.enqueue(encoder.encode(`data: ${JSON.stringify(turn)}\n\n`));await new Promise(r=>setTimeout(r,220))}
  controller.enqueue(encoder.encode(`data: ${JSON.stringify({contract})}\n\n`));controller.close();
 }});
 return new Response(stream,{headers:{...fixtureHeaders,"Content-Type":"text/event-stream; charset=utf-8","Connection":"keep-alive","X-Accel-Buffering":"no"}});
}
