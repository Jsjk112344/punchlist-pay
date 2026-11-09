import {NextRequest,NextResponse} from "next/server";
import {addProof,verifyFixture,orderById,fixtureHeaders} from "@/lib/server-fixtures";
import type {ProofKind} from "@/lib/types";
export const runtime="nodejs";
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!orderById(id))return NextResponse.json({error:"Not found"},{status:404,headers:fixtureHeaders});
 const form=await req.formData();const kind=form.get("kind");const file=form.get("file");
 if(!["checkin","after","receipt"].includes(String(kind))||!(file instanceof File))return NextResponse.json({error:"kind and file required"},{status:400,headers:fixtureHeaders});
 if(file.size>6*1024*1024)return NextResponse.json({error:"File too large"},{status:413,headers:fixtureHeaders});
 // TODO(api): Persist photo to object storage and read true EXIF metadata rather than upload time.
 const bytes=new Uint8Array(await file.arrayBuffer());const url=`data:${file.type||"application/octet-stream"};base64,${Buffer.from(bytes).toString("base64")}`;
 const proof=addProof(id,kind as ProofKind,url)!;
 if(kind==="after")verifyFixture(id); // PLAN.md: 'after' auto-triggers verification.
 return NextResponse.json({proof},{headers:fixtureHeaders});
}
