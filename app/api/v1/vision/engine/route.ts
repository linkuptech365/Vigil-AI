import { jsonError, jsonOk, readJsonBody } from "@/lib/ops/server/rule-http"
import { getVisionInfo, installVisionEnv, restartVisionEngine, visionFetch } from "@/lib/vision-engine"
import { resetMotionFallbackStats } from "@/lib/vision-motion-fallback"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  return jsonOk(await getVisionInfo())
}

export async function POST(request: Request) {
  const body = await readJsonBody(request)
  if (!body.ok) return jsonError(400, "INVALID_JSON", body.message)
  const action = body.value.action

  if (action === "install") {
    const result = installVisionEnv({ light: body.value.light === true, cpu: body.value.cpu === true, gpu: body.value.gpu === true })
    return jsonOk({ ...result, engine: await getVisionInfo() }, result.started ? 202 : 200)
  }
  if (action === "restart") {
    await restartVisionEngine()
    return jsonOk({ started: true, message: "视觉服务已重启", engine: await getVisionInfo() })
  }
  if (action === "reset-stats") {
    resetMotionFallbackStats()
    await visionFetch("/stats/reset", { method: "POST" }).catch(() => null)
    return jsonOk({ started: true, message: "统计已清零", engine: await getVisionInfo() })
  }
  return jsonError(400, "INVALID_REQUEST", "action 只能是 install / restart / reset-stats")
}
