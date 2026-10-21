import type { ModelProfileInput } from "@/lib/vigil/model-registry"
import { isRecord } from "./rule-http"

/** 校验请求体并提取档案字段；失败时返回错误文案。 */
export function parseProfileInput(body: unknown): ModelProfileInput | string {
  if (!isRecord(body)) return "请求体必须是 JSON 对象"
  const input: ModelProfileInput = {}
  for (const field of ["name", "baseUrl", "apiKey", "modelName"] as const) {
    const value = body[field]
    if (value === undefined) continue
    if (typeof value !== "string") return `${field} 必须是字符串`
    input[field] = value
  }
  if (body.provider !== undefined) {
    if (typeof body.provider !== "string") return "provider 必须是字符串"
    input.provider = body.provider as ModelProfileInput["provider"]
  }
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") return "enabled 必须是布尔值"
    input.enabled = body.enabled
  }
  return input
}
