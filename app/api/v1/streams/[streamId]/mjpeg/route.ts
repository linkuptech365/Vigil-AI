import { NextResponse } from "next/server"

import { getStream } from "@/lib/storage/streams-store"
import { engineFetch, ensureEngine, markProbe } from "@/lib/stream-engine"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** 把内置引擎的 MJPEG 流反代给浏览器：浏览器只访问网关同源地址，引擎端口不对外暴露。 */
export async function GET(request: Request, { params }: { params: Promise<{ streamId: string }> }) {
  const { streamId } = await params
  if (!getStream(streamId)) {
    return NextResponse.json({ status: "error", message: `通道 ${streamId} 不存在`, error: "STREAM_NOT_FOUND" }, { status: 404 })
  }
  await ensureEngine({ waitMs: 8_000 })

  try {
    // 只限制“等到响应头”的时间；摄像机关键帧间隔可达数秒，首帧给足 20 秒，响应头之后不再设读取超时
    const upstream = await engineFetch(`/api/stream.mjpeg?${new URLSearchParams({ src: streamId })}`, {
      signal: request.signal,
      timeoutMs: 20_000,
    })
    if (!upstream.ok || !upstream.body) throw new Error(`引擎返回 HTTP ${upstream.status}`)
    markProbe(streamId, true)
    return new Response(upstream.body, {
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "multipart/x-mixed-replace; boundary=frame",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
      },
    })
  } catch (error) {
    const aborted = request.signal.aborted
    if (!aborted) markProbe(streamId, false)
    return NextResponse.json(
      { status: "error", message: error instanceof Error ? error.message : "视频流不可用", error: "STREAM_OFFLINE" },
      { status: aborted ? 499 : 503 }
    )
  }
}
