import {createHash} from "node:crypto";
import {NextRequest} from "next/server";
import {agentMode,moneyMode,webhooksConfigured,env} from "@/lib/config";
import {ensureDb,dbDriver} from "@/lib/db/client";
import {getAccessToken} from "@/lib/paypal/client";
import {ok} from "@/lib/http";
export const runtime="nodejs";
export const dynamic="force-dynamic";
/** Shape of a credential without revealing it: length, first two characters, stray whitespace or quotes, short hash. */
function fingerprint(v:string){return {length:v.length,starts:v.slice(0,2),whitespace:v!==v.trim(),quoted:/^["']|["']$/.test(v.trim()),sha256_6:createHash("sha256").update(v).digest("hex").slice(0,6)}}
// Which providers are live. No secrets, only booleans and names. ?check=paypal also tries a PayPal token and fingerprints the credentials.
export async function GET(req:NextRequest){
 let db="ok";try{await ensureDb()}catch(e){db=e instanceof Error?e.message:"error"}
 const base={money:moneyMode(),paypal_env:env.paypal.env,agents:agentMode(),model:env.claudeModel,webhooks:webhooksConfigured(),database:dbDriver(),db,paypal_button:Boolean(env.paypal.publicClientId)};
 if(req.nextUrl.searchParams.get("check")!=="paypal")return ok(base);
 let token="ok";try{await getAccessToken()}catch(e){token=e instanceof Error?e.message:"error"}
 return ok({...base,paypal_check:{token,client_id:fingerprint(env.paypal.clientId),client_secret:fingerprint(env.paypal.clientSecret),client_id_matches_button:env.paypal.clientId===env.paypal.publicClientId}});
}
