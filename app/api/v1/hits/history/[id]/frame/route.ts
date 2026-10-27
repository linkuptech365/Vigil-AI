import { NextResponse } from "next/server"

import { readHitFrame } from "@/lib/storage/hit-history-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const frame = readHitFrame(id)
  if (!frame) return NextResponse.json({ status: "error", message: "该命中的截屏已被淘汰或不存在" }, { status: 404 })
  return new NextResponse(new Uint8Array(frame), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" },
  })
}
