import { NextResponse } from "next/server"

import { loadAlerts, loadRecords } from "@/lib/storage/streams-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const alerts = loadAlerts()
  const records = loadRecords().slice(0, 60)
  return NextResponse.json({ status: "success", alerts, records }, { headers: { "Cache-Control": "no-store" } })
}
