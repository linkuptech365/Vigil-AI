import { NextResponse } from "next/server"

import { getEngineInfo, installEngine, restartEngine } from "@/lib/stream-engine"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json({ status: "success", engine: await getEngineInfo() }, { headers: { "Cache-Control": "no-store" } })
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { action?: string }

  if (body.action === "install") {
    const result = await installEngine()
    if (!result.ok) {
      return NextResponse.json({ status: "error", message: `引擎安装失败：${result.output || "未知错误"}`, error: "INSTALL_FAILED" }, { status: 502 })
    }
    await restartEngine()
    return NextResponse.json({ status: "success", engine: await getEngineInfo(), output: result.output })
  }

  if (body.action === "restart") {
    await restartEngine()
    return NextResponse.json({ status: "success", engine: await getEngineInfo() })
  }

  return NextResponse.json({ status: "error", message: "action 只支持 install / restart", error: "BAD_ACTION" }, { status: 400 })
}
