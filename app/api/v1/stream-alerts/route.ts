import { NextResponse } from "next/server"

import { loadAlerts } from "@/lib/storage/streams-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json({ status: "success", alerts: loadAlerts() }, { headers: { "Cache-Control": "no-store" } })
}
