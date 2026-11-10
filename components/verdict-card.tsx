"use client";
import {Check, X, AlertTriangle} from "lucide-react";
import type {WorkOrder} from "@/lib/types";
import {ProofStrip} from "./proof-strip";
import {shortTime} from "@/lib/format";
import {Button} from "./ui/button";
export function VerdictCard({order,onApprove,onRedo,working=false,embedded=false}:{order:WorkOrder;onApprove?:()=>void;onRedo?:()=>void;working?:boolean;embedded?:boolean}){
 const v=order.verdict;
 if(!v)return <div className="flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-5 text-sm text-muted">Verification pending</div>;
 const blocked=["escalated","under_review","disputed"].includes(order.status);
 const override=order.status==="paid"&&v.verdict==="fail";
 return <div className="panel p-5 sm:p-6">
  <div className="flex items-center justify-between gap-4"><div><div className="label mb-1">Verification</div><h3 className={`text-[30px] font-bold tracking-[-.055em] ${blocked?"text-warn":v.verdict==="pass"?"text-paid":"text-warn"}`}>{blocked?"NEEDS REVIEW":override?"APPROVED":v.verdict.toUpperCase()}</h3>{override&&<div className="mt-1 text-[12px] font-semibold text-muted">Property manager override · Verifier said {v.verdict} at {Math.round(v.confidence*100)}%</div>}</div>
   <div className="w-28"><div className="mb-2 flex items-baseline justify-between text-[11px] text-muted"><span>Confidence</span><span className="mono font-semibold text-ink">{Math.round(v.confidence*100)}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-[#E6EAF0]"><div className={`h-full rounded-full ${blocked?"bg-[#C58A27]":"bg-paid"}`} style={{width:`${Math.round(v.confidence*100)}%`}}/></div></div>
  </div>
  <div className="mt-5 space-y-0.5">{v.criteria.map((c,i)=>{const criterion=order.criteria.find(x=>x.id===c.id);return <div key={c.id} className="grid grid-cols-[18px_1fr] gap-x-3 py-2.5 animate-criteriaIn" style={{animationDelay:`${i*300}ms`}}><span className={`icon-ring mt-0.5 h-[18px] w-[18px] ${c.met?"bg-paid-soft text-paid":"bg-warn-soft text-warn"}`}>{c.met?<Check size={13} strokeWidth={3}/>:<X size={12} strokeWidth={3}/>}</span><div className="min-w-0"><div className="text-[13px] font-medium text-ink">{criterion?.text??`Criterion ${i+1}`}</div><div className="mt-0.5 text-[12px] italic text-muted">“{c.evidence}”</div></div></div>})}</div>
  {blocked&&<div className="mt-4 border-t border-border pt-4"><div className="label mb-3">Evidence conflict</div><div className="grid grid-cols-2 gap-3">{([["checkin","Check-in"],["after","After"]] as const).map(([kind,label])=>{const p=order.proofs.find(x=>x.kind===kind);return <div key={kind}><div className={`mb-2 text-xs font-semibold ${kind==="after"?"text-warn":"text-muted"}`}>{label} · {p?(p.exif_missing?"no EXIF":shortTime(p.exif_ts)):"missing"}</div><div className={`aspect-[5/3] overflow-hidden rounded-lg border ${kind==="after"?"border-[#ECD5AC]":"border-border"}`}>{p?<img src={p.url} className="evidence-img" alt={`${label} photo`}/>:<div className="flex h-full items-center justify-center text-xs text-muted">No photo</div>}</div></div>})}</div>
   {!embedded&&onRedo&&onApprove&&<div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onApprove} disabled={working}>Approve anyway</Button><Button onClick={onRedo} disabled={working}>Request redo</Button></div>}
  </div>}
 </div>
}
