import { NextResponse } from "next/server"

import { RAG_CASE_FILTERS, type RagCaseFilter } from "@/lib/ops/rag-types"
import { listRagCases, ragStatus, searchRag, syncRagIndex } from "@/lib/ops/server/rag-indexer"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_QUERY_LENGTH = 200

export async function GET() {
  return NextResponse.json({ status: "success", index: ragStatus(syncRagIndex()) }, { headers: { "Cache-Control": "no-store" } })
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { query?: unknown; topK?: unknown; all?: unknown; filter?: unknown; limit?: unknown }
    | null
  const query = typeof body?.query === "string" ? body.query.trim().slice(0, MAX_QUERY_LENGTH) : ""
  if (!query || body?.all === true) {
    const filter = RAG_CASE_FILTERS.includes(body?.filter as RagCaseFilter) ? (body?.filter as RagCaseFilter) : "all"
    const limit = typeof body?.limit === "number" && body.limit > 0 ? body.limit : 100
    return NextResponse.json(listRagCases(filter, limit), { headers: { "Cache-Control": "no-store" } })
  }
  const topK = typeof body?.topK === "number" && body.topK > 0 ? Math.min(50, Math.floor(body.topK)) : 12
  return NextResponse.json(searchRag(query, topK), { headers: { "Cache-Control": "no-store" } })
}
