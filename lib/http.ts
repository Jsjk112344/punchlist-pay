// Small helpers so every route answers with the same headers and error shape ({error}).
import { NextResponse } from "next/server";
import { modeHeaders } from "@/lib/config";
import { FlowError } from "@/lib/flows";

export function ok<T>(body: T, init: { status?: number; headers?: Record<string, string> } = {}) {
  return NextResponse.json(body, { status: init.status ?? 200, headers: modeHeaders(init.headers) });
}
export function fail(message: string, status = 400) { return NextResponse.json({ error: message }, { status, headers: modeHeaders() }); }

/** Maps FlowError to its status; anything else is a 500 with a generic message (details go to the server log only). */
export function handleError(e: unknown, context: string) {
  if (e instanceof FlowError) return fail(e.message, e.status);
  console.error(`[${context}]`, e instanceof Error ? e.message : e);
  return fail(`${context} failed`, 500);
}
