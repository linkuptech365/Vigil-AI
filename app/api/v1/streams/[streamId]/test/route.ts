import { NextResponse } from "next/server"

import { getStream } from "@/lib/storage/streams-store"
import { ensureEngine, getEngineInfo, grabFrame } from "@/lib/stream-engine"
import type { StreamTestResult } from "@/lib/vigil/streams"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request, { params }: { params: Promise<{ streamId: string }> }) {
  const { streamId } = await params
  if (!getStream(streamId)) {
    return NextResponse.json({ status: "error", message: `通道 ${streamId} 不存在`, error: "STREAM_NOT_FOUND" }, { status: 404 })
  }
  await ensureEngine({ waitMs: 4_000 })
  const engine = await getEngineInfo()
  if (engine.engineStatus !== "running") {
    const result: StreamTestResult = { ok: false, latencyMs: 0, message: `流媒体引擎未就绪：${engine.message}` }
    return NextResponse.json(result)
  }
  const started = Date.now()
  try {
    const frame = await grabFrame(streamId, { width: 640, timeoutMs: 15_000, signal: request.signal })
    const result: StreamTestResult = {
      ok: true,
      latencyMs: frame.latencyMs,
      bytes: frame.buffer.length,
      message: `连通正常，首帧耗时 ${frame.latencyMs} ms（${(frame.buffer.length / 1024).toFixed(0)} KB）`,
    }
    return NextResponse.json(result)
  } catch (error) {
    const result: StreamTestResult = {
      ok: false,
      latencyMs: Date.now() - started,
      message: error instanceof Error ? error.message : "连通性测试失败",
    }
    return NextResponse.json(result)
  }
}
