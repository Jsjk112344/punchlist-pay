"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import {AgGridReact} from "ag-grid-react";
import {AllCommunityModule,ModuleRegistry,themeQuartz} from "ag-grid-community";
import type {ColDef,GridApi,GetRowIdParams,RowClickedEvent} from "ag-grid-community";
import {ChevronDown,ChevronRight,Check,X,Download,Layers3,Search} from "lucide-react";
import {Button} from "./ui/button";
import {Avatar} from "./avatar";
import {StatusPill} from "./status-pill";
import {ProofStrip} from "./proof-strip";
import {PayoutTimeline} from "./payout-timeline";
import type {WorkOrder} from "@/lib/types";
import {agreedCents,heldCents,money,paidCents,shortDate,fixtureLink,proofToPaySeconds,shortDuration} from "@/lib/format";
import {useRouter} from "next/navigation";
import Link from "next/link";
ModuleRegistry.registerModules([AllCommunityModule]);
const quartz=themeQuartz.withParams({fontFamily:"Inter, Geist, system-ui, sans-serif",fontSize:13,rowHeight:56,headerHeight:48,spacing:8,accentColor:"#2259D5",borderColor:"#E5EAF0",headerBackgroundColor:"#FBFCFE",backgroundColor:"#FFFFFF",foregroundColor:"#172336",rowHoverColor:"#F6F8FD",valueChangeValueHighlightBackgroundColor:"rgba(22,128,76,.24)"});
type Totals={count:number;agreed:number;held:number;paid:number;avg:number|null};
type GridRow={key:string;kind:"item"|"detail"|"group"|"total";order?:WorkOrder;groupId?:string;groupName?:string;count?:number;collapsed?:boolean;members?:WorkOrder[];totals?:Totals};
const searchText=(o:WorkOrder)=>`${o.unit} ${o.title} ${o.contractor_name??""} ${o.property_name} ${o.status}`;
/** After-photo thumbnail plus the Verifier's verdict and confidence: the evidence behind the row's money. */
function ProofCell({order}:{order:WorkOrder}){const after=order.proofs.find(p=>p.kind==="after");const v=order.verdict;const override=v&&v.verdict!=="pass"&&order.status==="paid";
 const tone=!v?"bg-[#C8D2DE]":override?"bg-accent":v.verdict==="pass"?"bg-paid":"bg-[#C58A27]";
 return <div className="flex items-center gap-2.5">{after?<img src={after.url} alt="" className="h-8 w-11 shrink-0 rounded-md border border-border object-cover"/>:<span className="h-8 w-11 shrink-0 rounded-md border border-dashed border-[#D5DDE7]"/>}
 {v?<div className="w-[74px]"><div className="flex items-baseline justify-between text-[10px] font-bold uppercase tracking-[.06em] text-muted"><span>{override?"PM ok":v.verdict}</span><span className="mono">{Math.round(v.confidence*100)}%</span></div><div className="mt-1 h-1 overflow-hidden rounded-full bg-[#E6EAF0]"><div className={`h-full rounded-full ${tone}`} style={{width:`${Math.round(v.confidence*100)}%`}}/></div></div>:<span className="text-[11px] text-muted">{after?"Verifying":"No proof"}</span>}</div>}
function DetailRow({order,fixture}:{order:WorkOrder;fixture:boolean}){return <div className="grid gap-6 px-6 py-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]"><div><div className="mb-3 flex items-center justify-between"><div className="label">Proof</div><Link href={fixtureLink(`/work-orders/${order.id}`,fixture)} className="text-[12px] font-semibold text-accent hover:underline">Open work order ↗</Link></div><ProofStrip proofs={order.proofs} compact/></div><div className="min-w-0"><div className="label mb-3">Verifier</div>{order.verdict?<div className="space-y-2">{order.verdict.criteria.map(c=><div key={c.id} className="flex gap-2 text-[12px]"><span className={c.met?"text-paid":"text-warn"}>{c.met?<Check size={14}/>:<X size={14}/>}</span><span className="min-w-0"><strong className="font-semibold">{order.criteria.find(x=>x.id===c.id)?.text??c.id}</strong><span className="ml-2 italic text-muted">“{c.evidence}”</span></span></div>)}</div>:<div className="text-xs text-muted">Awaiting proof</div>}
 <div className="mt-4 border-t border-border pt-3"><div className="label mb-2">Payouts</div><PayoutTimeline order={order} compact/></div></div></div>}
export function LedgerGrid({orders,filter,setFilter,fixture}:{orders:WorkOrder[];filter:"all"|"active"|"review"|"paid";setFilter:(s:"all"|"active"|"review"|"paid")=>void;fixture:boolean}){
 const router=useRouter();const grid=useRef<AgGridReact<GridRow>>(null);const previous=useRef(new Map<string,string>());
 const [expanded,setExpanded]=useState<string|null>(null);const [search,setSearch]=useState("");const [groupMode,setGroupMode]=useState(false);const [closedGroups,setClosedGroups]=useState<string[]>([]);
 const filtered=useMemo(()=>orders.filter(o=>filter==="all"||filter==="paid"&&o.status==="paid"||filter==="review"&&["escalated","under_review","disputed"].includes(o.status)||filter==="active"&&!["paid","escalated","under_review","disputed"].includes(o.status)),[orders,filter]);
 const rows=useMemo(()=>{
  const arr:GridRow[]=[];
  const add=(o:WorkOrder)=>{arr.push({kind:"item",key:o.id,order:o});if(expanded===o.id)arr.push({kind:"detail",key:`detail-${o.id}`,order:o})};
  if(!groupMode)filtered.forEach(add);else{
   const groups=new Map<string,{name:string;orders:WorkOrder[]}>();for(const o of filtered){if(!groups.has(o.property_id))groups.set(o.property_id,{name:o.property_name,orders:[]});groups.get(o.property_id)!.orders.push(o)}
   for(const[id,g]of groups){arr.push({kind:"group",key:`group-${id}`,groupId:id,groupName:g.name,count:g.orders.length,collapsed:closedGroups.includes(id),members:g.orders});if(!closedGroups.includes(id))g.orders.forEach(add)}
  }return arr;
 },[filtered,expanded,groupMode,closedGroups]);
 const totals=useMemo<GridRow[]>(()=>{
  // Same matching as AG Grid's quick filter (every word must appear), so the pinned totals follow the search.
  const words=search.toLowerCase().split(/\s+/).filter(Boolean);
  const shown=filtered.filter(o=>{const t=searchText(o).toLowerCase();return words.every(w=>t.includes(w))});
  const gaps=shown.map(proofToPaySeconds).filter((v):v is number=>v!==null);
  return [{kind:"total",key:"total",totals:{count:shown.length,agreed:shown.reduce((n,o)=>n+(o.contract?agreedCents(o):0),0),held:shown.reduce((n,o)=>n+(o.contract?.paypal_auth_id?heldCents(o):0),0),paid:shown.reduce((n,o)=>n+paidCents(o),0),avg:gaps.length?gaps.reduce((a,b)=>a+b,0)/gaps.length:null}}]},[filtered,search]);
 const columns=useMemo<ColDef<GridRow>[]>(()=>[
  {field:"key",headerName:"Unit",width:100,flex:0.6,minWidth:84,cellRenderer:(p:{data?:GridRow})=>p.data?.kind==="total"?<span className="label">Total</span>:p.data?.order?<div className="flex items-center gap-1.5 font-semibold"><span className="text-ink">{p.data.order.unit}</span>{expanded===p.data.order.id?<ChevronDown size={13} className="text-muted"/>:<ChevronRight size={13} className="text-muted"/>}</div>:null},
  {headerName:"Job",minWidth:170,flex:1.4,cellRenderer:(p:{data?:GridRow})=>p.data?.totals?<span className="text-[12px] font-semibold text-muted">{p.data.totals.count} work orders</span>:<span className="truncate font-semibold text-ink">{p.data?.order?.title}</span>},
  {headerName:"Contractor",minWidth:180,flex:1.25,cellRenderer:(p:{data?:GridRow})=>p.data?.order?<div className="flex items-center gap-2.5"><Avatar tone={p.data.order.avatar_tone??0}/><span className="truncate text-ink">{p.data.order.contractor_name??"Unassigned"}</span></div>:null},
  {colId:"status",headerName:"Status",minWidth:138,flex:1.1,cellRenderer:(p:{data?:GridRow})=>p.data?.totals?<span className="text-[12px] font-semibold text-muted">Held <span className="mono text-ink">{money(p.data.totals.held)}</span></span>:p.data?.order?<StatusPill status={p.data.order.status}/>:null},
  {colId:"proof",headerName:"Proof",minWidth:150,flex:1.1,sortable:false,cellRenderer:(p:{data?:GridRow})=>p.data?.order?<ProofCell order={p.data.order}/>:null},
  {headerName:"Agreed",minWidth:128,flex:1,valueGetter:p=>p.data?.order?agreedCents(p.data.order):0,cellRenderer:(p:{data?:GridRow})=><span className="mono font-semibold">{p.data?.totals?money(p.data.totals.agreed):p.data?.order?money(agreedCents(p.data.order)):""}</span>},
  {colId:"paid",headerName:"Paid",minWidth:120,flex:1,valueGetter:p=>p.data?.order?paidCents(p.data.order):0,cellRenderer:(p:{data?:GridRow})=>p.data?.totals?<span className="mono font-bold text-paid">{money(p.data.totals.paid)}</span>:<span className={`mono font-bold ${p.data?.order&&paidCents(p.data.order)>0?"text-paid":"text-[#8B98A8]"}`}>{p.data?.order?money(paidCents(p.data.order)):""}</span>},
  {colId:"speed",headerName:"Proof → pay",minWidth:118,flex:0.9,valueGetter:p=>p.data?.order?proofToPaySeconds(p.data.order):null,comparator:(a:number|null,b:number|null)=>(a??Infinity)-(b??Infinity),
   cellRenderer:(p:{data?:GridRow;value?:number|null})=>p.data?.totals?<span className="mono text-[12px] font-semibold text-ink">avg {shortDuration(p.data.totals.avg)}</span>:p.data?.order?<span className={`mono text-[12px] ${p.value!=null?"font-semibold text-ink":"text-muted"}`}>{shortDuration(p.value??null)}</span>:null},
  {colId:"search",hide:true,valueGetter:p=>p.data?.members?p.data.members.map(searchText).join(" "):p.data?.order?searchText(p.data.order):""},
  {headerName:"Updated",minWidth:140,flex:1,cellRenderer:(p:{data?:GridRow})=><span className="text-[12px] text-muted mono">{p.data?.order?shortDate(p.data.order.updated_at):""}</span>},
 ],[expanded]);
 const allStatuses=useMemo(()=>new Map(orders.map(o=>[o.id,`${o.status}|${paidCents(o)}`])),[orders]);
 useEffect(()=>{const changed:string[]=[];for(const[id,s]of allStatuses){if(previous.current.has(id)&&previous.current.get(id)!==s)changed.push(id)}previous.current=allStatuses;
 if(changed.length){const api=grid.current?.api;if(api){const nodes=changed.map(id=>api.getRowNode(id)).filter((v):v is NonNullable<typeof v>=>!!v);if(nodes.length)api.flashCells({rowNodes:nodes,columns:["status","paid"],flashDuration:1400,fadeDuration:900})}}
 },[allStatuses,rows]);
 const filters=[{key:"all",label:"All"},{key:"active",label:"Active"},{key:"review",label:"Needs review"},{key:"paid",label:"Paid"}] as const;
 const onRowClicked=(p:RowClickedEvent<GridRow>)=>{if(p.data?.kind==="item"&&p.data.order)setExpanded(old=>old===p.data!.order!.id?null:p.data!.order!.id)};
 const onFullWidth=(p:{data?:GridRow})=>{const d=p.data;if(!d)return null;if(d.kind==="group")return <button type="button" onClick={()=>setClosedGroups(old=>old.includes(d.groupId!)?old.filter(x=>x!==d.groupId):[...old,d.groupId!])} className="flex h-full w-full items-center gap-3 bg-[#F3F6FA] px-5 text-left text-[12px] font-semibold text-ink">{d.collapsed?<ChevronRight size={15}/>:<ChevronDown size={15}/>}<span>{d.groupName}</span><span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-muted">{d.count}</span></button>;if(d.kind==="detail"&&d.order)return <DetailRow order={d.order} fixture={fixture}/>;return null};
 return <section className="mt-8"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-[20px] font-bold tracking-[-.035em]">Ledger</h2><div className="flex flex-wrap items-center gap-2"><Button size="sm" variant={groupMode?"secondary":"ghost"} onClick={()=>{setGroupMode(!groupMode);setClosedGroups([])}} aria-pressed={groupMode}><Layers3 size={14}/>Group by property</Button><Button variant="ghost" size="sm" onClick={()=>grid.current?.api.exportDataAsCsv({fileName:"punchlist-ledger.csv"})}><Download size={14}/>Export</Button></div></div>
 <div className="mb-4 flex flex-wrap items-center gap-2">{filters.map(f=><button type="button" key={f.key} onClick={()=>{setFilter(f.key);setExpanded(null)}} aria-pressed={filter===f.key} className={`rounded-full border px-4 py-1.5 text-[12px] font-semibold focus-visible:outline-accent ${filter===f.key?"border-accent bg-accent text-white":"border-border bg-white text-muted hover:text-ink"}`}>{f.label}</button>)}<label className="ml-auto flex h-8 w-full max-w-[260px] items-center gap-2 rounded-full border border-border bg-white px-3 text-[12px] text-muted focus-within:border-accent"><Search size={13}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search unit, job, contractor" aria-label="Search the ledger" className="w-full bg-transparent text-ink outline-none placeholder:text-[#94A1B2]"/></label></div>
 <div className="pp-ledger" aria-label="Work order ledger"><AgGridReact<GridRow> ref={grid} theme={quartz} domLayout="autoHeight" rowData={rows} columnDefs={columns} defaultColDef={{resizable:true,sortable:true,enableCellChangeFlash:true,suppressMovable:true}} getRowId={(p:GetRowIdParams<GridRow>)=>p.data.key} quickFilterText={search} includeHiddenColumnsInQuickFilter pinnedBottomRowData={totals} getRowHeight={p=>p.data?.kind==="detail"?315:p.data?.kind==="group"?43:p.data?.kind==="total"?48:56} isFullWidthRow={p=>p.rowNode.data?.kind==="detail"||p.rowNode.data?.kind==="group"} getRowStyle={p=>p.data?.kind==="total"?{fontWeight:600}:undefined} fullWidthCellRenderer={onFullWidth} onRowClicked={onRowClicked} suppressCellFocus={false} rowSelection={undefined} animateRows={false} overlayNoRowsTemplate={'<span class="text-sm text-muted">No work orders</span>'}/></div>
 <div className="mt-3 text-[12px] text-muted">{filtered.length} work orders · Paid flashes green when PayPal confirms a payout</div>
 </section>
}
