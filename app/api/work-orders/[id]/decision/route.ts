import {NextRequest,NextResponse} from "next/server";
import {decideFixture,orderById,fixtureHeaders} from "@/lib/server-fixtures";
export const runtime="nodejs";
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;const data=await req.json().catch(()=>null);
 if(!orderById(id))return NextResponse.json({error:"Not found"},{status:404,headers:fixtureHeaders});
 if(!["approve","redo","dispute"].includes(data?.action))return NextResponse.json({error:"Invalid action"},{status:400,headers:fixtureHeaders});
 // TODO(api): Persist reviewer identity + reason, action and idempotent PayPal release in Drizzle.
 decideFixture(id,data.action);return NextResponse.json({ok:true},{headers:fixtureHeaders});
}
