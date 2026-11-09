import {NextResponse} from "next/server";
export const runtime="nodejs";
// TODO(api): Verify signed PayPal webhook via /v1/notifications/verify-webhook-signature.
// Never accept or mutate payment state from unsigned fixture webhook requests.
export async function POST(){return NextResponse.json({error:"Webhook verification not configured"},{status:501});}
