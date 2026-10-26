import { NextResponse } from "next/server"

import { analyzeStream, StreamAnalysisError, type ExploreHint } from "@/lib/ops/server/stream-analysis"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

function parseExploreHint(body: Record<string, unknown> | null): ExploreHint | undefined {
  if (!body?.explore) return undefined
  const hint = body.hint as Record<string, unknown> | null | undefined
  const center = Array.isArray(hint?.center) ? hint.center : []
  const x = Number(center[0])
  const y = Number(center[1])
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { center: [500, 500], radius: 150, subjectLabel: "目标" }
  const radius = Number(hint?.radius)
  return {
    center: [Math.min(1000, Math.max(0, x)), Math.min(1000, Math.max(0, y))],
    radius: Number.isFinite(radius) ? Math.min(1000, Math.max(20, radius)) : 150,
    subjectLabel: typeof hint?.subjectLabel === "string" ? hint.subjectLabel.slice(0, 40) : "目标",
  }
}

/** 边缘 AI 触发二次研判：边缘端发现疑似目标（trackId + 置信度），网关抓帧后交给 VLM 复核。 */
export async function POST(request: Request) {
  const token = process.env.VIGIL_EDGE_TOKEN?.trim()
  if (token && request.headers.get("authorization") !== `Bearer ${token}`) {
    return NextResponse.json({ status: "error", message: "边缘触发凭证无效", error: "UNAUTHORIZED" }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const streamId = typeof body?.streamId === "string" ? body.streamId : ""
  const trackId = typeof body?.trackId === "string" || typeof body?.trackId === "number" ? String(body.trackId) : ""
  const edgeConfidence = typeof body?.edgeConfidence === "number" ? body.edgeConfidence : NaN
  if (!streamId || !trackId || !Number.isFinite(edgeConfidence) || edgeConfidence < 0 || edgeConfidence > 1) {
    return NextResponse.json(
      { status: "error", message: "需要 streamId、trackId，以及 0~1 之间的 edgeConfidence", error: "BAD_BODY" },
      { status: 400 }
    )
  }
  const keyframes = Array.isArray(body?.keyframesBase64) ? (body.keyframesBase64 as unknown[]).filter((f): f is string => typeof f === "string") : []

  try {
    const outcome = await analyzeStream({
      streamId,
      source: "edge",
      frameCount: 3,
      providedFrames: keyframes.length ? keyframes : undefined,
      modelProfileId: typeof body?.modelProfileId === "string" ? body.modelProfileId : undefined,
      edge: { trackId, edgeConfidence, label: typeof body?.label === "string" ? body.label.slice(0, 60) : undefined },
      explore: parseExploreHint(body),
      requestHost: request.headers.get("host"),
      signal: request.signal,
    })
    const confirmed = outcome.verdict === "alert"
    return NextResponse.json({
      status: "success",
      verdict: confirmed ? "confirmed" : "rejected",
      /** 边缘高置信但 VLM 否决：值得回流做边缘模型的困难样本 */
      hardSample: !confirmed && edgeConfidence >= 0.8,
      trackId,
      edgeConfidence,
      summary: outcome.summary,
      vlmConfidence: outcome.confidence,
      ruleName: outcome.ruleName,
      alertId: outcome.alert?.id ?? null,
      model: outcome.model,
      engineSource: outcome.engineSource,
    })
  } catch (error) {
    if (error instanceof StreamAnalysisError) {
      return NextResponse.json({ status: "error", message: error.message, error: error.code }, { status: error.status })
    }
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : "研判失败", error: "INTERNAL" }, { status: 500 })
  }
}
