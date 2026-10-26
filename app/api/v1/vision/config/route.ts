import { jsonError, jsonOk, readJsonBody } from "@/lib/ops/server/rule-http"
import { loadVisionConfig, saveVisionConfig } from "@/lib/storage/vision-store"
import { getVisionInfo, pushConfig } from "@/lib/vision-engine"
import { sanitizeVisionConfig, type VisionConfigResponse } from "@/lib/vigil/vision"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const body: VisionConfigResponse = { status: "ok", config: loadVisionConfig(), engine: await getVisionInfo() }
  return jsonOk(body)
}

/** 保存并热更新：落盘后立即推送到 vision-worker，无需重启任何服务。 */
export async function PUT(request: Request) {
  const body = await readJsonBody(request)
  if (!body.ok) return jsonError(400, "INVALID_JSON", body.message)

  const config = sanitizeVisionConfig(body.value, loadVisionConfig())
  const hasTracked = config.vocabulary.some(
    (item) => item.enabled && (item.role === "anchor_person" || item.role === "subject_target")
  )
  if (!hasTracked) {
    return jsonError(400, "NO_ANCHOR", "词表中至少需要启用一个「主体锚点」或「行为主体」词条，否则无法分配 Track ID")
  }
  try {
    saveVisionConfig(config)
  } catch (error) {
    return jsonError(500, "WRITE_FAILED", `保存失败：${error instanceof Error ? error.message : "未知错误"}`)
  }
  const reload = (await pushConfig(true, config)) ?? undefined
  const response: VisionConfigResponse = { status: "ok", config, engine: await getVisionInfo(), reload }
  return jsonOk(response)
}
