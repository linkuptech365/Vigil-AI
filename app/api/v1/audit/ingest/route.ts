import { NextResponse } from "next/server"

import { upsertAuditRecords } from "@/lib/storage/audit-store"
import { loadVisionConfig } from "@/lib/storage/vision-store"
import type { AuditRuleDecision, AuditTier1Record, AuditTier1Outcome } from "@/lib/vigil/audit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const OUTCOMES: AuditTier1Outcome[] = ["escalated", "pending", "cooldown", "blocked", "no_suspect"]

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.slice(0, max) : ""
}

function sanitizeTier1(raw: unknown): AuditTier1Record | null {
  if (typeof raw !== "object" || raw === null) return null
  const r = raw as Record<string, unknown>
  const id = text(r.id, 64)
  const streamId = text(r.streamId, 128)
  const outcome = OUTCOMES.find((item) => item === r.outcome)
  if (!id || !streamId || !outcome) return null
  const at = typeof r.at === "string" && !Number.isNaN(Date.parse(r.at)) ? r.at : new Date().toISOString()
  return {
    kind: "tier1",
    id,
    at,
    streamId,
    outcome,
    alarm: outcome === "escalated",
    repeat: Math.max(1, Math.round(Number(r.repeat) || 1)),
    rawDetections: Array.isArray(r.rawDetections) ? (r.rawDetections.slice(0, 20) as AuditTier1Record["rawDetections"]) : [],
    decisions: Array.isArray(r.decisions) ? (r.decisions.slice(0, 40) as AuditRuleDecision[]) : [],
    reasons: Array.isArray(r.reasons) ? r.reasons.slice(0, 5).map((item) => text(item, 300)) : [],
    eventIds: Array.isArray(r.eventIds) ? r.eventIds.slice(0, 10).map((item) => text(item, 64)) : [],
  }
}

/** Worker 批量上报一级初筛逐帧审计记录；凭证与边缘触发接口一致。 */
export async function POST(request: Request) {
  const token = process.env.VIGIL_EDGE_TOKEN?.trim()
  if (token && request.headers.get("authorization") !== `Bearer ${token}`) {
    return NextResponse.json({ status: "error", message: "审计上报凭证无效", error: "UNAUTHORIZED" }, { status: 401 })
  }
  const body = (await request.json().catch(() => null)) as { records?: unknown[] } | null
  const records = (Array.isArray(body?.records) ? body.records.slice(0, 200) : [])
    .map(sanitizeTier1)
    .filter((record): record is AuditTier1Record => record !== null)
  if (!loadVisionConfig().auditMode) {
    return NextResponse.json({ status: "ok", accepted: 0, ignored: records.length })
  }
  upsertAuditRecords(records)
  return NextResponse.json({ status: "ok", accepted: records.length })
}
