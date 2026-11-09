import {NextRequest} from "next/server";
import {createWorkOrderFromText} from "@/lib/flows";
import {ok,fail,handleError} from "@/lib/http";
export const runtime="nodejs";
export const dynamic="force-dynamic";
// POST {text} → Dispatcher agent → {work_order}
export async function POST(req:NextRequest){
 const body=await req.json().catch(()=>null);
 if(typeof body?.text!=="string"||!body.text.trim())return fail("text required",400);
 if(body.text.length>2000)return fail("text too long",413);
 try{return ok({work_order:await createWorkOrderFromText(body.text)})}catch(e){return handleError(e,"Create work order")}
}
