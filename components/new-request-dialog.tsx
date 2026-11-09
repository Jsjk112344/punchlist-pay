"use client";
import {useEffect,useState} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {ArrowRight,Check,LoaderCircle,Plus,X} from "lucide-react";
import {Button} from "./ui/button";
import type {WorkOrder,Criterion} from "@/lib/types";
import {createWorkOrder,negotiate} from "@/lib/api";
import {insertOrder} from "@/lib/store";
import {money,shortTime,fixtureLink} from "@/lib/format";
import {useRouter} from "next/navigation";
const DEFAULT_TEXT="4B kitchen sink leaking under the cabinet, fix today, under $250";
export function NewRequestDialog({fixture}:{fixture:boolean}){
 const router=useRouter();const [open,setOpen]=useState(false);const [text,setText]=useState("");const [phase,setPhase]=useState<"input"|"stream"|"draft"|"inviting">("input");
 const [draft,setDraft]=useState<WorkOrder|null>(null);const [visible,setVisible]=useState(0);const [editing,setEditing]=useState<string|null>(null);const [error,setError]=useState("");
 useEffect(()=>{if(phase!=="stream")return;const interval=window.setInterval(()=>setVisible(v=>Math.min(5,v+1)),220);return()=>window.clearInterval(interval)},[phase]);
 useEffect(()=>{if(phase==="stream"&&visible>=5&&draft)setPhase("draft")},[phase,visible,draft]);
 function clear(){setText("");setPhase("input");setDraft(null);setVisible(0);setEditing(null);setError("")}
 async function handleCreate(){if(!text.trim())return;setError("");setVisible(0);setPhase("stream");try{const {work_order}=await createWorkOrder(text,fixture);setDraft(work_order)}catch(err){setError(err instanceof Error?err.message:"Could not create work order");setPhase("input")}}
 function editCriterion(id:string,value:string){setDraft(old=>old?{...old,criteria:old.criteria.map(c=>c.id===id?{...c,text:value}:c)}:old)}
 async function handleInvite(){if(!draft)return;setPhase("inviting");setError("");try{const {contract,transcript}=await negotiate(draft.id,"mike",fixture);
 const finalCriteria=draft.criteria.map(c=>c.check==="time"?{...c,text:"Completed before 4:00 PM"}:c);
 const agreed:WorkOrder={...draft,criteria:finalCriteria,contract:{...contract,criteria:finalCriteria},negotiation:transcript,contractor_id:"mike",contractor_name:"Mike Torres",contractor_trade:"Plumbing",avatar_tone:0,status:"funded",updated_at:new Date().toISOString()};
 if(fixture)insertOrder(agreed);setOpen(false);clear();router.push(fixtureLink(`/work-orders/${agreed.id}?play=1`,fixture));router.refresh();
 }catch(err){setError(err instanceof Error?err.message:"Could not invite contractor");setPhase("draft")}}
 return <Dialog.Root open={open} onOpenChange={value=>{setOpen(value);if(!value)clear()}}>
 <Dialog.Trigger asChild><Button><Plus size={16} strokeWidth={2.5}/>New request</Button></Dialog.Trigger>
 <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-40 bg-[#101f34]/45"/><Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(580px,calc(100vw-32px))] max-h-[min(90vh,820px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[16px] border border-border bg-white p-6 shadow-sm sm:p-8" aria-describedby={undefined}>
 <div className="mb-5 flex items-center justify-between"><Dialog.Title className="text-[21px] font-bold tracking-[-.035em]">New request</Dialog.Title><Dialog.Close aria-label="Close" className="rounded-md p-1.5 text-muted hover:bg-canvas"><X size={18}/></Dialog.Close></div>
 {phase==="input"?<><textarea aria-label="Work request" autoFocus value={text} onChange={e=>setText(e.target.value)} rows={4} placeholder={DEFAULT_TEXT} className="w-full resize-none rounded-[10px] border border-[#D6DEE8] bg-[#FBFCFE] p-4 text-[15px] leading-relaxed text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"/><div className="mt-5 flex justify-end"><Button disabled={!text.trim()} onClick={handleCreate}>Create work order<ArrowRight size={15}/></Button></div></>:
 <div><div className="mb-4 flex items-center gap-2 text-[12px] font-semibold text-muted">{phase==="stream"||phase==="inviting"?<LoaderCircle size={14} className="animate-spin text-accent"/>:<Check size={14} className="text-paid"/>}{phase==="stream"?"Structuring":phase==="inviting"?"Negotiating":"Ready to invite"}</div>
 <div className="overflow-hidden rounded-[12px] border border-border"><div className="border-b border-border bg-[#FBFCFE] px-5 py-4"><div className="label mb-1">Work order</div><div className="text-[19px] font-bold tracking-tight">{draft&&visible>=1?draft.title:"…"}</div></div>
 <div className="grid grid-cols-3 divide-x divide-border border-b border-border"><div className="px-4 py-4"><div className="label mb-2">Unit</div><div className="text-lg font-semibold">{draft&&visible>=2?draft.unit:"—"}</div></div><div className="px-4 py-4"><div className="label mb-2">Budget</div><div className="amount text-[21px]">{draft&&visible>=2?money(draft.budget_cents):"—"}</div></div><div className="px-4 py-4"><div className="label mb-2">Deadline</div><div className="text-sm font-semibold">{draft&&visible>=3?"Today, 6 PM":"—"}</div></div></div>
 <div className="px-5 py-4"><div className="label mb-3">Acceptance criteria</div><div className="space-y-3">{draft&&visible>=4?draft.criteria.map((c,i)=><label key={c.id} className="flex cursor-text items-start gap-3"><span className="icon-ring mt-[2px] h-[19px] w-[19px] border border-[#CCD6E3] bg-white text-accent"><Check size={11}/></span><input value={c.text} aria-label={`Criterion ${i+1}`} onChange={e=>editCriterion(c.id,e.target.value)} onFocus={()=>setEditing(c.id)} onBlur={()=>setEditing(null)} className={`min-w-0 flex-1 rounded border border-transparent px-1 py-0.5 text-[13px] text-ink outline-none hover:bg-canvas focus:border-[#C3D4FF] focus:bg-accent-soft ${editing===c.id?"bg-accent-soft":""}`}/></label>):[1,2,3].map(i=><div key={i} className="flex items-center gap-3 text-sm text-[#B4BEC9]"><span className="h-[18px] w-[18px] rounded-full border border-border"/>—</div>)}</div></div></div>
 <div className="mt-5 flex justify-between gap-3"><Button variant="ghost" disabled={phase==="inviting"} onClick={()=>{setOpen(false);clear()}}>Discard</Button><Button disabled={!draft||phase!=="draft"} onClick={handleInvite}>{phase==="inviting"?"Inviting…":"Invite contractor"}<ArrowRight size={15}/></Button></div></div>}
 {error&&<div role="alert" className="mt-4 rounded-lg border border-[#F0D5B0] bg-warn-soft px-3 py-2 text-xs font-medium text-warn">{error}</div>}
 </Dialog.Content></Dialog.Portal>
 </Dialog.Root>
}
