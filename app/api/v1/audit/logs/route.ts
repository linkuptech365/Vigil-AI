import { NextResponse } from "next/server"

import { clearAuditRecords, queryAuditRecords } from "@/lib/storage/audit-store"
import { loadVisionConfig } from "@/lib/storage/vision-store"
import type { AuditLogsResponse } from "@/lib/vigil/audit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const kind = params.get("kind")
  const alarm = params.get("alarm")
  const limit = Math.min(500, Math.max(1, Math.round(Number(params.get("limit")) || 100)))
  const config = loadVisionConfig()
  const { records, counts } = queryAuditRecords({
    kind: kind === "tier1" || kind === "tier2" ? kind : undefined,
    streamId: params.get("streamId") || undefined,
    ruleId: params.get("ruleId") || undefined,
    alarm: alarm === "true" ? true : alarm === "false" ? false : undefined,
    limit,
  })
  const body: AuditLogsResponse = { status: "ok", enabled: config.auditMode, retention: config.auditRetention, counts, records }
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } })
}

export async function DELETE() {
  clearAuditRecords()
  return NextResponse.json({ status: "ok" })
}
