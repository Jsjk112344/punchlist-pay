"use client";
// PM funding step: the PayPal JS SDK button approves the order the Dispatcher agent created (intent=authorize),
// then the server authorizes it. If the SDK can't load, the approve link opens PayPal and the 3s ledger poll settles it.
import {useEffect,useRef,useState} from "react";
import {ExternalLink,LoaderCircle,LockKeyhole} from "lucide-react";
import type {WorkOrder} from "@/lib/types";
import {money} from "@/lib/format";

const CLIENT_ID=process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID??"";
type PayPalButtons={render:(el:HTMLElement)=>Promise<void>;close?:()=>Promise<void>};
type PayPalNamespace={Buttons:(opts:{style?:Record<string,unknown>;createOrder:()=>Promise<string>;onApprove:(data:{orderID:string})=>Promise<void>;onError:(err:unknown)=>void;onCancel?:()=>void})=>PayPalButtons};
declare global{interface Window{paypal?:PayPalNamespace}}

let sdkPromise:Promise<PayPalNamespace>|null=null;
function loadSdk():Promise<PayPalNamespace>{
 if(window.paypal)return Promise.resolve(window.paypal);
 if(!sdkPromise)sdkPromise=new Promise((resolve,reject)=>{const s=document.createElement("script");
  s.src=`https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(CLIENT_ID)}&intent=authorize&currency=USD&components=buttons`;
  s.async=true;s.onload=()=>window.paypal?resolve(window.paypal):reject(new Error("PayPal SDK unavailable"));s.onerror=()=>{sdkPromise=null;reject(new Error("PayPal SDK failed to load"))};document.head.appendChild(s)});
 return sdkPromise;
}

export function FundButton({order,onFunded}:{order:WorkOrder;onFunded:()=>void}){
 const ref=useRef<HTMLDivElement>(null);const[state,setState]=useState<"loading"|"ready"|"confirming"|"fallback">(CLIENT_ID?"loading":"fallback");const[error,setError]=useState("");
 const orderId=order.contract?.paypal_order_id;const approveUrl=order.contract?.approve_url;
 useEffect(()=>{if(!CLIENT_ID||!orderId||!ref.current)return;let buttons:PayPalButtons|null=null;let active=true;
  loadSdk().then(paypal=>{if(!active||!ref.current)return;
   buttons=paypal.Buttons({style:{layout:"horizontal",color:"blue",shape:"rect",label:"pay",height:44,tagline:false},
    createOrder:async()=>orderId,
    onApprove:async({orderID})=>{setState("confirming");setError("");
     const res=await fetch(`/api/work-orders/${encodeURIComponent(order.id)}/fund/confirm`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({paypal_order_id:orderID})});
     if(!res.ok){const b=await res.json().catch(()=>({}));setError(b.error??`Funding failed (${res.status})`);setState("ready");return}
     onFunded()},
    onError:err=>{setError(err instanceof Error?err.message:"PayPal error");setState("ready")},
    onCancel:()=>setState("ready")});
   return buttons.render(ref.current).then(()=>{if(active)setState("ready")});
  }).catch(e=>{if(active){setError(e instanceof Error?e.message:"PayPal unavailable");setState("fallback")}});
  return()=>{active=false;void buttons?.close?.().catch(()=>{})}},[orderId,order.id,onFunded]);
 if(!orderId)return null;
 return <section className="panel p-5 sm:p-6"><div className="mb-3 flex items-center justify-between gap-4"><div><div className="label mb-1">Fund work order</div><div className="text-[15px] font-bold tracking-tight">Approve {money(order.contract?.price_cents??order.budget_cents)} with PayPal</div></div><LockKeyhole size={18} className="shrink-0 text-accent"/></div>
 <p className="mb-4 text-[13px] text-muted">Funds are authorized and held, not captured. They are captured only when the Verifier passes the proof or you approve it.</p>
 {state!=="fallback"&&<div ref={ref} className={state==="confirming"?"pointer-events-none opacity-50":""}/>}
 {state==="loading"&&<div className="flex items-center gap-2 text-[12px] text-muted"><LoaderCircle size={14} className="animate-spin"/>Loading PayPal</div>}
 {state==="confirming"&&<div className="mt-2 flex items-center gap-2 text-[12px] text-muted"><LoaderCircle size={14} className="animate-spin"/>Authorizing</div>}
 {state==="fallback"&&approveUrl&&<a href={approveUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-[13px] font-semibold text-white hover:opacity-90">Approve in PayPal<ExternalLink size={14}/></a>}
 {state==="fallback"&&<div className="mt-2 text-[11px] text-muted">This page updates on its own once PayPal confirms the approval.</div>}
 {error&&<div role="alert" className="mt-3 rounded-lg border border-[#F1D4AC] bg-warn-soft px-3 py-2 text-[12px] text-warn">{error}</div>}
 </section>;
}
