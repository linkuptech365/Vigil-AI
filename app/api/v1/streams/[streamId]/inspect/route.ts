import { NextResponse } from "next/server"

import { getStream } from "@/lib/storage/streams-store"
import { ensureVisionEngine, pushConfig, visionFetch, visionHealthy } from "@/lib/vision-engine"
import { ensureEngine } from "@/lib/stream-engine"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

/** 对通道当前画面做一次完整的 Tier-0/1 检视（带标注图），用于调参时验证词表与阈值。 */
export async function POST(_request: Request, { params }: { params: Promise<{ streamId: string }> }) {
  const { streamId } = await params
  if (!getStream(streamId)) return NextResponse.json({ status: "error", message: `通道 ${streamId} 不存在`, error: "STREAM_NOT_FOUND" }, { status: 404 })

  await ensureEngine({ waitMs: 3_000 })
  await ensureVisionEngine({ waitMs: 3_000 })
  if (!visionHealthy()) {
    return NextResponse.json({ status: "error", message: "视觉初筛服务未运行，请先在配置中心安装并启动", error: "VISION_OFFLINE" }, { status: 503 })
  }
  await pushConfig()
  try {
    const response = await visionFetch(`/streams/${encodeURIComponent(streamId)}/inspect-once`, { method: "POST", timeoutMs: 45_000 })
    const body = await response.json().catch(() => null)
    if (!response.ok || !body) {
      const detail = typeof body?.detail === "string" ? body.detail : `视觉服务返回 HTTP ${response.status}`
      return NextResponse.json({ status: "error", message: detail, error: "INSPECT_FAILED" }, { status: 502 })
    }
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return NextResponse.json(
      { status: "error", message: error instanceof Error ? error.message : "检视失败", error: "INSPECT_FAILED" },
      { status: 502 }
    )
  }
}
