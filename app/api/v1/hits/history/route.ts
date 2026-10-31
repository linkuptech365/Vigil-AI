import { NextResponse } from "next/server"

import { clearHitRecords, queryHitRecords } from "@/lib/storage/hit-history-store"
import type { HitHistoryStatus } from "@/lib/vigil/hit-history"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const STATUSES: HitHistoryStatus[] = ["alarm", "blocked", "passed"]

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const status = STATUSES.find((item) => item === params.get("status"))
  const limit = Math.min(200, Math.max(1, Math.round(Number(params.get("limit")) || 50)))
  const offset = Math.max(0, Math.round(Number(params.get("offset")) || 0))
  const body = queryHitRecords({ streamId: params.get("streamId") || undefined, status, limit, offset })
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } })
}

export async function DELETE() {
  clearHitRecords()
  return NextResponse.json({ status: "ok" })
}
