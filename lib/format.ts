import type {WorkOrder,WorkOrderStatus} from "./types";
export function money(cents:number) {return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",minimumFractionDigits:2,maximumFractionDigits:2}).format(cents/100)}
export function compactMoney(cents:number) {return `$${Math.round(cents/100).toLocaleString("en-US")}`}
export function shortTime(iso?:string) {if(!iso)return "—"; return new Date(iso).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})}
export function shortDate(iso?:string) {if(!iso)return "—";return new Date(iso).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}
export function paidCents(o:WorkOrder){return o.payouts.filter(p=>p.status==="paid").reduce((n,p)=>n+p.amount_cents,0)}
export function agreedCents(o:WorkOrder){return o.contract?.price_cents??o.budget_cents}
export function heldCents(o:WorkOrder){return Math.max(0,agreedCents(o)-paidCents(o))}
export function labelForStatus(s:WorkOrderStatus){if(s==="paid")return "Paid";if(s==="funded")return "Funded";if(s==="in_progress")return "In progress";if(["under_review","escalated","disputed"].includes(s))return "Needs review"; if(s==="redo_requested")return "In progress";return "In progress"}
export function fixtureLink(path:string,fixture:boolean){return `${path}${path.includes("?")?"&":"?"}fixture=${fixture?"1":"0"}`}
