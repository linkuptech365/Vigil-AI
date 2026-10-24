import { NextResponse } from "next/server"

import { readEvidenceFrame } from "@/lib/storage/streams-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_request: Request, { params }: { params: Promise<{ alertId: string; index: string }> }) {
  const { alertId, index } = await params
  const buffer = readEvidenceFrame(alertId, Number(index))
  if (!buffer) return NextResponse.json({ status: "error", message: "证据帧不存在", error: "FRAME_NOT_FOUND" }, { status: 404 })
  return new Response(new Uint8Array(buffer), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=31536000, immutable" },
  })
}
