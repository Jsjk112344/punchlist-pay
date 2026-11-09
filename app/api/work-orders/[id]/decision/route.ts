import {NextRequest} from "next/server";
import {decideWorkOrder} from "@/lib/flows";
import {ok,fail,handleError} from "@/lib/http";
export const runtime="nodejs";
export const dynamic="force-dynamic";
// POST {action: approve|redo|dispute} (PM escalation) → {ok:true}
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;const data=await req.json().catch(()=>null);
 if(!["approve","redo","dispute"].includes(data?.action))return fail("Invalid action",400);
 try{await decideWorkOrder(id,data.action);return ok({ok:true})}catch(e){return handleError(e,"Decision")}
}
