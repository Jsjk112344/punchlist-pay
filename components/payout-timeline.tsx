import {Check,Circle} from "lucide-react";
import type {WorkOrder,Payout} from "@/lib/types";
import {money,shortTime,agreedCents} from "@/lib/format";
export function PayoutTimeline({order,compact=false}:{order:WorkOrder;compact?:boolean}){
 const agreed=agreedCents(order);const deposit=Math.round(agreed*(order.contract?.deposit_pct??0)/100);
 const types:("deposit"|"balance")[]=deposit>0?["deposit","balance"]:["balance"];
 const rows=types.map(kind=>({kind,payout:order.payouts.find(p=>p.kind===kind),amount:kind==="deposit"?deposit:agreed-deposit}));
 return <div className={compact?"space-y-3":"space-y-0"}>{rows.map(({kind,payout,amount},index)=>{const paid=payout?.status==="paid";return <div key={kind} className={`grid grid-cols-[24px_1fr_auto] items-start gap-3 ${compact?"":"border-b border-border py-4 last:border-b-0"}`}>
 <div className={`icon-ring mt-0.5 h-6 w-6 ${paid?"bg-paid-soft text-paid":"border border-[#CAD2DC] text-[#9AA7B6]"}`}>{paid?<Check size={14} strokeWidth={3}/>:<Circle size={11}/>}</div>
 <div><div className="flex items-center gap-2 text-[13px] font-semibold"><span>{kind==="deposit"?"Deposit":"Balance"}</span><span className={`text-[11px] font-medium ${paid?"text-paid":"text-muted"}`}>{paid?"Paid":"Pending"}</span></div>
 <div className="mt-1 text-[11px] text-muted mono">{payout?.paypal_batch_id??"—"}</div></div>
 <div className="text-right"><div className={`mono text-[15px] font-bold ${paid?"text-paid":"text-ink"}`}>{money(amount)}</div><div className="mt-1 text-[11px] text-muted mono">{paid?shortTime(payout.paid_at):"—"}</div></div>
 </div>})}</div>
}
