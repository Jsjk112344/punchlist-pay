import {agentMode,moneyMode,webhooksConfigured,env} from "@/lib/config";
import {ensureDb,dbDriver} from "@/lib/db/client";
import {ok} from "@/lib/http";
export const runtime="nodejs";
export const dynamic="force-dynamic";
// Which providers are live. No secrets, only booleans and names.
export async function GET(){
 let db="ok";try{await ensureDb()}catch(e){db=e instanceof Error?e.message:"error"}
 return ok({money:moneyMode(),paypal_env:env.paypal.env,agents:agentMode(),model:env.claudeModel,webhooks:webhooksConfigured(),database:dbDriver(),db,paypal_button:Boolean(env.paypal.publicClientId)});
}
