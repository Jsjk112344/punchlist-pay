"use client";
import {useEffect,useState} from "react";
import {AlertTriangle,CheckCircle2,Clock3,ChevronDown,RotateCcw} from "lucide-react";
import {useOrders,resetDemo} from "@/lib/store";
import {getLedger} from "@/lib/api";
import {properties} from "@/lib/fixtures";
import type {WorkOrder} from "@/lib/types";
import {money,paidCents,fixtureLink} from "@/lib/format";
import {NewRequestDialog} from "./new-request-dialog";
import {LedgerGrid} from "./ledger-grid";
import Link from "next/link";
export function DashboardClient({fixture}:{fixture:boolean}){
 const fixtureOrders=useOrders();const[remoteOrders,setRemoteOrders]=useState<WorkOrder[]|null>(null);const[remoteError,setRemoteError]=useState("");const [property,setProperty]=useState("all");const [filter,setFilter]=useState<"all"|"active"|"review"|"paid">("all");
 useEffect(()=>{if(fixture)return;let active=true;const poll=async()=>{try{const data=await getLedger(false);if(active){setRemoteOrders(data);setRemoteError("")}}catch(e){if(active)setRemoteError(e instanceof Error?e.message:"Ledger unavailable")}};void poll();const timer=window.setInterval(poll,3000);return()=>{active=false;clearInterval(timer)}},[fixture]);
 const orders=(fixture?fixtureOrders:remoteOrders??[]).filter(o=>property==="all"||o.property_id===property);
 const totalPaid=orders.filter(o=>o.status==="paid").reduce((n,o)=>n+paidCents(o),0);
 const review=orders.filter(o=>["escalated","under_review","disputed"].includes(o.status)).length;
 return <div className="min-h-screen pb-14"><header className="border-b border-border bg-white"><div className="shell flex h-[76px] items-center justify-between gap-4"><div className="flex items-center gap-7"><Link href={fixtureLink("/",fixture)} aria-label="Punchlist Pay home" className="flex items-center gap-2.5 font-bold tracking-[-.04em] text-ink"><span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-accent text-white"><CheckCircle2 size={19} strokeWidth={2.5}/></span><span className="hidden text-[17px] sm:block">Punchlist Pay</span></Link><div className="relative"><select aria-label="Property" value={property} onChange={e=>setProperty(e.target.value)} className="h-10 appearance-none rounded-[9px] border border-border bg-white py-2 pl-3 pr-8 text-[13px] font-semibold text-ink outline-none focus:border-accent">{properties.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><ChevronDown size={14} className="pointer-events-none absolute right-3 top-[13px] text-muted"/></div></div><NewRequestDialog fixture={fixture}/></div></header>
 <main className="shell pt-9"><div className="mb-7 flex items-baseline justify-between"><div><div className="text-[12px] font-semibold text-muted">Monday, November 9</div><h1 className="mt-1 text-[30px] font-bold tracking-[-.06em]">Work orders</h1></div>{fixture&&<button type="button" onClick={resetDemo} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] text-muted hover:bg-white" title="Reset fixture data"><RotateCcw size={13}/>Reset demo</button>}</div>
 <div className="grid grid-cols-1 gap-4 sm:grid-cols-3"><div className="panel flex min-h-[136px] flex-col justify-between p-5"><div className="flex items-center justify-between"><div className="text-[13px] font-semibold text-muted">Paid this week</div><CheckCircle2 size={17} className="text-paid"/></div><div className="amount text-[34px] text-paid">{money(totalPaid)}</div></div><div className="panel flex min-h-[136px] flex-col justify-between p-5"><div className="flex items-center justify-between"><div className="text-[13px] font-semibold text-muted">Avg. verify → pay</div><Clock3 size={17} className="text-muted"/></div><div className="amount text-[34px] text-ink">{fixture?<>74<span className="ml-1 text-[21px] text-muted">s</span></>:"—"}{/* TODO(api): derive live verify→pay timing from events table. */}</div></div><button type="button" onClick={()=>setFilter("review")} className="panel flex min-h-[136px] flex-col justify-between p-5 text-left hover:border-[#DEBA82] focus-visible:outline-accent"><div className="flex w-full items-center justify-between"><div className="text-[13px] font-semibold text-muted">Needs review</div><AlertTriangle size={17} className={review?"text-warn":"text-muted"}/></div><div className={`amount text-[34px] ${review?"text-warn":"text-ink"}`}>{review}</div></button></div>
 {remoteError&&<div role="alert" className="mt-5 rounded-lg border border-[#F0D5B0] bg-warn-soft px-4 py-3 text-[13px] text-warn">{remoteError}</div>}
 <LedgerGrid orders={orders} filter={filter} setFilter={setFilter} fixture={fixture}/>
 </main></div>;
}
