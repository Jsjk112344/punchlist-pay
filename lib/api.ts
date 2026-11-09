import type {Criterion,Contract,Proof,Verdict,WorkOrder} from "./types";
import {seedDraft,seedNegotiation,seedPass} from "./fixtures";
import {readOrders} from "./store";
// Endpoint names and payloads are from PLAN.md. This file does not implement server-side API routes.
const base=process.env.NEXT_PUBLIC_API_BASE_URL??"";
async function json<T>(path:string,init?:RequestInit):Promise<T>{
 const res=await fetch(`${base}${path}`,{...init,headers:{"Content-Type":"application/json",...(init?.headers||{})},cache:"no-store"});
 if(!res.ok)throw new Error(`Request failed (${res.status})`);return res.json() as Promise<T>;
}
export async function getLedger(fixture:boolean):Promise<WorkOrder[]>{
 if(fixture)return readOrders();
 const result=await json<unknown>("/api/ledger");
 // TODO(api): Map the backend's joined ledger rows to WorkOrder view models when GET /api/ledger is available.
 if(Array.isArray(result))return result as WorkOrder[];
 throw new Error("Unexpected ledger response. Confirm backend view-model mapping.");
}
export async function createWorkOrder(text:string,fixture:boolean):Promise<{work_order:WorkOrder}>{
 if(fixture){const unit=/\b(\d+[A-Za-z])\b/.exec(text)?.[1]??seedDraft.unit;return {work_order:{
  id:`wo-${Date.now()}`,property_id:"p-1",property_name:"Alder House",unit_id:`u-${unit.toLowerCase()}`,unit,
  title:seedDraft.title,description:text,criteria:seedDraft.criteria,budget_cents:seedDraft.budget_cents,status:"draft",created_by:"pm-1",updated_at:new Date().toISOString(),negotiation:[],proofs:[],payouts:[]}};
 }
 return json<{work_order:WorkOrder}>("/api/work-orders",{method:"POST",body:JSON.stringify({text})});
}
export async function negotiate(id:string,contractor_id:string,fixture:boolean):Promise<{contract:Contract;transcript:typeof seedNegotiation}>{
 if(fixture){const order=readOrders().find(o=>o.id===id);return {contract:{contractor_id,price_cents:24000,deposit_pct:20,deadline:"2026-11-09T16:00:00-05:00",criteria:order?.criteria??seedDraft.criteria,paypal_order_id:"5O190001S2349870K",paypal_auth_id:"8A4209933V000912E"},transcript:seedNegotiation};}
 // PLAN.md: POST /api/work-orders/:id/negotiate {contractor_id}, SSE turns ending in {contract}.
 const res=await fetch(`${base}/api/work-orders/${encodeURIComponent(id)}/negotiate`,{method:"POST",headers:{"Content-Type":"application/json","Accept":"text/event-stream"},body:JSON.stringify({contractor_id})});
 if(!res.ok)throw new Error(`Negotiation failed (${res.status})`);
 // TODO(api): Normalize the SSE turn/event envelope from the backend; no envelope is specified in PLAN.md.
 const contentType=res.headers.get("content-type")||"";
 if(contentType.includes("application/json")){const body=await res.json();return {contract:body.contract,transcript:body.transcript??[]};}
 const text=await res.text();const payloads=text.split(/\n\n/).flatMap(x=>x.split(/\n/).filter(y=>y.startsWith("data:")).map(y=>y.slice(5).trim())).filter(Boolean);
 let contract:Contract|undefined;const transcript:typeof seedNegotiation=[];
 for(const raw of payloads){try{const value=JSON.parse(raw);if(value.contract)contract=value.contract;else if(value.role&&value.text)transcript.push(value)}catch{}}
 if(!contract)throw new Error("Negotiation stream ended without contract");return{contract,transcript};
}
export async function submitProof(id:string,kind:Proof["kind"],file:File,fixture:boolean):Promise<{proof:Proof}>{
 if(fixture){return{proof:{id:`proof-${Date.now()}-${kind}`,work_order_id:id,kind,url:URL.createObjectURL(file),exif_ts:new Date().toISOString(),uploaded_at:new Date().toISOString()}}}
 const form=new FormData();form.append("kind",kind);form.append("file",file);
 const res=await fetch(`${base}/api/work-orders/${encodeURIComponent(id)}/proofs`,{method:"POST",body:form});
 if(!res.ok)throw new Error(`Proof upload failed (${res.status})`);return res.json() as Promise<{proof:Proof}>;
}
export async function verifyOrder(id:string,fixture:boolean):Promise<{verdict:Verdict}>{
 if(fixture)return{verdict:seedPass};
 return json<{verdict:Verdict}>(`/api/work-orders/${encodeURIComponent(id)}/verify`,{method:"POST"});
}
export async function createPayout(work_order_id:string,amount_cents:number,kind:"deposit"|"balance"|"partial",fixture:boolean){
 if(fixture)return {payout:{id:`p-${Date.now()}`,work_order_id,amount_cents,kind,paypal_batch_id:`FIXTURE-${kind.toUpperCase()}-${Date.now()}`,paypal_item_id:"FIXTURE-ITEM",status:"paid"}};
 return json<{payout:unknown}>("/api/payouts",{method:"POST",body:JSON.stringify({work_order_id,amount_cents,kind})});
}
export async function decide(id:string,action:"approve"|"redo"|"dispute",fixture:boolean){
 if(fixture)return{ok:true};
 return json<unknown>(`/api/work-orders/${encodeURIComponent(id)}/decision`,{method:"POST",body:JSON.stringify({action})});
}
