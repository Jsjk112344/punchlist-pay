import {NextRequest,NextResponse} from "next/server";
import {makeOrder,fixtureHeaders} from "@/lib/server-fixtures";
export const runtime="nodejs";
export async function POST(req:NextRequest){
 const body=await req.json().catch(()=>null);
 if(typeof body?.text!=="string"||!body.text.trim())return NextResponse.json({error:"text required"},{status:400,headers:fixtureHeaders});
 // TODO(api): Dispatcher Claude structured work-order generation, Drizzle write.
 return NextResponse.json({work_order:makeOrder(body.text)},{headers:fixtureHeaders});
}
