import type { SuppressResponse } from "@/lib/ops/rules-api-types"
import {
  defaultRuleForChannel,
  findRule,
  getSnapshot,
  isKnownChannel,
  registerTrigger,
} from "@/lib/ops/server/rule-engine"
import { jsonError, jsonOk, optionalString, readJsonBody, requiredString } from "@/lib/ops/server/rule-http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  return jsonOk(getSnapshot())
}

export async function POST(request: Request) {
  const body = await readJsonBody(request)
  if (!body.ok) return jsonError(400, "INVALID_JSON", body.message)

  const channelId = requiredString(body.value, "channelId", 32)
  if (!channelId.ok) return jsonError(400, "INVALID_REQUEST", channelId.message)
  if (!isKnownChannel(channelId.value)) {
    return jsonError(404, "CHANNEL_NOT_FOUND", `未知通道 ${channelId.value}`)
  }

  const ruleIdInput = optionalString(body.value, "ruleId", 32)
  if (!ruleIdInput.ok) return jsonError(400, "INVALID_REQUEST", ruleIdInput.message)

  let ruleId = ruleIdInput.value?.trim()
  if (ruleId) {
    if (!findRule(ruleId)) return jsonError(404, "RULE_NOT_FOUND", `规则 ${ruleId} 不存在`)
  } else {
    const fallback = defaultRuleForChannel(channelId.value)
    if (!fallback) {
      return jsonError(409, "NO_ACTIVE_RULE", `${channelId.value} 没有绑定已启用的规则，请先在规则目录中启用或绑定`)
    }
    ruleId = fallback.id
  }

  const outcome = registerTrigger(channelId.value, ruleId)
  const response: SuppressResponse = {
    ...outcome.status,
    isNewIncident: outcome.isNewIncident,
    suppressed: outcome.suppressed,
    metrics: outcome.metrics,
  }
  return jsonOk(response)
}
