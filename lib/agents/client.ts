// Anthropic SDK client, model selection and the one request helper every agent uses. Owner: lib/agents.
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/config";

let client: Anthropic | null = null;
let override: Anthropic | null = null;
export function getAnthropic(): Anthropic { if (override) return override; if (!client) client = new Anthropic({ apiKey: env.anthropicApiKey }); return client; }
/** Test hook: inject a fake client (shaped like `{ beta: { messages: { create } } }`). Pass null to restore the real one. */
export function __setClientForTests(fake: Anthropic | null): void { override = fake; }
export const MODEL = env.claudeModel; // default claude-sonnet-5-5; override with CLAUDE_MODEL

export class AgentRefusalError extends Error {
  constructor(public category: string | null | undefined, explanation?: string | null) { super(`Model declined the request${category ? ` (${category})` : ""}${explanation ? `: ${explanation}` : ""}`); this.name = "AgentRefusalError"; }
}
export class AgentOutputError extends Error { constructor(message: string, public raw?: unknown) { super(message); this.name = "AgentOutputError"; } }

type BetaCreate = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
export type ModelCallParams = Omit<BetaCreate, "model" | "betas" | "fallbacks" | "stream"> & { model?: string };

/**
 * One non-streaming call. Adds the model, the server-side fallback ("default" routes a safety decline to a sibling
 * model inside the same request) and turns a refusal or a truncated response into a typed error.
 */
export async function callModel(params: ModelCallParams): Promise<Anthropic.Beta.Messages.BetaMessage> {
  const { model, ...rest } = params;
  const res = await getAnthropic().beta.messages.create({ model: model ?? MODEL, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default", ...rest });
  if (res.stop_reason === "refusal") throw new AgentRefusalError(res.stop_details?.category, res.stop_details?.explanation);
  if (res.stop_reason === "max_tokens") throw new AgentOutputError("Model output was truncated at max_tokens");
  return res;
}

export function textOf(msg: Anthropic.Beta.Messages.BetaMessage): string {
  return msg.content.filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
}
export function toolUsesOf(msg: Anthropic.Beta.Messages.BetaMessage): Anthropic.Beta.Messages.BetaToolUseBlock[] {
  return msg.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use");
}
/** Structured-output responses arrive as a single text block holding JSON. */
export function parseJsonOutput<T = unknown>(msg: Anthropic.Beta.Messages.BetaMessage): T {
  const text = textOf(msg);
  try { return JSON.parse(text) as T; } catch { throw new AgentOutputError("Model did not return valid JSON", text); }
}

const promptCache = new Map<string, string>();
export function readPrompt(file: string): string {
  const cached = promptCache.get(file); if (cached) return cached;
  const text = fs.readFileSync(path.join(process.cwd(), "lib/agents/prompts", file), "utf8");
  promptCache.set(file, text); return text;
}
/** Replaces {{key}} placeholders; unknown keys are left visible so a missing value is obvious in logs. */
export function fillPrompt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (m, key: string) => (key in vars ? String(vars[key]) : m));
}
export function isRecord(v: unknown): v is Record<string, unknown> { return typeof v === "object" && v !== null && !Array.isArray(v); }
