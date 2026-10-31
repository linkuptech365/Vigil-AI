import { NextResponse } from "next/server"

import { RAG_CASE_FILTERS, type RagCaseFilter } from "@/lib/ops/rag-types"
import { listRagCases } from "@/lib/ops/server/rag-indexer"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const rawFilter = params.get("filter") ?? "all"
  if (!RAG_CASE_FILTERS.includes(rawFilter as RagCaseFilter)) {
    return NextResponse.json({ status: "error", message: "filter 仅支持 all / vlm / pending / archived" }, { status: 400 })
  }
  const rawLimit = Number(params.get("limit"))
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 100
  return NextResponse.json(listRagCases(rawFilter as RagCaseFilter, limit), { headers: { "Cache-Control": "no-store" } })
}
