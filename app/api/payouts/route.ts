import {NextRequest,NextResponse} from "next/server";
import {payoutFixture,fixtureHeaders} from "@/lib/server-fixtures";
export const runtime="nodejs";
export async function POST(req:NextRequest){const b=await req.json().catch(()=>null);
 if(!b||typeof b.work_order_id!=="string"||!Number.isSafeInteger(b.amount_cents)||!["deposit","balance","partial"].includes(b.kind))return NextResponse.json({error:"Invalid payout request"},{status:400,headers:fixtureHeaders});
 // TODO(api): Replace with PayPal Payouts v1 and idempotency key; never emit 'paid' without confirmed API response.
 const payout=payoutFixture(b.work_order_id,b.amount_cents,b.kind);
 if(!payout)return NextResponse.json({error:"Payout blocked"},{status:409,headers:fixtureHeaders});
 return NextResponse.json({payout},{headers:fixtureHeaders});}
