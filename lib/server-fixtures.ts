// TODO(api): Replace this in-memory process-local simulation with PLAN.md Drizzle/PayPal/Claude handlers.
// Responses are fixture-only and must never be represented as real PayPal transactions.
import {seedOrders,seedDraft,seedNegotiation,seedPass} from "./fixtures";
import type {Contract,Proof,Payout,WorkOrder} from "./types";
type GlobalState=typeof globalThis&{__punchlistFixtureOrders?:WorkOrder[]};
const state=globalThis as GlobalState;
export const fixtureHeaders={"X-Punchlist-Mode":"fixture","Cache-Control":"no-store"};
export function orders(){if(!state.__punchlistFixtureOrders)state.__punchlistFixtureOrders=structuredClone(seedOrders);return state.__punchlistFixtureOrders}
export function orderById(id:string){return orders().find(o=>o.id===id)}
export function saveOrder(order:WorkOrder){state.__punchlistFixtureOrders=orders().map(o=>o.id===order.id?order:o);return order}
export function makeOrder(text:string){const unit=/\b(\d+[A-Za-z])\b/.exec(text)?.[1]??seedDraft.unit;
 const o:WorkOrder={id:`wo-${Date.now()}`,property_id:"p-1",property_name:"Alder House",unit_id:`u-${unit.toLowerCase()}`,unit,title:seedDraft.title,description:text,criteria:structuredClone(seedDraft.criteria),budget_cents:seedDraft.budget_cents,status:"draft",created_by:"pm-1",updated_at:new Date().toISOString(),negotiation:[],proofs:[],payouts:[]};
 state.__punchlistFixtureOrders=[o,...orders()];return o;
}
export function authorizeFixture(id:string,contractor_id:string){const order=orderById(id);if(!order)return null;
 const criteria=order.criteria.map(c=>c.check==="time"?{...c,text:"Completed before 4:00 PM"}:c);
 const contract:Contract={contractor_id,price_cents:24000,deposit_pct:20,deadline:"2026-11-09T16:00:00-05:00",criteria,paypal_order_id:"FIXTURE-ORDER-1042",paypal_auth_id:"FIXTURE-AUTH-1042"};
 saveOrder({...order,contract,criteria,contractor_id,contractor_name:"Mike Torres",contractor_trade:"Plumbing",avatar_tone:0,status:"funded",negotiation:structuredClone(seedNegotiation),updated_at:new Date().toISOString()});return contract;
}
export function payoutFixture(work_order_id:string,amount_cents:number,kind:Payout["kind"]):Payout|null{
 const o=orderById(work_order_id);if(!o||!o.contract)return null;
 if(kind==="deposit"){
  const expected=Math.round(o.contract.price_cents*o.contract.deposit_pct/100);
  if(!o.proofs.some(p=>p.kind==="checkin")||amount_cents!==expected)return null;
 }
 if(kind!=="deposit"&&(!o.verdict||(o.verdict.verdict==="fail"||o.verdict.confidence<.8)))return null;
 const existing=o.payouts.find(p=>p.kind===kind);if(existing)return existing;
 const total=o.contract.price_cents;const already=o.payouts.reduce((sum,p)=>p.status==="paid"?sum+p.amount_cents:sum,0);
 if(amount_cents<=0||amount_cents>total-already)return null;
 const p:Payout={id:`pay-${work_order_id}-${kind}`,work_order_id,contractor_id:o.contractor_id,kind,amount_cents,paypal_batch_id:`FIXTURE-${work_order_id}-${kind}`.toUpperCase(),paypal_item_id:`FIXTURE-ITEM-${kind}`,status:"paid",paid_at:new Date().toISOString()};
 const next=[...o.payouts,p];const done=next.filter(x=>x.status==="paid").reduce((n,x)=>n+x.amount_cents,0)>=total;
 saveOrder({...o,payouts:next,status:done?"paid":"in_progress",updated_at:new Date().toISOString()});return p;
}
export function addProof(id:string,kind:Proof["kind"],url:string){const o=orderById(id);if(!o)return null;
 const p:Proof={id:`pr-${Date.now()}-${kind}`,work_order_id:id,kind,url,exif_ts:new Date().toISOString(),uploaded_at:new Date().toISOString()};
 saveOrder({...o,proofs:[...o.proofs.filter(x=>x.kind!==kind),p],status:kind==="checkin"?"in_progress":o.status,updated_at:new Date().toISOString()});
 if(kind==="checkin"&&o.contract){const cents=Math.round(o.contract.price_cents*o.contract.deposit_pct/100);if(cents)payoutFixture(id,cents,"deposit")}
 return p;
}
export function verifyFixture(id:string){const o=orderById(id);if(!o)return null;
 if(o.status==="paid"&&o.verdict)return o.verdict;
 const hasAfter=o.proofs.some(p=>p.kind==="after"),hasReceipt=o.proofs.some(p=>p.kind==="receipt");
 // TODO(api): Replace with Claude Vision, EXIF cross-check and per-criterion evidence.
 if(!hasAfter||!hasReceipt)return null;
 const paid=o.payouts.filter(p=>p.status==="paid").reduce((n,p)=>n+p.amount_cents,0);
 const amount=Math.max(0,(o.contract?.price_cents??o.budget_cents)-paid);
 const verdict={...seedPass,amount_to_release_cents:amount};
 saveOrder({...o,verdict,status:"under_review",updated_at:new Date().toISOString()});
 if(verdict.verdict==="pass"&&verdict.confidence>=.8&&amount>0)payoutFixture(id,amount,"balance");
 return verdict;
}
export function decideFixture(id:string,action:"approve"|"redo"|"dispute"){
 const o=orderById(id);if(!o)return null;
 if(action==="redo")return saveOrder({...o,status:"redo_requested",verdict:undefined,proofs:o.proofs.filter(p=>p.kind==="checkin"),updated_at:new Date().toISOString()});
 if(action==="dispute")return saveOrder({...o,status:"disputed",updated_at:new Date().toISOString()});
 if(action==="approve"){
  // Explicit human override only. Server must keep proof/verdict audit trail.
  const updated=saveOrder({...o,status:"under_review",verdict:o.verdict??{verdict:"fail",confidence:0,criteria:[],amount_to_release_cents:0,model:"human-override"}});
  const paid=updated.payouts.filter(p=>p.status==="paid").reduce((n,p)=>n+p.amount_cents,0);
  // The real backend uses a separate approved override; this fixture temporarily normalizes verdict for payout guard.
  const override=saveOrder({...updated,verdict:{...updated.verdict!,verdict:"pass",confidence:1}});
  const amount=(override.contract?.price_cents??0)-paid;
  if(amount>0)payoutFixture(id,amount,"balance");
  return saveOrder({...orderById(id)!,verdict:updated.verdict,status:"paid",updated_at:new Date().toISOString()});
 }
 return null;
}
