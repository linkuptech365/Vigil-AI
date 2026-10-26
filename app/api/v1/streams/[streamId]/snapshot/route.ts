import { NextResponse } from "next/server"

import { getStream } from "@/lib/storage/streams-store"
import { ensureEngine, grabFrame } from "@/lib/stream-engine"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request, { params }: { params: Promise<{ streamId: string }> }) {
  const { streamId } = await params
  if (!getStream(streamId)) {
    return NextResponse.json({ status: "error", message: `通道 ${streamId} 不存在`, error: "STREAM_NOT_FOUND" }, { status: 404 })
  }
  await ensureEngine({ waitMs: 8_000 })
  try {
    const frame = await grabFrame(streamId, { width: 960, timeoutMs: 15_000, signal: request.signal })
    return new Response(new Uint8Array(frame.buffer), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store", "X-Latency-Ms": String(frame.latencyMs) },
    })
  } catch (error) {
    return NextResponse.json(
      { status: "error", message: error instanceof Error ? error.message : "抓帧失败", error: "STREAM_OFFLINE" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    )
  }
}
