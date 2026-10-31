import type { RulesListResponse } from "@/lib/ops/rules-api-types"
import { applyGmpPreset } from "@/lib/ops/server/rule-engine"
import { jsonError, jsonOk } from "@/lib/ops/server/rule-http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST() {
  try {
    const body: RulesListResponse = { rules: applyGmpPreset() }
    return jsonOk(body)
  } catch (error) {
    console.error("[rules] 载入 GMP 预设写盘失败：", error)
    return jsonError(500, "PERSIST_FAILED", "规则写入数据目录失败，请检查 VIGIL_DATA_DIR 的写权限")
  }
}
