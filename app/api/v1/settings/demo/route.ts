import { jsonError, jsonOk, readJsonBody } from "@/lib/ops/server/rule-http"
import { applyDemoMode } from "@/lib/ops/server/rule-engine"
import { binaryReady, restartEngine } from "@/lib/stream-engine"
import { isDemoEnabled, setDemoEnabled } from "@/lib/storage/demo-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  return jsonOk({ status: "ok", enabled: isDemoEnabled() })
}

export async function PUT(request: Request) {
  const body = await readJsonBody(request)
  if (!body.ok) return jsonError(400, "INVALID_JSON", body.message)
  if (typeof body.value.enabled !== "boolean") {
    return jsonError(400, "INVALID_ENABLED", "enabled 必须是布尔值")
  }
  try {
    setDemoEnabled(body.value.enabled)
    applyDemoMode(body.value.enabled)
    if (binaryReady()) void restartEngine().catch(() => undefined)
  } catch (error) {
    return jsonError(500, "WRITE_FAILED", `保存失败：${error instanceof Error ? error.message : "未知错误"}`)
  }
  return jsonOk({ status: "ok", enabled: body.value.enabled })
}
