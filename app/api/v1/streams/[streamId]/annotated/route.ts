import { NextResponse } from "next/server"

import { getStream } from "@/lib/storage/streams-store"
import { visionFetch, visionHealthy } from "@/lib/vision-engine"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** 视觉服务最近一帧的标注图（检测框 + Track ID）。没有标注帧时返回 204，前端回退到原始画面。 */
export async function GET(_request: Request, { params }: { params: Promise<{ streamId: string }> }) {
  const { streamId } = await params
  if (!getStream(streamId)) return NextResponse.json({ status: "error", message: `通道 ${streamId} 不存在`, error: "STREAM_NOT_FOUND" }, { status: 404 })
  if (!visionHealthy()) return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } })
  try {
    const response = await visionFetch(`/streams/${encodeURIComponent(streamId)}/annotated.jpg`, { timeoutMs: 4_000 })
    if (!response.ok) return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } })
    return new Response(await response.arrayBuffer(), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" } })
  } catch {
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } })
  }
}
