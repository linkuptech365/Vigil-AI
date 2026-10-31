import { NextResponse } from "next/server"

import { ingestHitRecords, type HitIngestItem, type HitUpdateItem } from "@/lib/storage/hit-history-store"
import type { AuditRawDetection, AuditRuleDecision } from "@/lib/vigil/audit"
import { HIT_GATES, type HitHistoryGate, type HitHistoryRecord } from "@/lib/vigil/hit-history"
import type { VisionHitTag } from "@/lib/vigil/vision"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/
const MAX_FRAME_BYTES = 800_000

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.slice(0, max) : ""
}

function isoOr(value: unknown, fallback: string) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : fallback
}

function sanitizeTags(raw: unknown): VisionHitTag[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 8).map((item) => {
    const r = (item ?? {}) as Record<string, unknown>
    return {
      label: text(r.label, 80),
      prompt: text(r.prompt, 120),
      role: text(r.role, 32),
      confidence: Math.min(1, Math.max(0, Number(r.confidence) || 0)),
    }
  })
}

function sanitizeNew(raw: Record<string, unknown>): HitIngestItem | null {
  const id = text(raw.id, 64)
  const streamId = text(raw.streamId, 128)
  const gate = HIT_GATES.find((item) => item === raw.gate) as HitHistoryGate | undefined
  if (!SAFE_ID.test(id) || !streamId || !gate) return null
  const now = new Date().toISOString()
  const at = isoOr(raw.at, now)
  const progress = raw.progress as { hits?: unknown; need?: unknown } | undefined
  const record: HitHistoryRecord = {
    id,
    at,
    lastAt: isoOr(raw.lastAt, at),
    streamId,
    gate,
    tags: sanitizeTags(raw.tags),
    reasons: Array.isArray(raw.reasons) ? raw.reasons.slice(0, 5).map((item) => text(item, 300)) : [],
    repeat: Math.max(1, Math.round(Number(raw.repeat) || 1)),
    progress: progress ? { hits: Math.round(Number(progress.hits) || 0), need: Math.round(Number(progress.need) || 0) } : undefined,
    eventId: text(raw.eventId, 64) || undefined,
    anchor: raw.anchor === true ? true : undefined,
    hasFrame: false,
    frameWidth: Math.max(0, Math.round(Number(raw.frameWidth) || 0)),
    frameHeight: Math.max(0, Math.round(Number(raw.frameHeight) || 0)),
    rawDetections: Array.isArray(raw.rawDetections) ? (raw.rawDetections.slice(0, 20) as AuditRawDetection[]) : [],
    decisions: Array.isArray(raw.decisions) ? (raw.decisions.slice(0, 40) as AuditRuleDecision[]) : [],
  }
  let frame: Buffer | undefined
  if (typeof raw.frame === "string" && raw.frame.length > 0 && raw.frame.length < MAX_FRAME_BYTES * 1.4) {
    const buffer = Buffer.from(raw.frame, "base64")
    if (buffer.length > 0 && buffer.length <= MAX_FRAME_BYTES) frame = buffer
  }
  const earlierFrames: Buffer[] = []
  if (frame && Array.isArray(raw.frames)) {
    for (const item of raw.frames.slice(0, 3)) {
      if (typeof item !== "string" || item.length === 0 || item.length >= MAX_FRAME_BYTES * 1.4) continue
      const buffer = Buffer.from(item, "base64")
      if (buffer.length > 0 && buffer.length <= MAX_FRAME_BYTES) earlierFrames.push(buffer)
    }
  }
  return { record, frame, earlierFrames: earlierFrames.length ? earlierFrames : undefined }
}

/** Worker 批量上报命中记录；不依赖「链路审计模式」开关，容量由审计保留条数在落盘时强制。 */
export async function POST(request: Request) {
  const token = process.env.VIGIL_EDGE_TOKEN?.trim()
  if (token && request.headers.get("authorization") !== `Bearer ${token}`) {
    return NextResponse.json({ status: "error", message: "命中上报凭证无效", error: "UNAUTHORIZED" }, { status: 401 })
  }
  const body = (await request.json().catch(() => null)) as { records?: unknown[] } | null
  const incoming = Array.isArray(body?.records) ? body.records.slice(0, 100) : []
  const items: HitIngestItem[] = []
  const updates: HitUpdateItem[] = []
  for (const raw of incoming) {
    if (typeof raw !== "object" || raw === null) continue
    const r = raw as Record<string, unknown>
    if (r.update === true) {
      const id = text(r.id, 64)
      if (SAFE_ID.test(id)) {
        updates.push({ id, repeat: Math.max(1, Math.round(Number(r.repeat) || 1)), lastAt: isoOr(r.lastAt, new Date().toISOString()) })
      }
      continue
    }
    const item = sanitizeNew(r)
    if (item) items.push(item)
  }
  ingestHitRecords(items, updates)
  return NextResponse.json({ status: "ok", accepted: items.length, updated: updates.length })
}
