"use client";
import {useState} from "react";
import {ImageIcon, X,CheckCircle2} from "lucide-react";
import type {Proof,ProofKind} from "@/lib/types";
import {shortTime} from "@/lib/format";
const kinds:ProofKind[]=["checkin","after","receipt"];
const nice:{[K in ProofKind]:string}={checkin:"Check-in",after:"After",receipt:"Receipt"};
export function ProofStrip({proofs,compact=false}:{proofs:Proof[];compact?:boolean}){
 const [open,setOpen]=useState<Proof|null>(null);
 return <><div className={`grid ${compact?"grid-cols-3 gap-3":"grid-cols-3 gap-4"}`}>
 {kinds.map(k=>{const p=proofs.find(x=>x.kind===k);return <div key={k} className="min-w-0">
  <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-ink">{p?<CheckCircle2 size={13} className="text-paid"/>:<ImageIcon size={13} className="text-muted"/>}{nice[k]}</div>
  {p?<button type="button" aria-label={`Open ${nice[k]} proof`} className="block aspect-[4/3] w-full overflow-hidden rounded-[10px] border border-border bg-[#E7EAE9] focus-visible:outline-accent" onClick={()=>setOpen(p)}><img className="evidence-img" src={p.url} alt={`${nice[k]} evidence`}/></button>:<div className="flex aspect-[4/3] items-center justify-center rounded-[10px] border border-dashed border-border bg-[#f7f8fa]"><ImageIcon size={18} className="text-[#A9B3C0]"/></div>}
  <div className="mt-1.5 truncate text-[11px] text-muted mono">{p?shortTime(p.exif_ts):"—"}</div>
 </div>})}</div>
 {open&&<div role="dialog" aria-modal="true" aria-label="Evidence image" className="fixed inset-0 z-[70] flex items-center justify-center bg-[#172336]/85 p-5" onClick={()=>setOpen(null)}>
  <button type="button" aria-label="Close image" className="absolute right-6 top-6 flex h-10 w-10 items-center justify-center rounded-full bg-white text-ink" onClick={()=>setOpen(null)}><X size={20}/></button>
  <img src={open.url} alt={`${nice[open.kind]} evidence enlarged`} className="max-h-[80vh] max-w-[90vw] rounded-lg object-contain" onClick={e=>e.stopPropagation()}/>
  <span className="absolute bottom-5 text-xs text-white mono">{nice[open.kind]} · {shortTime(open.exif_ts)}</span>
 </div>}</>;
}
