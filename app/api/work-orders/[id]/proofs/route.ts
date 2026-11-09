import {NextRequest} from "next/server";
import {recordProof,verifyWorkOrder,FlowError} from "@/lib/flows";
import {ok,fail,handleError} from "@/lib/http";
import type {ProofKind} from "@/lib/types";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=120;
// multipart {kind,file} → {proof}. kind=checkin releases the deposit; kind=after auto-triggers verify (PLAN.md).
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;
 const form=await req.formData().catch(()=>null);const kind=form?.get("kind");const file=form?.get("file");
 if(!["checkin","after","receipt"].includes(String(kind))||!(file instanceof File))return fail("kind and file required",400);
 if(file.size>8*1024*1024)return fail("File too large",413);
 if(file.type&&!file.type.startsWith("image/"))return fail("Proof must be an image",415);
 try{
  const proof=await recordProof(id,kind as ProofKind,file);
  if(kind==="after"){try{await verifyWorkOrder(id)}catch(e){if(!(e instanceof FlowError))console.error("[proofs] auto-verify",e instanceof Error?e.message:e)}}
  return ok({proof});
 }catch(e){return handleError(e,"Proof upload")}
}
