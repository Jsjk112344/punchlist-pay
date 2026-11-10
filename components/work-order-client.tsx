"use client";
import {useCallback,useEffect,useMemo,useState} from "react";
import Link from "next/link";
import {ArrowLeft,ArrowUpRight,Check,ChevronDown,ChevronRight,Clock3,FileCheck2,LockKeyhole,WalletCards,X} from "lucide-react";
import {useOrders,updateOrder} from "@/lib/store";
import {getLedger,decide,createPayout} from "@/lib/api";
import {demoPayout} from "@/lib/demo";
import type {WorkOrder,TranscriptTurn} from "@/lib/types";
import {MoneyRail} from "./money-rail";
import {StatusPill} from "./status-pill";
import {ProofStrip} from "./proof-strip";
import {VerdictCard} from "./verdict-card";
import {PayoutTimeline} from "./payout-timeline";
import {FundButton} from "./fund-button";
import {Button} from "./ui/button";
import {agreedCents,money,paidCents,fixtureLink,shortTime} from "@/lib/format";
function StorySection({title,summary,children,initialOpen=false}:{title:string;summary?:string;children:React.ReactNode;initialOpen?:boolean}){
 const [open,setOpen]=useState(initialOpen);
 return <section className="panel overflow-hidden"><button type="button" aria-expanded={open} onClick={()=>setOpen(!open)} className={`flex w-full items-center justify-between gap-4 px-5 text-left sm:px-6 ${open?"py-4":"py-4"}`}><div className="flex min-w-0 items-center gap-3"><span className="text-[15px] font-bold tracking-[-.02em]">{title}</span>{!open&&summary&&<span className="truncate text-[12px] font-medium text-muted">{summary}</span>}</div>{open?<ChevronDown size={17} className="shrink-0 text-muted"/>:<ChevronRight size={17} className="shrink-0 text-muted"/>}</button>{open&&<div className="border-t border-border px-5 py-5 sm:px-6">{children}</div>}</section>;
}
function Thread({turns,replay}:{turns:TranscriptTurn[];replay:boolean}){
 const [visible,setVisible]=useState(replay?0:turns.length);
 useEffect(()=>{if(!replay)return;setVisible(0);let count=0;const interval=window.setInterval(()=>{count+=1;setVisible(count);if(count>=turns.length)clearInterval(interval)},360);return()=>clearInterval(interval)},[replay,turns.length]);
 return <div className="space-y-3">{turns.slice(0,visible).map(t=>t.role==="system"?<div key={t.id} className="flex items-center justify-center gap-2 py-2 text-[12px] font-semibold text-muted"><WalletCards size={15} className="text-accent"/>{t.text}{t.offer_cents&&!t.text.includes(money(t.offer_cents))?` · ${money(t.offer_cents)}`:""}</div>:<div key={t.id} className={`flex ${t.role==="contractor"?"justify-end":"justify-start"}`}><div className={`max-w-[79%] rounded-[12px] px-4 py-3 text-[13px] leading-relaxed ${t.role==="dispatcher"?"rounded-tl-[3px] bg-accent-soft text-[#24476F]":"rounded-tr-[3px] bg-[#F1F3F6] text-ink"}`}><div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider opacity-60">{t.role==="dispatcher"?"Dispatcher":"Contractor agent"}</div><div>{t.text}</div>{t.offer_cents&&<div className="mt-2 inline-flex rounded-md border border-current/10 bg-white/85 px-2.5 py-1 font-semibold mono text-[14px]">{money(t.offer_cents)}</div>}</div></div>)}</div>
}
export function WorkOrderClient({id,fixture,play}:{id:string;fixture:boolean;play:boolean}){
 const fixtureOrders=useOrders();const[remoteOrders,setRemoteOrders]=useState<WorkOrder[]>([]);const[error,setError]=useState("");const[working,setWorking]=useState(false);
 useEffect(()=>{if(fixture)return;let active=true;const poll=async()=>{try{const rows=await getLedger(false);if(active)setRemoteOrders(rows)}catch(e){if(active)setError(e instanceof Error?e.message:"Could not load work order")}};void poll();const timer=setInterval(poll,3000);return()=>{active=false;clearInterval(timer)}},[fixture]);
 const refresh=useCallback(async()=>{try{setRemoteOrders(await getLedger(false))}catch{}},[]);
 const order=(fixture?fixtureOrders:remoteOrders).find(x=>x.id===id);
 const phase=order?.status==="paid"?4:order?.status==="escalated"||order?.status==="under_review"||order?.status==="disputed"?3:order?.status==="in_progress"||order?.status==="redo_requested"?2:1;
 async function decision(action:"approve"|"redo"){if(!order)return;setWorking(true);setError("");try{await decide(order.id,action,fixture);
 if(fixture){updateOrder(order.id,old=>action==="redo"?{...old,status:"redo_requested",verdict:undefined,proofs:old.proofs.filter(p=>p.kind==="checkin"),updated_at:new Date().toISOString()}:{...old,status:"paid",updated_at:new Date().toISOString(),payouts:[...old.payouts,demoPayout(old,"balance",agreedCents(old)-paidCents(old))]});}
 else{const rows=await getLedger(false);setRemoteOrders(rows)}
 }catch(e){setError(e instanceof Error?e.message:"Could not update decision")}finally{setWorking(false)}}
 if(!order)return <main className="shell pt-10"><Link href={fixtureLink("/dashboard",fixture)} className="text-accent">← Back to ledger</Link><div className="mt-12 text-sm text-muted">{error||"Work order not found"}</div></main>;
 return <div className="min-h-screen pb-14"><header className="border-b border-border bg-white"><div className="shell flex h-[69px] items-center justify-between"><Link className="flex items-center gap-2 text-[13px] font-semibold text-muted hover:text-ink" href={fixtureLink("/dashboard",fixture)}><ArrowLeft size={15}/>Ledger</Link><div className="flex items-center gap-3"><span className="hidden text-[12px] text-muted mono sm:inline">{order.id}</span><StatusPill status={order.status}/></div></div></header>
 <main className="shell pt-8"><div className="mb-7 flex items-start justify-between gap-4"><div><div className="mb-1 text-[12px] font-semibold text-muted">{order.property_name} <span className="px-1.5">/</span> Unit {order.unit}</div><h1 className="text-[30px] font-bold tracking-[-.055em] sm:text-[34px]">{order.title}</h1></div>{phase<=2&&order.contractor_id&&<Link href={fixtureLink(`/m/${order.contractor_id}?job=${order.id}`,fixture)} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-accent hover:bg-accent-soft">Contractor view <ArrowUpRight size={14}/></Link>}</div>
 {error&&<div role="alert" className="mb-5 rounded-lg border border-[#F1D4AC] bg-warn-soft px-4 py-2 text-sm text-warn">{error}</div>}
 <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]"><div className="min-w-0 space-y-4">
 <StorySection key={`${order.id}-scope-${phase}`} title="Scope" summary={`Unit ${order.unit} · ${order.criteria.length} criteria`}><div className="mb-5 text-[13px] text-ink">{order.description}</div><div className="space-y-3">{order.criteria.map((c,i)=><div key={c.id} className="flex gap-3 text-[13px]"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#CED8E6] text-[10px] font-semibold text-muted">{i+1}</span>{c.text}</div>)}</div></StorySection>
 <StorySection key={`${order.id}-neg-${phase}`} title="Negotiation" summary={`Agreed ${money(agreedCents(order))} · deposit ${order.contract?.deposit_pct??0}% · by 4:00 PM`} initialOpen={phase===1}><Thread turns={order.negotiation} replay={play&&phase===1}/><div className="mt-5 rounded-[10px] border border-[#D5E0F3] bg-[#F7F9FE] p-4"><div className="label mb-3">Agreement</div><div className="grid grid-cols-3 gap-3"><div><div className="label mb-1">Agreed</div><div className="amount text-[23px]">{money(agreedCents(order))}</div></div><div><div className="label mb-1">Deposit</div><div className="text-[17px] font-semibold">{order.contract?.deposit_pct??0}%</div></div><div><div className="label mb-1">Due</div><div className="text-[17px] font-semibold">{order.contract?.deadline?shortTime(order.contract.deadline):"—"}</div></div></div><div className="mt-4 space-y-2 border-t border-[#D5E0F3] pt-3">{order.criteria.map(c=><div key={c.id} className="flex items-center gap-2 text-[12px] text-[#526277]"><Check size={12} className="text-accent"/>{c.text}</div>)}</div></div></StorySection>
 <StorySection key={`${order.id}-proof-${phase}`} title="Proof" summary={`${order.proofs.length} ${order.proofs.length===1?"upload":"uploads"}`} initialOpen={phase>=2&&phase<=3}><ProofStrip proofs={order.proofs}/></StorySection>
 {order.verdict&&<section><div className="mb-3 flex items-center justify-between px-1"><h2 className="text-[15px] font-bold tracking-tight">Verdict</h2><div className="text-[12px] font-semibold text-muted">Evidence + decision</div></div><div className="grid gap-4 xl:grid-cols-[minmax(0,.9fr)_minmax(0,1.15fr)]"><div className="panel p-4"><div className="label mb-4">Submitted proof</div><div className="grid grid-cols-2 gap-3">{order.proofs.filter(p=>p.kind!=="checkin").map(p=><div key={p.id} className="min-w-0"><div className="mb-1.5 text-[11px] font-semibold capitalize text-muted">{p.kind}</div><img src={p.url} alt={`${p.kind} proof`} className="aspect-[4/3] w-full rounded-lg border border-border object-cover"/></div>)}</div></div><VerdictCard order={order} onApprove={()=>void decision("approve")} onRedo={()=>void decision("redo")} working={working}/></div></section>}
 {order.payouts.length>0&&<StorySection key={`${order.id}-payout-${phase}`} title="Payouts" summary={`${money(paidCents(order))} paid`} initialOpen={phase>=4}><PayoutTimeline order={order}/></StorySection>}
 {!fixture&&order.status==="negotiating"&&order.contract?.paypal_order_id&&!order.contract.paypal_auth_id&&<FundButton order={order} onFunded={refresh}/>}
 {phase===1&&order.status!=="negotiating"&&order.status!=="draft"&&<div className="panel flex items-center gap-3 px-5 py-4 text-[13px] text-muted"><Clock3 size={18}/>Waiting for contractor check-in</div>}
 {phase===2&&<div className="panel flex items-center gap-3 px-5 py-4 text-[13px] text-muted"><FileCheck2 size={18}/>Waiting for proof</div>}
 {phase===3&&!order.verdict&&<div className="panel flex items-center gap-3 px-5 py-4 text-[13px] text-muted"><Clock3 size={18}/>Verification pending</div>}
 </div><MoneyRail order={order}/></div></main></div>;
}
