import { NextResponse } from "next/server"

import { getStream } from "@/lib/storage/streams-store"
import { visionFetch, visionHealthy } from "@/lib/vision-engine"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_CONTENT = { status: 204, headers: { "Cache-Control": "no-store" } } as const

/**
 * 视觉服务生成的透明标注图层（检测框 / Track ID / 电子围栏 / 记忆锚点）。
 * 任何失败（视觉服务未就绪、通道暂无画面、超时）都返回 204：前端只是不绘制图层，底层视频不受影响。
 */
export async function GET(_request: Request, { params }: { params: Promise<{ streamId: string }> }) {
  const { streamId } = await params
  if (!getStream(streamId)) {
    return NextResponse.json({ status: "error", message: `通道 ${streamId} 不存在`, error: "STREAM_NOT_FOUND" }, { status: 404 })
  }
  if (!visionHealthy()) return new Response(null, NO_CONTENT)
  try {
    const response = await visionFetch(`/streams/${encodeURIComponent(streamId)}/overlay.png`, { timeoutMs: 4_000 })
    if (!response.ok) return new Response(null, NO_CONTENT)
    return new Response(await response.arrayBuffer(), { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } })
  } catch {
    return new Response(null, NO_CONTENT)
  }
}
