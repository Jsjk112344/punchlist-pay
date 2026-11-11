"use client";
import {useEffect,useRef,useState} from "react";
import Link from "next/link";
import {ArrowLeft,Camera,Check,CheckCircle2,ChevronRight,FileText,ImageIcon,LoaderCircle,ShieldCheck,UploadCloud,Wrench} from "lucide-react";
import {useOrders,updateOrder} from "@/lib/store";
import {applyCheckin,applyPass} from "@/lib/demo";
import {getLedger,submitProof,verifyOrder} from "@/lib/api";
import type {WorkOrder,ProofKind} from "@/lib/types";
import {money,agreedCents,shortTime,fixtureLink} from "@/lib/format";
import {StatusPill} from "./status-pill";
import {Button} from "./ui/button";
type Upload={url:string;file?:File;label:string};
function fileDataUrl(file:File):Promise<string>{return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file)})}
/** Fetches a bundled sample photo as a File so the live backend receives a real upload (no EXIF; the Verifier is told). */
async function sampleFile(url:string,name:string){const r=await fetch(url);const b=await r.blob();return new File([b],name,{type:b.type||"image/jpeg"})}
function UploadTarget({label,kind,value,onChange,onUseSample,fixture}:{label:string;kind:"after"|"receipt";value:Upload|null;onChange:(v:Upload)=>void;onUseSample:()=>void;fixture:boolean}){
 const ref=useRef<HTMLInputElement>(null);
 return <div><button type="button" className={`relative flex w-full flex-col overflow-hidden rounded-[12px] border text-left ${value?"border-[#B3D9C3] bg-paid-soft":"border-dashed border-[#C8D5E5] bg-[#F8FAFD]"}`} onClick={()=>ref.current?.click()} aria-label={`Upload ${label}`}>
 {value?<img src={value.url} alt={`${label} preview`} className="aspect-[5/3] w-full object-cover"/>:<div className="flex aspect-[5/3] w-full flex-col items-center justify-center gap-3 text-muted"><span className="icon-ring h-11 w-11 bg-white text-accent">{kind==="receipt"?<FileText size={20}/>:<Camera size={20}/>}</span><span className="text-[13px] font-semibold text-ink">{label}</span></div>}
 <div className="flex w-full items-center justify-between px-3 py-2.5"><span className="text-[12px] font-semibold text-ink">{label}</span>{value?<CheckCircle2 size={16} className="text-paid"/>:<UploadCloud size={16} className="text-muted"/>}</div></button>
 <input ref={ref} type="file" accept={kind==="receipt"?"image/*":"image/*"} capture="environment" className="sr-only" aria-label={`${label} image file`} onChange={async e=>{const file=e.target.files?.[0];if(file){const url=await fileDataUrl(file);onChange({url,file,label:file.name})}}}/>
 {!value&&<button type="button" onClick={onUseSample} className="mt-2 text-[11px] font-semibold text-accent underline-offset-2 hover:underline">Use sample</button>}
 </div>;
}
export function MobileClient({contractorId,fixture,initialJob}:{contractorId:string;fixture:boolean;initialJob?:string}){
 const fixtures=useOrders();const[remoteOrders,setRemoteOrders]=useState<WorkOrder[]>([]);
 const[selectedId,setSelectedId]=useState<string|null>(initialJob??null);const[after,setAfter]=useState<Upload|null>(null);const[receipt,setReceipt]=useState<Upload|null>(null);const[working,setWorking]=useState(false);const[verifying,setVerifying]=useState(false);const[criteriaTick,setCriteriaTick]=useState(0);const[error,setError]=useState("");
 useEffect(()=>{if(fixture)return;let active=true;const poll=async()=>{try{const data=await getLedger(false);if(active){setRemoteOrders(data);setError("")}}catch(e){if(active)setError(e instanceof Error?e.message:"Jobs unavailable")}};void poll();const interval=window.setInterval(poll,3000);return()=>{active=false;clearInterval(interval)}},[fixture]);
 const jobs=(fixture?fixtures:remoteOrders).filter(o=>o.contractor_id===contractorId);
 const selected=jobs.find(o=>o.id===selectedId);
 function openJob(id:string|null){setSelectedId(id);setAfter(null);setReceipt(null);setError("");const params=new URLSearchParams(window.location.search);if(id)params.set("job",id);else params.delete("job");window.history.pushState(null,"",`${window.location.pathname}?${params.toString()}`)}
 async function checkIn(){if(!selected)return;setWorking(true);setError("");try{
 if(fixture){updateOrder(selected.id,applyCheckin)}else{
  // TODO(api): Wire native check-in file capture to POST /api/work-orders/:id/proofs in live mode.
  throw new Error("Check-in requires a camera photo on the live backend")}
 }catch(e){setError(e instanceof Error?e.message:"Check-in failed")}finally{setWorking(false)}}
 async function submit(){if(!selected||!after||!receipt)return;setWorking(true);setError("");try{
 if(fixture){setVerifying(true);setCriteriaTick(0);for(let i=1;i<=3;i++){await new Promise(r=>setTimeout(r,300));setCriteriaTick(i)}await new Promise(r=>setTimeout(r,270));updateOrder(selected.id,o=>applyPass(o,after.url,receipt.url));setAfter(null);setReceipt(null);setVerifying(false)}
 else{
  if(!after.file||!receipt.file)throw new Error("Select image files");setVerifying(true);setCriteriaTick(0);
  await submitProof(selected.id,"receipt",receipt.file,false);await submitProof(selected.id,"after",after.file,false);
  const {verdict}=await verifyOrder(selected.id,false);
  if(verdict.verdict==="fail"||verdict.confidence<0.8){setError("Waiting on property manager")} // Server owns payout; do not mark paid without ledger confirmation.
  const rows=await getLedger(false);setRemoteOrders(rows);
 }
 }catch(e){setError(e instanceof Error?e.message:"Proof submission failed")}finally{setWorking(false);setVerifying(false)}}
 async function liveCheckin(file:File){if(!selected)return;setWorking(true);try{await submitProof(selected.id,"checkin",file,false);setRemoteOrders(await getLedger(false))}catch(e){setError(e instanceof Error?e.message:"Check-in failed")}finally{setWorking(false)}}
 const checkinRef=useRef<HTMLInputElement>(null);
 const paid=selected?.status==="paid";
 const review=selected&&["escalated","under_review","disputed"].includes(selected.status);
 const showUploads=selected&&["in_progress","redo_requested"].includes(selected.status);
 return <div className={`min-h-screen bg-canvas ${selected&&!paid?"mobile-bottom":""}`}><header className="sticky top-0 z-20 border-b border-border bg-white"><div className="mx-auto flex h-[66px] w-full max-w-[480px] items-center justify-between px-5"><button type="button" onClick={()=>openJob(null)} className="flex items-center gap-2 text-[14px] font-semibold text-ink">{selected?<><ArrowLeft size={18}/>Jobs</>:<><span className="icon-ring h-8 w-8 bg-accent text-white"><Wrench size={17}/></span>{contractorId==="mike"?"Mike’s Plumbing":contractorId==="sara"?"Sara’s Cleaning":"Contractor"}</>}</button><span className="text-[12px] font-semibold text-muted">{selected?`Unit ${selected.unit}`:"My jobs"}</span></div></header>
 {!selected?<main className="mx-auto w-full max-w-[480px] px-5 pb-12 pt-7"><h1 className="mb-5 text-[27px] font-bold tracking-[-.045em]">Today&apos;s jobs</h1><div className="space-y-3">{jobs.map(o=><button key={o.id} type="button" onClick={()=>openJob(o.id)} className="panel flex w-full items-center gap-3 p-4 text-left hover:border-[#BACAE8]"><div className="min-w-0 flex-1"><div className="mb-2 text-[11px] font-bold uppercase tracking-[.08em] text-muted">Unit {o.unit}</div><div className="mb-3 truncate text-[16px] font-bold tracking-tight">{o.title}</div><StatusPill status={o.status}/></div><div className="flex flex-col items-end gap-6"><span className={`mono text-[20px] font-bold ${o.status==="paid"?"text-paid":"text-ink"}`}>{money(agreedCents(o))}</span><ChevronRight size={17} className="text-muted"/></div></button>)}</div>{jobs.length===0&&<div className="py-20 text-center text-muted">No jobs</div>}</main>:
 paid?<main className="mx-auto flex min-h-[calc(100vh-66px)] max-w-[480px] flex-col items-center justify-center px-6 pb-24 text-center"><span className="icon-ring mb-7 h-24 w-24 bg-paid-soft text-paid animate-moneyIn"><Check size={50} strokeWidth={2.8}/></span><h1 className="text-[40px] font-bold tracking-[-.06em] text-paid">Paid</h1><div key={agreedCents(selected)} className="amount mt-3 text-[60px] leading-tight text-ink animate-moneyIn">{money(agreedCents(selected))}</div><div className="mt-2 text-[15px] font-semibold text-muted">Sent to your PayPal</div><div className="mt-4 text-[13px] text-muted mono">{shortTime(selected.payouts.at(-1)?.paid_at)}</div><button type="button" onClick={()=>openJob(null)} className="mt-11 text-[13px] font-semibold text-accent">Back to jobs</button></main>:
 <main className="mx-auto w-full max-w-[480px] px-5 pb-5 pt-6"><div className="mb-5 flex items-center justify-between"><div className="text-xs font-semibold text-muted">{selected.property_name} · {selected.unit}</div><StatusPill status={selected.status}/></div><h1 className="text-[28px] font-bold leading-[1.15] tracking-[-.05em]">{selected.title}</h1><div className="amount mt-2 text-[40px]">{money(agreedCents(selected))}</div><div className="mt-4 line-clamp-3 text-[14px] leading-6 text-muted">{selected.description}</div>
 <section className="panel mt-7 p-5"><div className="mb-4 text-[15px] font-bold">Acceptance criteria</div><div className="space-y-4">{selected.criteria.map(c=><div key={c.id} className="flex items-start gap-3"><span className="icon-ring mt-0.5 h-[19px] w-[19px] border border-[#C8D2DE] text-muted"><Check size={11}/></span><div className="text-[13px] leading-5">{c.text}</div></div>)}</div></section>
 {review&&<div className="mt-6 flex items-center gap-3 rounded-xl border border-[#E9D5B4] bg-warn-soft px-4 py-4 text-[13px] font-semibold text-[#805A25]"><ShieldCheck size={18}/>Waiting on property manager</div>}
 {verifying&&<div className="panel mt-6 p-5"><div className="mb-4 flex items-center gap-2 text-[14px] font-bold"><LoaderCircle size={17} className="animate-spin text-accent"/>Verifying</div>{(fixture?["Dry pipes","Receipt $41.07","Before 4 PM"]:selected.criteria.map(c=>c.text)).map((v,i)=><div key={v} className="flex items-center gap-3 border-t border-border py-3 text-sm"><span className={`icon-ring h-5 w-5 shrink-0 ${criteriaTick>=i+1?"bg-paid-soft text-paid":"border border-border text-muted"}`}>{criteriaTick>=i+1?<Check size={13}/>:""}</span>{v}</div>)}</div>}
 {showUploads&&!verifying&&<section className="mt-7"><h2 className="mb-4 text-[15px] font-bold">Submit proof</h2><div className="grid grid-cols-2 gap-3"><UploadTarget kind="after" label="After photo" value={after} onChange={setAfter} fixture={fixture} onUseSample={()=>fixture?setAfter({url:"/fixtures/sink-after.jpg",label:"Fixture after"}):void sampleFile("/fixtures/sink-after.jpg","sink-after.jpg").then(file=>setAfter({url:"/fixtures/sink-after.jpg",file,label:"Sample after"}))}/><UploadTarget kind="receipt" label="Receipt" value={receipt} onChange={setReceipt} fixture={fixture} onUseSample={()=>fixture?setReceipt({url:"/fixtures/receipt.svg",label:"Fixture receipt"}):void sampleFile("/fixtures/receipt.png","receipt.png").then(file=>setReceipt({url:"/fixtures/receipt.png",file,label:"Sample receipt"}))}/></div></section>}
 {error&&<div role="alert" className="mt-5 rounded-lg border border-[#F0D7B2] bg-warn-soft p-3 text-[12px] text-warn">{error}</div>}
 </main>}
 {selected&&!paid&&!review&&<div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-white p-4 pb-[max(16px,env(safe-area-inset-bottom))]"><div className="mx-auto max-w-[440px]">{selected.status==="funded"?<><input type="file" capture="environment" accept="image/*" ref={checkinRef} className="sr-only" aria-label="Check-in photo" onChange={e=>{const f=e.target.files?.[0];if(f)void liveCheckin(f)}}/><Button size="lg" className="w-full" disabled={working} onClick={()=>fixture?void checkIn():checkinRef.current?.click()}>{working?<LoaderCircle size={17} className="animate-spin"/>:<Camera size={18}/>}Check in</Button>{!fixture&&<button type="button" disabled={working} onClick={()=>void sampleFile("/fixtures/sink-before.jpg","sink-before.jpg").then(liveCheckin)} className="mt-2 w-full text-center text-[12px] font-semibold text-accent underline-offset-2 hover:underline">Use sample check-in photo</button>}</>:<Button size="lg" className="w-full" disabled={!after||!receipt||working||verifying} onClick={()=>void submit()}>{working||verifying?<LoaderCircle size={17} className="animate-spin"/>:<Check size={18}/>}Submit proof</Button>}</div></div>}
 </div>;
}
