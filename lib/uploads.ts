// Proof uploads: local disk under UPLOAD_DIR (Render persistent disk in prod), EXIF capture time via exifr.
// Only URLs are stored; files are served by GET /api/files/[name].
import { promises as fs } from "node:fs";
import path from "node:path";
import exifr from "exifr";
import { env } from "@/lib/config";
import type { VisionMediaType } from "@/lib/agents/verifier";

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/heic": "heic", "image/heif": "heif" };
const MIME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", heic: "image/heic", heif: "image/heif", svg: "image/svg+xml" };
const VISION: VisionMediaType[] = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export interface SavedUpload { url: string; filename: string; media_type: string; exif_ts: string; exif_missing: boolean; uploaded_at: string }

export async function readExifTimestamp(bytes: Buffer): Promise<string | undefined> {
  try {
    const tags = await exifr.parse(bytes, { pick: ["DateTimeOriginal", "CreateDate", "OffsetTimeOriginal", "OffsetTime"], reviveValues: true, translateValues: true });
    const date: unknown = tags?.DateTimeOriginal ?? tags?.CreateDate;
    if (date instanceof Date && !Number.isNaN(date.getTime())) return date.toISOString();
    if (typeof date === "string") { const d = new Date(date.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3")); if (!Number.isNaN(d.getTime())) return d.toISOString(); }
  } catch { /* no EXIF: fall through */ }
  return undefined;
}

export async function saveUpload(file: File, work_order_id: string, kind: string): Promise<SavedUpload> {
  await fs.mkdir(env.uploadDir, { recursive: true });
  const bytes = Buffer.from(await file.arrayBuffer());
  const media_type = file.type || MIME[path.extname(file.name).slice(1).toLowerCase()] || "application/octet-stream";
  const ext = EXT[media_type] ?? (path.extname(file.name).slice(1).toLowerCase() || "bin");
  const filename = `${work_order_id}-${kind}-${Date.now()}.${ext}`.replace(/[^a-zA-Z0-9._-]/g, "_");
  await fs.writeFile(path.join(env.uploadDir, filename), bytes);
  const uploaded_at = new Date().toISOString();
  const exif = await readExifTimestamp(bytes);
  return { url: `/api/files/${filename}`, filename, media_type, exif_ts: exif ?? uploaded_at, exif_missing: !exif, uploaded_at };
}

/** Resolves a stored proof URL to bytes for the verifier. Returns null for anything Claude vision cannot read (e.g. SVG fixtures). */
export async function loadImageForVision(url: string): Promise<{ data: Buffer; media_type: VisionMediaType } | null> {
  let filePath: string | null = null;
  if (url.startsWith("/api/files/")) { const name = path.basename(url.slice("/api/files/".length)); filePath = path.join(env.uploadDir, name); }
  else if (url.startsWith("/fixtures/")) filePath = path.join(process.cwd(), "public", path.normalize(url).replace(/^(\.\.[/\\])+/, ""));
  else if (url.startsWith("data:")) {
    const m = /^data:([^;,]+);base64,([\s\S]*)$/.exec(url); if (!m) return null;
    const media_type = m[1] as VisionMediaType; return VISION.includes(media_type) ? { data: Buffer.from(m[2], "base64"), media_type } : null;
  }
  if (!filePath) return null;
  const media_type = (MIME[path.extname(filePath).slice(1).toLowerCase()] ?? "") as VisionMediaType;
  if (!VISION.includes(media_type)) {
    // SVG fixtures have PNG rasters alongside them for vision; prefer those when present.
    const png = filePath.replace(/\.svg$/i, ".png");
    if (png !== filePath) { try { return { data: await fs.readFile(png), media_type: "image/png" }; } catch { return null; } }
    return null;
  }
  try { return { data: await fs.readFile(filePath), media_type }; } catch { return null; }
}

export function safeUploadPath(name: string): string | null {
  const base = path.basename(name); if (base !== name || name.includes("..") || !name) return null;
  return path.join(env.uploadDir, base);
}
export function mimeForFile(name: string): string { return MIME[path.extname(name).slice(1).toLowerCase()] ?? "application/octet-stream"; }
