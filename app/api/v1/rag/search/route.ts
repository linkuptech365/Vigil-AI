import { NextResponse } from "next/server"

import { ragStatus, searchRag, syncRagIndex } from "@/lib/ops/server/rag-indexer"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_QUERY_LENGTH = 200

export async function GET() {
  return NextResponse.json({ status: "success", index: ragStatus(syncRagIndex()) }, { headers: { "Cache-Control": "no-store" } })
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { query?: unknown; topK?: unknown } | null
  const query = typeof body?.query === "string" ? body.query.trim().slice(0, MAX_QUERY_LENGTH) : ""
  if (!query) return NextResponse.json({ status: "error", message: "请输入检索内容" }, { status: 400 })
  const topK = typeof body?.topK === "number" && body.topK > 0 ? Math.min(50, Math.floor(body.topK)) : 12
  return NextResponse.json(searchRag(query, topK), { headers: { "Cache-Control": "no-store" } })
}
