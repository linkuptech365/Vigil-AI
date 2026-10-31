import { NextResponse } from "next/server"

import { listVlmCandidates } from "@/lib/ops/server/rag-indexer"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** 二级研判候选：一级初筛真实命中并已落库的告警，含留存的证据帧。 */
export async function GET() {
  return NextResponse.json({ status: "success", candidates: listVlmCandidates() }, { headers: { "Cache-Control": "no-store" } })
}
