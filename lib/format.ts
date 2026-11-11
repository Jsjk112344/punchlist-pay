import type {WorkOrder,WorkOrderStatus} from "./types";
export function money(cents:number) {return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",minimumFractionDigits:2,maximumFractionDigits:2}).format(cents/100)}
export function compactMoney(cents:number) {return `$${Math.round(cents/100).toLocaleString("en-US")}`}
export function shortTime(iso?:string) {if(!iso)return "—"; return new Date(iso).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})}
export function shortDate(iso?:string) {if(!iso)return "—";return new Date(iso).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}
export function paidCents(o:WorkOrder){return o.payouts.filter(p=>p.status==="paid").reduce((n,p)=>n+p.amount_cents,0)}
export function agreedCents(o:WorkOrder){return o.contract?.price_cents??o.budget_cents}
export function heldCents(o:WorkOrder){return Math.max(0,agreedCents(o)-paidCents(o))}
export function labelForStatus(s:WorkOrderStatus){if(s==="paid")return "Paid";if(s==="funded")return "Funded";if(s==="in_progress")return "In progress";if(["under_review","escalated","disputed"].includes(s))return "Needs review"; if(s==="redo_requested")return "In progress";if(s==="negotiating")return "Awaiting funding";if(s==="draft")return "Draft";return "In progress"}
export function fixtureLink(path:string,fixture:boolean){return `${path}${path.includes("?")?"&":"?"}fixture=${fixture?"1":"0"}`}
/** Seconds from the after photo being uploaded to the balance payout confirmed by PayPal; null until paid. */
export function proofToPaySeconds(o:WorkOrder):number|null{const after=o.proofs.find(p=>p.kind==="after");const paid=o.payouts.filter(p=>p.kind!=="deposit"&&p.status==="paid"&&p.paid_at).map(p=>Date.parse(p.paid_at!)).sort().pop();if(!after||!paid)return null;const s=(paid-Date.parse(after.uploaded_at))/1000;return s>=0?s:null}
export function shortDuration(s:number|null){if(s===null)return "—";return s<120?`${Math.round(s)}s`:`${(s/60).toFixed(1)} min`}
