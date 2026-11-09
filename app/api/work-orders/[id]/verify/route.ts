import {NextResponse} from "next/server";
import {verifyFixture,orderById,fixtureHeaders} from "@/lib/server-fixtures";
export const runtime="nodejs";
export async function POST(_:Request,{params}:{params:Promise<{id:string}>}){
 const{id}=await params;if(!orderById(id))return NextResponse.json({error:"Not found"},{status:404,headers:fixtureHeaders});
 // TODO(api): Claude vision + full fail/partial handling; do not pay on fail or confidence < .8.
 const verdict=verifyFixture(id);if(!verdict)return NextResponse.json({error:"Missing after photo or receipt"},{status:409,headers:fixtureHeaders});
 return NextResponse.json({verdict},{headers:fixtureHeaders});
}
