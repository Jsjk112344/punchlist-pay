import {NextResponse} from "next/server";
import {orders,fixtureHeaders} from "@/lib/server-fixtures";
export const runtime="nodejs";
export async function GET(){
 // TODO(api): Join work_orders, contracts, proofs, verdicts and payouts from Drizzle; poll/webhook updates.
 return NextResponse.json(orders(),{headers:fixtureHeaders});
}
