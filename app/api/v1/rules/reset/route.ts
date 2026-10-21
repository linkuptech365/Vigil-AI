import type { RulesListResponse } from "@/lib/ops/rules-api-types"
import { resetRules } from "@/lib/ops/server/rule-engine"
import { jsonError, jsonOk } from "@/lib/ops/server/rule-http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST() {
  try {
    const body: RulesListResponse = { rules: resetRules() }
    return jsonOk(body)
  } catch (error) {
    console.error("[rules] 恢复出厂规则写盘失败：", error)
    return jsonError(500, "PERSIST_FAILED", "规则写入数据目录失败，请检查 VIGIL_DATA_DIR 的写权限")
  }
}
