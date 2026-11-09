// Persistence facade. Returns the UI view models from lib/types.ts; the UI never learns the DB exists.
// Owner: lib/db. Backed by Drizzle on Postgres (DATABASE_URL) or PGlite on disk (PGLITE_DIR) with identical schema.
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import type { Contract, ContractorProfile, Criterion, LedgerEvent, Payout, PayoutKind, PayoutStatus, Proof, ProofKind, TranscriptTurn, Verdict, WorkOrder, WorkOrderStatus } from "@/lib/types";
import { getDb, type Db } from "./client";
import * as s from "./schema";

export interface CreateWorkOrderInput { title: string; description: string; unit: string; property_id?: string; budget_cents: number; criteria: Criterion[]; deadline?: string; created_by?: string }
export interface WorkOrderPatch { status?: WorkOrderStatus; title?: string; description?: string; criteria?: Criterion[]; budget_cents?: number; contractor_id?: string | null }
export interface ContractRecord extends Contract { approve_url?: string; paypal_capture_id?: string }

const iso = (d: Date | null | undefined): string | undefined => (d ? d.toISOString() : undefined);
const isoReq = (d: Date | null | undefined): string => d?.toISOString() ?? new Date(0).toISOString();
function toDate(value: string | undefined, fallback: Date = new Date()): Date { if (!value) return fallback; const d = new Date(value); return Number.isNaN(d.getTime()) ? fallback : d; }
const PAYOUT_ORDER: Record<string, number> = { deposit: 0, balance: 1, partial: 2 };
const nz = <T>(v: T | null): T | undefined => (v === null ? undefined : v);

async function touch(db: Db, id: string): Promise<void> { await db.update(s.workOrders).set({ updated_at: new Date() }).where(eq(s.workOrders.id, id)); }

function toProof(row: typeof s.proofs.$inferSelect): Proof {
  const p: Proof = { id: row.id, work_order_id: row.work_order_id, kind: row.kind as ProofKind, url: row.url, exif_ts: isoReq(row.exif_ts), uploaded_at: isoReq(row.uploaded_at) };
  if (row.exif_missing) p.exif_missing = true;
  return p;
}
function toPayout(row: typeof s.payouts.$inferSelect): Payout {
  const p: Payout = { id: row.id, work_order_id: row.work_order_id, contractor_id: row.contractor_id, amount_cents: row.amount_cents, kind: row.kind as PayoutKind, paypal_batch_id: row.paypal_batch_id, paypal_item_id: row.paypal_item_id, status: row.status as PayoutStatus };
  const paid = iso(row.paid_at); if (paid) p.paid_at = paid;
  return p;
}
function toVerdict(row: typeof s.verdicts.$inferSelect): Verdict {
  return { verdict: row.verdict as Verdict["verdict"], confidence: row.confidence, criteria: row.criteria_results_json ?? [], amount_to_release_cents: row.amount_to_release_cents, model: row.model };
}
function toContractor(row: typeof s.contractors.$inferSelect): ContractorProfile {
  return { id: row.id, name: row.name, trade: row.trade, paypal_email: row.paypal_email, hourly_rate_cents: row.hourly_rate_cents, avatar_tone: (row.avatar_tone as 0 | 1 | 2) ?? 0, profile: (row.profile_json ?? {}) as ContractorProfile["profile"] };
}

/** Builds full WorkOrder view models for the rows matching `where` (all rows when omitted), newest updated_at first. */
async function buildViews(db: Db, where?: SQL): Promise<WorkOrder[]> {
  const contractorKey = sql`coalesce(${s.contracts.contractor_id}, ${s.workOrders.contractor_id})`;
  const base = db.select({ wo: s.workOrders, unit: s.units, property: s.properties, contract: s.contracts, contractor: s.contractors })
    .from(s.workOrders)
    .innerJoin(s.units, eq(s.workOrders.unit_id, s.units.id))
    .innerJoin(s.properties, eq(s.units.property_id, s.properties.id))
    .leftJoin(s.contracts, eq(s.contracts.work_order_id, s.workOrders.id))
    .leftJoin(s.contractors, eq(s.contractors.id, contractorKey));
  const rows = await (where ? base.where(where) : base).orderBy(desc(s.workOrders.updated_at), desc(s.workOrders.id));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.wo.id);
  const [negs, proofRows, verdictRows, payoutRows] = await Promise.all([
    db.select().from(s.negotiations).where(inArray(s.negotiations.work_order_id, ids)),
    db.select().from(s.proofs).where(inArray(s.proofs.work_order_id, ids)),
    db.select().from(s.verdicts).where(inArray(s.verdicts.work_order_id, ids)).orderBy(desc(s.verdicts.created_at), desc(s.verdicts.id)),
    db.select().from(s.payouts).where(inArray(s.payouts.work_order_id, ids)),
  ]);
  const negBy = new Map(negs.map((n) => [n.work_order_id, n.transcript_json ?? []]));
  const latestVerdict = new Map<string, Verdict>();
  for (const v of verdictRows) if (!latestVerdict.has(v.work_order_id)) latestVerdict.set(v.work_order_id, toVerdict(v));
  return rows.map(({ wo, unit, property, contract, contractor }) => {
    const proofs = proofRows.filter((p) => p.work_order_id === wo.id).sort((a, b) => a.uploaded_at.getTime() - b.uploaded_at.getTime() || a.id.localeCompare(b.id)).map(toProof);
    const payouts = payoutRows.filter((p) => p.work_order_id === wo.id).sort((a, b) => (PAYOUT_ORDER[a.kind] ?? 9) - (PAYOUT_ORDER[b.kind] ?? 9)).map(toPayout);
    const view: WorkOrder = {
      id: wo.id, property_id: property.id, property_name: property.name, unit_id: unit.id, unit: unit.label,
      title: wo.title, description: wo.description, criteria: wo.criteria_json ?? [], budget_cents: wo.budget_cents,
      status: wo.status as WorkOrderStatus, created_by: wo.created_by, updated_at: isoReq(wo.updated_at),
      negotiation: negBy.get(wo.id) ?? [], proofs, payouts,
    };
    const contractorId = contract?.contractor_id ?? wo.contractor_id;
    if (contractorId) view.contractor_id = contractorId;
    if (contractor) { view.contractor_name = contractor.name; view.contractor_trade = contractor.trade; view.avatar_tone = (contractor.avatar_tone as 0 | 1 | 2) ?? 0; }
    if (contract) {
      const c: Contract = { contractor_id: contract.contractor_id, price_cents: contract.price_cents, deposit_pct: contract.deposit_pct, deadline: isoReq(contract.deadline), criteria: contract.criteria_json ?? [] };
      if (contract.paypal_order_id) c.paypal_order_id = contract.paypal_order_id;
      if (contract.paypal_auth_id) c.paypal_auth_id = contract.paypal_auth_id;
      if (contract.paypal_capture_id) c.paypal_capture_id = contract.paypal_capture_id;
      if (contract.approve_url) c.approve_url = contract.approve_url;
      view.contract = c;
    }
    const verdict = latestVerdict.get(wo.id); if (verdict) view.verdict = verdict;
    return view;
  });
}

export async function listWorkOrders(): Promise<WorkOrder[]> { return buildViews(await getDb()); }
export async function getWorkOrder(id: string): Promise<WorkOrder | null> { const [row] = await buildViews(await getDb(), eq(s.workOrders.id, id)); return row ?? null; }

async function nextWorkOrderId(db: Db): Promise<string> {
  const rows = await db.select({ id: s.workOrders.id }).from(s.workOrders);
  let max = 1042;
  for (const { id } of rows) { const m = /^wo-(\d+)$/.exec(id); if (m) max = Math.max(max, Number(m[1])); }
  return `wo-${max + 1}`;
}

async function resolveUnit(db: Db, property_id: string | undefined, label: string): Promise<string> {
  const cleanLabel = label.trim().toUpperCase() || "—";
  let propertyId = property_id ?? "p-1";
  const [prop] = await db.select({ id: s.properties.id }).from(s.properties).where(eq(s.properties.id, propertyId));
  if (!prop) {
    const [first] = await db.select({ id: s.properties.id }).from(s.properties).orderBy(s.properties.id).limit(1);
    if (!first) throw new Error("No properties seeded");
    propertyId = first.id;
  }
  const [existing] = await db.select({ id: s.units.id }).from(s.units).where(and(eq(s.units.property_id, propertyId), eq(s.units.label, cleanLabel)));
  if (existing) return existing.id;
  const id = `u-${propertyId}-${cleanLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  await db.insert(s.units).values({ id, property_id: propertyId, label: cleanLabel }).onConflictDoNothing();
  return id;
}

export async function createWorkOrder(input: CreateWorkOrderInput): Promise<WorkOrder> {
  const db = await getDb();
  const unit_id = await resolveUnit(db, input.property_id, input.unit);
  const id = await nextWorkOrderId(db);
  const now = new Date();
  await db.insert(s.workOrders).values({ id, unit_id, title: input.title, description: input.description, criteria_json: input.criteria, budget_cents: input.budget_cents, status: "draft", created_by: input.created_by ?? "pm-1", deadline: input.deadline ? toDate(input.deadline) : null, created_at: now, updated_at: now });
  const view = await getWorkOrder(id);
  if (!view) throw new Error(`Work order ${id} vanished after insert`);
  return view;
}

export async function updateWorkOrder(id: string, patch: WorkOrderPatch): Promise<WorkOrder> {
  const db = await getDb();
  const set: Partial<typeof s.workOrders.$inferInsert> = { updated_at: new Date() };
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.criteria !== undefined) set.criteria_json = patch.criteria;
  if (patch.budget_cents !== undefined) set.budget_cents = patch.budget_cents;
  if (patch.contractor_id !== undefined) set.contractor_id = patch.contractor_id;
  await db.update(s.workOrders).set(set).where(eq(s.workOrders.id, id));
  const view = await getWorkOrder(id);
  if (!view) throw new Error(`Work order ${id} not found`);
  return view;
}

export async function saveNegotiation(id: string, transcript: TranscriptTurn[], outcome: "pending" | "agreed" | "walked_away"): Promise<void> {
  const db = await getDb();
  await db.insert(s.negotiations).values({ id: `neg-${id}`, work_order_id: id, transcript_json: transcript, outcome })
    .onConflictDoUpdate({ target: s.negotiations.work_order_id, set: { transcript_json: transcript, outcome } });
  await touch(db, id);
}

export async function appendNegotiationTurn(id: string, turn: TranscriptTurn): Promise<void> {
  const db = await getDb();
  const [existing] = await db.select().from(s.negotiations).where(eq(s.negotiations.work_order_id, id));
  const transcript = [...(existing?.transcript_json ?? []), turn];
  await db.insert(s.negotiations).values({ id: `neg-${id}`, work_order_id: id, transcript_json: transcript, outcome: existing?.outcome ?? "pending" })
    .onConflictDoUpdate({ target: s.negotiations.work_order_id, set: { transcript_json: transcript } });
  await touch(db, id);
}

export async function upsertContract(id: string, contract: ContractRecord): Promise<void> {
  const db = await getDb();
  const values = { contractor_id: contract.contractor_id, price_cents: contract.price_cents, deposit_pct: contract.deposit_pct, deadline: toDate(contract.deadline), criteria_json: contract.criteria, paypal_order_id: contract.paypal_order_id ?? null, paypal_auth_id: contract.paypal_auth_id ?? null, paypal_capture_id: contract.paypal_capture_id ?? null, approve_url: contract.approve_url ?? null };
  await db.insert(s.contracts).values({ id: `ct-${id}`, work_order_id: id, ...values }).onConflictDoUpdate({ target: s.contracts.work_order_id, set: values });
  await db.update(s.workOrders).set({ contractor_id: contract.contractor_id, deadline: values.deadline, updated_at: new Date() }).where(eq(s.workOrders.id, id));
}

export async function updateContract(id: string, patch: Partial<ContractRecord>): Promise<void> {
  const db = await getDb();
  const set: Partial<typeof s.contracts.$inferInsert> = {};
  if (patch.contractor_id !== undefined) set.contractor_id = patch.contractor_id;
  if (patch.price_cents !== undefined) set.price_cents = patch.price_cents;
  if (patch.deposit_pct !== undefined) set.deposit_pct = patch.deposit_pct;
  if (patch.deadline !== undefined) set.deadline = toDate(patch.deadline);
  if (patch.criteria !== undefined) set.criteria_json = patch.criteria;
  if (patch.paypal_order_id !== undefined) set.paypal_order_id = patch.paypal_order_id;
  if (patch.paypal_auth_id !== undefined) set.paypal_auth_id = patch.paypal_auth_id;
  if (patch.paypal_capture_id !== undefined) set.paypal_capture_id = patch.paypal_capture_id;
  if (patch.approve_url !== undefined) set.approve_url = patch.approve_url;
  if (Object.keys(set).length) await db.update(s.contracts).set(set).where(eq(s.contracts.work_order_id, id));
  if (patch.contractor_id !== undefined) await db.update(s.workOrders).set({ contractor_id: patch.contractor_id }).where(eq(s.workOrders.id, id));
  await touch(db, id);
}

/** Replaces any existing proof of the same kind on that work order. */
export async function addProof(proof: Omit<Proof, "id">): Promise<Proof> {
  const db = await getDb();
  const uploaded = toDate(proof.uploaded_at);
  const row: typeof s.proofs.$inferInsert = { id: `pr-${Date.now()}-${proof.kind}-${randomUUID().slice(0, 6)}`, work_order_id: proof.work_order_id, kind: proof.kind, url: proof.url, exif_ts: toDate(proof.exif_ts, uploaded), uploaded_at: uploaded, exif_missing: Boolean(proof.exif_missing) };
  await db.delete(s.proofs).where(and(eq(s.proofs.work_order_id, proof.work_order_id), eq(s.proofs.kind, proof.kind)));
  await db.insert(s.proofs).values(row);
  await touch(db, proof.work_order_id);
  const [saved] = await db.select().from(s.proofs).where(eq(s.proofs.id, row.id));
  return toProof(saved);
}

export async function deleteProofs(id: string, kinds: ProofKind[]): Promise<void> {
  if (kinds.length === 0) return;
  const db = await getDb();
  await db.delete(s.proofs).where(and(eq(s.proofs.work_order_id, id), inArray(s.proofs.kind, kinds)));
  await touch(db, id);
}

export async function saveVerdict(id: string, verdict: Verdict, extra: { proof_hash: string; raw?: unknown }): Promise<void> {
  const db = await getDb();
  await db.insert(s.verdicts).values({ id: `vd-${id}-${Date.now()}-${randomUUID().slice(0, 6)}`, work_order_id: id, verdict: verdict.verdict, confidence: verdict.confidence, criteria_results_json: verdict.criteria, amount_to_release_cents: verdict.amount_to_release_cents, model: verdict.model, raw: extra.raw === undefined ? null : (extra.raw as object), proof_hash: extra.proof_hash, created_at: new Date() });
  await touch(db, id);
}

export async function findVerdictByHash(id: string, proof_hash: string): Promise<Verdict | null> {
  const db = await getDb();
  const [row] = await db.select().from(s.verdicts).where(and(eq(s.verdicts.work_order_id, id), eq(s.verdicts.proof_hash, proof_hash))).orderBy(desc(s.verdicts.created_at)).limit(1);
  return row ? toVerdict(row) : null;
}

export async function clearVerdict(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(s.verdicts).where(eq(s.verdicts.work_order_id, id));
  await touch(db, id);
}

/** Keyed by (work_order_id, kind): one deposit, one balance, one partial per work order. */
export async function upsertPayout(payout: Payout): Promise<Payout> {
  const db = await getDb();
  const values = { contractor_id: payout.contractor_id, amount_cents: payout.amount_cents, paypal_batch_id: payout.paypal_batch_id, paypal_item_id: payout.paypal_item_id, status: payout.status, paid_at: payout.paid_at ? toDate(payout.paid_at) : null };
  await db.insert(s.payouts).values({ id: payout.id || `pay-${payout.work_order_id}-${payout.kind}`, work_order_id: payout.work_order_id, kind: payout.kind, created_at: new Date(), ...values })
    .onConflictDoUpdate({ target: [s.payouts.work_order_id, s.payouts.kind], set: values });
  await touch(db, payout.work_order_id);
  const [row] = await db.select().from(s.payouts).where(and(eq(s.payouts.work_order_id, payout.work_order_id), eq(s.payouts.kind, payout.kind)));
  return toPayout(row);
}

export async function updatePayout(payoutId: string, patch: Partial<Pick<Payout, "status" | "paid_at" | "paypal_batch_id" | "paypal_item_id">>): Promise<void> {
  const db = await getDb();
  const set: Partial<typeof s.payouts.$inferInsert> = {};
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.paid_at !== undefined) set.paid_at = patch.paid_at ? toDate(patch.paid_at) : null;
  if (patch.paypal_batch_id !== undefined) set.paypal_batch_id = patch.paypal_batch_id;
  if (patch.paypal_item_id !== undefined) set.paypal_item_id = patch.paypal_item_id;
  if (!Object.keys(set).length) return;
  await db.update(s.payouts).set(set).where(eq(s.payouts.id, payoutId));
  const [row] = await db.select({ work_order_id: s.payouts.work_order_id }).from(s.payouts).where(eq(s.payouts.id, payoutId));
  if (row) await touch(db, row.work_order_id);
}

export async function listPendingPayouts(): Promise<Payout[]> {
  const db = await getDb();
  return (await db.select().from(s.payouts).where(eq(s.payouts.status, "pending")).orderBy(s.payouts.created_at)).map(toPayout);
}

export async function findPayoutByBatchId(batchId: string): Promise<Payout | null> {
  const db = await getDb();
  const [row] = await db.select().from(s.payouts).where(eq(s.payouts.paypal_batch_id, batchId)).limit(1);
  return row ? toPayout(row) : null;
}

/** Work orders with a PayPal order id but no authorization yet (status negotiating, awaiting PM approval). */
export async function listOrdersAwaitingFunding(): Promise<WorkOrder[]> {
  const db = await getDb();
  const rows = await db.select({ id: s.contracts.work_order_id }).from(s.contracts).innerJoin(s.workOrders, eq(s.workOrders.id, s.contracts.work_order_id))
    .where(and(eq(s.workOrders.status, "negotiating"), isNotNull(s.contracts.paypal_order_id), isNull(s.contracts.paypal_auth_id)));
  if (!rows.length) return [];
  return buildViews(db, inArray(s.workOrders.id, rows.map((r) => r.id)));
}

export async function findWorkOrderByPaypalOrderId(paypalOrderId: string): Promise<WorkOrder | null> {
  const db = await getDb();
  const [row] = await db.select({ id: s.contracts.work_order_id }).from(s.contracts).where(eq(s.contracts.paypal_order_id, paypalOrderId)).limit(1);
  return row ? getWorkOrder(row.id) : null;
}

export async function listContractors(): Promise<ContractorProfile[]> {
  const db = await getDb();
  return (await db.select().from(s.contractors).orderBy(s.contractors.id)).map(toContractor);
}

export async function getContractor(id: string): Promise<ContractorProfile | null> {
  const db = await getDb();
  const [row] = await db.select().from(s.contractors).where(eq(s.contractors.id, id));
  return row ? toContractor(row) : null;
}

export async function listUnits(): Promise<{ unit_id: string; unit: string; property_id: string; property_name: string }[]> {
  const db = await getDb();
  const rows = await db.select({ unit_id: s.units.id, unit: s.units.label, property_id: s.properties.id, property_name: s.properties.name }).from(s.units).innerJoin(s.properties, eq(s.properties.id, s.units.property_id)).orderBy(s.properties.id, s.units.label);
  return rows;
}

export async function addEvent(work_order_id: string | null, type: string, payload: unknown): Promise<void> {
  const db = await getDb();
  await db.insert(s.events).values({ id: `ev-${randomUUID()}`, work_order_id, type, payload_json: payload === undefined ? null : (payload as object), at: new Date() });
}

export async function listEvents(work_order_id: string): Promise<LedgerEvent[]> {
  const db = await getDb();
  const rows = await db.select().from(s.events).where(eq(s.events.work_order_id, work_order_id)).orderBy(s.events.at, s.events.id);
  return rows.map((r) => ({ id: r.id, work_order_id: nz(r.work_order_id), type: r.type, payload: r.payload_json, at: isoReq(r.at) }));
}

/** Returns false when the PayPal event id was already recorded (dedupe). */
export async function recordWebhookEvent(event_id: string, type: string, payload: unknown): Promise<boolean> {
  const db = await getDb();
  const [existing] = await db.select({ id: s.paypalWebhookEvents.id }).from(s.paypalWebhookEvents).where(eq(s.paypalWebhookEvents.event_id, event_id)).limit(1);
  if (existing) return false;
  try {
    await db.insert(s.paypalWebhookEvents).values({ id: `wh-${randomUUID()}`, event_id, type, payload: payload === undefined ? null : (payload as object), received_at: new Date() });
    return true;
  } catch (err) {
    const code = (err as { code?: string; cause?: { code?: string } }).code ?? (err as { cause?: { code?: string } }).cause?.code;
    if (code === "23505" || /duplicate key|unique/i.test(String((err as Error).message))) return false;
    throw err;
  }
}
