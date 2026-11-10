// Tool schemas (strict) for the negotiation agents and JSON schemas for structured outputs. Owner: lib/agents.
import type Anthropic from "@anthropic-ai/sdk";
import type { CriterionCheck } from "@/lib/types";
import { isRecord } from "./client";

type Tool = Anthropic.Beta.Messages.BetaTool;

export const counterTool: Tool = {
  name: "counter",
  description: "Make or respond with a counter-offer. Use this on every turn that is not a final agreement or a walk-away.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      text: { type: "string", description: "What you say out loud, at most two sentences." },
      offer_cents: { type: "integer", description: "Your proposed total price for the job, in US cents (a positive whole number)." },
      deadline: { type: ["string", "null"], description: "Proposed completion deadline as an ISO 8601 timestamp with offset, or null to keep the current one." },
    },
    required: ["text", "offer_cents", "deadline"],
    additionalProperties: false,
  },
};

export const agreeTool: Tool = {
  name: "agree",
  description: "Accept the other side's latest terms (or state final agreed terms). Ends the negotiation.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      text: { type: "string", description: "What you say out loud, at most two sentences." },
      price_cents: { type: "integer", description: "Agreed total price in US cents (a positive whole number)." },
      deadline: { type: "string", description: "Agreed completion deadline as an ISO 8601 timestamp with offset." },
      deposit_pct: { type: "integer", description: "Deposit released at check-in, as a whole percentage of the price from 0 to 100." },
    },
    required: ["text", "price_cents", "deadline", "deposit_pct"],
    additionalProperties: false,
  },
};

export const walkAwayTool: Tool = {
  name: "walk_away",
  description: "End the negotiation without agreement.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      text: { type: "string", description: "What you say out loud, at most two sentences." },
      reason: { type: "string", description: "One short reason for the record." },
    },
    required: ["text", "reason"],
    additionalProperties: false,
  },
};

export const createAuthorizeOrderTool: Tool = {
  name: "create_authorize_order",
  description: "Create a PayPal order (intent AUTHORIZE) that holds the agreed amount for this work order. Call once, only after agreement.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      amount_cents: { type: "integer", description: "Amount to hold, in US cents. Must equal the agreed price." },
      description: { type: "string", description: "One line shown on the PayPal order, e.g. 'Kitchen sink leak · Unit 4B · Mike's Plumbing'." },
    },
    required: ["amount_cents", "description"],
    additionalProperties: false,
  },
};

export const dispatcherTools: Tool[] = [counterTool, agreeTool, walkAwayTool];
export const contractorTools: Tool[] = [counterTool, agreeTool, walkAwayTool];
export const fundingTools: Tool[] = [createAuthorizeOrderTool];

export interface CounterInput { text: string; offer_cents: number; deadline: string | null }
export interface AgreeInput { text: string; price_cents: number; deadline: string; deposit_pct: number }
export interface WalkAwayInput { text: string; reason: string }
export interface CreateAuthorizeOrderInput { amount_cents: number; description: string }

const int = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export function parseCounter(input: unknown): CounterInput | null {
  if (!isRecord(input) || typeof input.text !== "string" || !int(input.offer_cents)) return null;
  return { text: input.text, offer_cents: Math.round(input.offer_cents), deadline: typeof input.deadline === "string" ? input.deadline : null };
}
export function parseAgree(input: unknown): AgreeInput | null {
  if (!isRecord(input) || typeof input.text !== "string" || !int(input.price_cents) || typeof input.deadline !== "string") return null;
  const deposit = int(input.deposit_pct) ? Math.min(100, Math.max(0, Math.round(input.deposit_pct))) : 0;
  return { text: input.text, price_cents: Math.round(input.price_cents), deadline: input.deadline, deposit_pct: deposit };
}
export function parseWalkAway(input: unknown): WalkAwayInput | null {
  if (!isRecord(input) || typeof input.text !== "string") return null;
  return { text: input.text, reason: typeof input.reason === "string" ? input.reason : "" };
}
export function parseCreateAuthorizeOrder(input: unknown): CreateAuthorizeOrderInput | null {
  if (!isRecord(input) || !int(input.amount_cents)) return null;
  return { amount_cents: Math.round(input.amount_cents), description: typeof input.description === "string" ? input.description : "" };
}

// ---- Structured-output schemas -------------------------------------------------------------------------------

export const CRITERION_CHECKS: CriterionCheck[] = ["photo", "receipt", "time"];

export const dispatcherOutputSchema = {
  type: "object",
  properties: {
    title: { type: "string", description: "Short job title, at most 40 characters." },
    unit: { type: "string", description: "Unit label exactly as written in the request or matched from the known units, e.g. '4B'." },
    property_id: { type: ["string", "null"], description: "property_id of the matched known unit, or null when the request does not match a known unit." },
    budget_cents: { type: "integer", description: "Budget in US cents (at least 100), at or below any cap the request states." },
    deadline: { type: "string", description: "ISO 8601 timestamp with offset." },
    criteria: {
      type: "array",
      description: "Exactly 3 acceptance criteria.",
      items: {
        type: "object",
        properties: {
          text: { type: "string", description: "One concrete, checkable statement." },
          check: { type: "string", enum: CRITERION_CHECKS, description: "What verifies it: a photo, a receipt, or a timestamp." },
        },
        required: ["text", "check"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "unit", "property_id", "budget_cents", "deadline", "criteria"],
  additionalProperties: false,
} as const;

export function verifierOutputSchema(criterionIds: string[]) {
  return {
    type: "object",
    properties: {
      verdict: { type: "string", enum: ["pass", "partial", "fail"] },
      confidence: { type: "number", description: "Confidence from 0 to 1." },
      criteria: {
        type: "array",
        description: "One entry per contract criterion id, each exactly once.",
        items: {
          type: "object",
          properties: {
            id: { type: "string", enum: criterionIds },
            met: { type: "boolean" },
            evidence: { type: "string", description: "A short quoted observation from the proof that supports met/unmet." },
          },
          required: ["id", "met", "evidence"],
          additionalProperties: false,
        },
      },
      amount_to_release_cents: { type: "integer", description: "Cents to release now; 0 when failing." },
    },
    required: ["verdict", "confidence", "criteria", "amount_to_release_cents"],
    additionalProperties: false,
  } as const;
}
