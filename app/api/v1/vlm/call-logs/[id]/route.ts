import { NextResponse } from "next/server"

import { getVlmCall } from "@/lib/storage/vlm-call-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const record = getVlmCall(id)
  if (!record) return NextResponse.json({ status: "error", message: "调用记录不存在或已被淘汰" }, { status: 404 })
  return NextResponse.json({ status: "ok", record }, { headers: { "Cache-Control": "no-store" } })
}
