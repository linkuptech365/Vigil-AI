import { jsonError, jsonOk, readJsonBody } from "@/lib/ops/server/rule-http"
import { loadZones, sanitizeZones, saveZones } from "@/lib/storage/roi-store"
import { pushConfig } from "@/lib/vision-engine"
import type { RoiZone } from "@/lib/ops/perception-types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export interface RoiZonesResponse {
  status: "ok"
  zones: RoiZone[]
  /** 视觉服务是否已收到最新围栏（服务未启动时为 false，启动后会自动同步）。 */
  synced: boolean
  syncMessage?: string
}

export async function GET() {
  const body: RoiZonesResponse = { status: "ok", zones: loadZones(), synced: true }
  return jsonOk(body)
}

/** 整体覆盖保存围栏列表，并立即热更新到 vision-worker。 */
export async function PUT(request: Request) {
  const body = await readJsonBody(request)
  if (!body.ok) return jsonError(400, "INVALID_JSON", body.message)
  if (!Array.isArray(body.value.zones)) return jsonError(400, "INVALID_REQUEST", "zones 必须是数组")

  const zones = sanitizeZones(body.value.zones)
  try {
    saveZones(zones)
  } catch (error) {
    return jsonError(500, "WRITE_FAILED", `保存失败：${error instanceof Error ? error.message : "未知错误"}`)
  }
  const reload = await pushConfig(true)
  const response: RoiZonesResponse = {
    status: "ok",
    zones,
    synced: reload ? reload.ok : false,
    syncMessage: reload ? reload.message : "视觉服务未运行，启动后自动生效",
  }
  return jsonOk(response)
}
