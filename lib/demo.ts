import type {WorkOrder,Payout,Proof} from "./types";
import {seedPass} from "./fixtures";
export const sceneTime="2026-11-09T15:52:00-05:00";
const timestamps={checkin:"2026-11-09T15:11:00-05:00",after:sceneTime,receipt:"2026-11-09T15:38:00-05:00"};
export function demoProof(order:WorkOrder,kind:Proof["kind"],url:string):Proof{return{id:`proof-${Date.now()}-${kind}`,work_order_id:order.id,kind,url,exif_ts:timestamps[kind],uploaded_at:new Date().toISOString()}}
export function demoPayout(order:WorkOrder,kind:Payout["kind"],amount_cents:number):Payout{return {id:`payout-${order.id}-${kind}`,work_order_id:order.id,contractor_id:order.contractor_id??"mike",amount_cents,kind,paypal_batch_id:`FIXTURE-${order.id}-${kind}`.toUpperCase(),paypal_item_id:`FIXTURE-ITEM-${kind}`,status:"paid",paid_at:kind==="deposit"?"2026-11-09T15:12:00-05:00":"2026-11-09T15:53:00-05:00"}}
export function applyCheckin(o:WorkOrder):WorkOrder{if(o.payouts.some(p=>p.kind==="deposit"))return o;
 const amount=Math.round((o.contract?.price_cents??o.budget_cents)*(o.contract?.deposit_pct??20)/100);
 return {...o,status:"in_progress",updated_at:new Date().toISOString(),proofs:[...o.proofs,demoProof(o,"checkin","/fixtures/sink-before.jpg")],payouts:[...o.payouts,demoPayout(o,"deposit",amount)]};
}
export function applyPass(o:WorkOrder,afterUrl:string,receiptUrl:string):WorkOrder{
 const total=o.contract?.price_cents??o.budget_cents;
 const paid=o.payouts.filter(p=>p.status==="paid").reduce((n,p)=>n+p.amount_cents,0);
 const balance=Math.max(0,total-paid);
 return{...o,status:"paid",verdict:{...seedPass,amount_to_release_cents:balance},updated_at:new Date().toISOString(),proofs:[...o.proofs.filter(p=>!["after","receipt"].includes(p.kind)),demoProof(o,"after",afterUrl),demoProof(o,"receipt",receiptUrl)],payouts:[...o.payouts,...(balance?[demoPayout(o,"balance",balance)]:[])]};
}
