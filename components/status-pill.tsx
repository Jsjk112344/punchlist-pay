import {Check,Clock3,CircleDollarSign,AlertTriangle} from "lucide-react";
import type {WorkOrderStatus} from "@/lib/types";
import {labelForStatus} from "@/lib/format";
export function StatusPill({status}:{status:WorkOrderStatus}){
 const text=labelForStatus(status);
 const kind=text==="Paid"?"paid":text==="Needs review"?"warn":text==="Funded"?"funded":"progress";
 const Icon=kind==="paid"?Check:kind==="warn"?AlertTriangle:kind==="funded"?CircleDollarSign:Clock3;
 return <span className={`inline-flex min-h-[26px] items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${kind==="paid"?"bg-paid-soft text-paid":kind==="warn"?"bg-warn-soft text-warn":kind==="funded"?"bg-accent-soft text-accent":"bg-[#F1F4F8] text-[#526277]"}`}><Icon size={12} strokeWidth={2.7}/>{text}</span>
}
