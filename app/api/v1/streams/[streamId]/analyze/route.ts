import { NextResponse } from "next/server"

import { analyzeStream, StreamAnalysisError } from "@/lib/ops/server/stream-analysis"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function POST(request: Request, { params }: { params: Promise<{ streamId: string }> }) {
  const { streamId } = await params
  const body = (await request.json().catch(() => ({}))) as { modelProfileId?: unknown; frameCount?: unknown }

  try {
    const outcome = await analyzeStream({
      streamId,
      source: "stream",
      frameCount: typeof body.frameCount === "number" ? body.frameCount : 4,
      modelProfileId: typeof body.modelProfileId === "string" ? body.modelProfileId : undefined,
      requestHost: request.headers.get("host"),
      signal: request.signal,
    })
    const { verdictDetail: _verdict, result: _result, ...payload } = outcome
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    if (error instanceof StreamAnalysisError) {
      return NextResponse.json({ status: "error", message: error.message, error: error.code }, { status: error.status })
    }
    console.error("[stream-analyze]", error)
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : "研判失败", error: "INTERNAL" }, { status: 500 })
  }
}
