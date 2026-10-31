import { NextResponse } from "next/server"

import { clearVlmCalls, queryVlmCalls } from "@/lib/storage/vlm-call-store"
import { VLM_CALL_TRIGGERS, type VlmCallStatus, type VlmCallTrigger } from "@/lib/vigil/vlm-call-log"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "no-store" }
const STATUSES: VlmCallStatus[] = ["alarm", "dismissed", "failed"]

function int(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  if (!value || !Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.floor(parsed)))
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const status = params.get("status")
  const trigger = params.get("trigger")
  const since = params.get("since")
  const payload = queryVlmCalls({
    limit: int(params.get("limit"), 50, 1, 200),
    offset: int(params.get("offset"), 0, 0, 100_000),
    status: STATUSES.includes(status as VlmCallStatus) ? (status as VlmCallStatus) : undefined,
    trigger: VLM_CALL_TRIGGERS.includes(trigger as VlmCallTrigger) ? (trigger as VlmCallTrigger) : undefined,
    streamId: params.get("streamId") || undefined,
    since: since && Number.isFinite(Date.parse(since)) ? since : undefined,
  })
  return NextResponse.json(payload, { headers: NO_STORE })
}

export async function DELETE() {
  clearVlmCalls()
  return NextResponse.json({ status: "ok" }, { headers: NO_STORE })
}
