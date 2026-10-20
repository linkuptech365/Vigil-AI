import type { RuleEvaluateRequest } from "@/lib/ops/rules-api-types"
import { evaluateRules } from "@/lib/ops/server/rule-engine"
import {
  jsonError,
  jsonOk,
  optionalCoords,
  optionalString,
  optionalTimestamp,
  readJsonBody,
  requiredString,
} from "@/lib/ops/server/rule-http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const TARGET_CLASSES = ["person", "vehicle", "forklift"]

export async function POST(request: Request) {
  const body = await readJsonBody(request)
  if (!body.ok) return jsonError(400, "INVALID_JSON", body.message)

  const channelId = requiredString(body.value, "channelId", 32)
  if (!channelId.ok) return jsonError(400, "INVALID_REQUEST", channelId.message)

  const ruleId = optionalString(body.value, "ruleId", 32)
  if (!ruleId.ok) return jsonError(400, "INVALID_REQUEST", ruleId.message)

  const targetCoords = optionalCoords(body.value, "targetCoords")
  if (!targetCoords.ok) return jsonError(400, "INVALID_REQUEST", targetCoords.message)

  const previousCoords = optionalCoords(body.value, "previousCoords")
  if (!previousCoords.ok) return jsonError(400, "INVALID_REQUEST", previousCoords.message)

  const targetClass = optionalString(body.value, "targetClass", 32)
  if (!targetClass.ok) return jsonError(400, "INVALID_REQUEST", targetClass.message)
  if (targetClass.value !== undefined && !TARGET_CLASSES.includes(targetClass.value)) {
    return jsonError(400, "INVALID_REQUEST", `targetClass 必须是 ${TARGET_CLASSES.join(" / ")} 之一`)
  }

  const scenarioText = optionalString(body.value, "scenarioText", 2000)
  if (!scenarioText.ok) return jsonError(400, "INVALID_REQUEST", scenarioText.message)

  const timestamp = optionalTimestamp(body.value, "timestamp")
  if (!timestamp.ok) return jsonError(400, "INVALID_REQUEST", timestamp.message)

  const confidence = body.value.confidence
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 100) {
    return jsonError(400, "INVALID_REQUEST", "confidence 必须是 0~1 或 0~100 的数字")
  }

  const input: RuleEvaluateRequest = {
    channelId: channelId.value,
    ruleId: ruleId.value || undefined,
    targetCoords: targetCoords.value,
    previousCoords: previousCoords.value,
    targetClass: targetClass.value,
    confidence,
    scenarioText: scenarioText.value,
    timestamp: timestamp.value,
  }

  const outcome = evaluateRules(input)
  if (!outcome.ok) return jsonError(outcome.status, outcome.code, outcome.error)
  return jsonOk(outcome.response)
}
