// View model projected from the PLAN.md Drizzle tables. API request/response shapes are unchanged.
export type WorkOrderStatus = "draft" | "negotiating" | "funded" | "in_progress" | "under_review" | "paid" | "escalated" | "disputed" | "redo_requested";
export type ProofKind = "checkin" | "after" | "receipt";
export type CriterionCheck = "photo" | "receipt" | "time";
export interface Criterion { id: string; text: string; check: CriterionCheck; met?: boolean; evidence?: string }
export interface TranscriptTurn { id: string; role: "dispatcher" | "contractor" | "system"; text: string; offer_cents?: number; timestamp?: string }
export interface Proof { id: string; work_order_id: string; kind: ProofKind; url: string; exif_ts: string; uploaded_at: string }
export interface Contract { contractor_id: string; price_cents: number; deposit_pct: number; deadline: string; criteria: Criterion[]; paypal_order_id?: string; paypal_auth_id?: string }
export interface CriterionResult { id: string; met: boolean; evidence: string }
export interface Verdict { verdict: "pass" | "partial" | "fail"; confidence: number; criteria: CriterionResult[]; amount_to_release_cents: number; model: string }
export interface Payout { id: string; work_order_id: string; contractor_id: string; amount_cents: number; kind: "deposit" | "balance" | "partial"; paypal_batch_id: string; paypal_item_id: string; status: "pending" | "paid"; paid_at?: string }
export interface WorkOrder {
  id: string; property_id: string; property_name: string; unit_id: string; unit: string;
  title: string; description: string; criteria: Criterion[]; budget_cents: number;
  status: WorkOrderStatus; created_by: string; contractor_id?: string;
  contractor_name?: string; contractor_trade?: string; avatar_tone?: 0 | 1 | 2;
  updated_at: string; contract?: Contract; negotiation: TranscriptTurn[];
  proofs: Proof[]; verdict?: Verdict; payouts: Payout[];
}
export interface DraftRequest { title:string; unit:string; budget_cents:number; deadline:string; criteria:Criterion[] }
