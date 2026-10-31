import { NextResponse } from "next/server"

import type { HealthResponse } from "@/lib/ops/api-types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const body: HealthResponse = {
    status: "healthy",
    service: "Vigil-AI Gateway",
    version: "1.0.0",
    timestamp: Date.now(),
    uptime: Math.round(process.uptime() * 10) / 10,
  }

  return NextResponse.json(body, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  })
}
