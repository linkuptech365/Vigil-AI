import type { StormResponse, StormTrigger } from "@/lib/ops/rules-api-types"
import {
  defaultRuleForChannel,
  findRule,
  getMetrics,
  getWindowStatus,
  isKnownChannel,
  registerTrigger,
} from "@/lib/ops/server/rule-engine"
import {
  jsonError,
  jsonOk,
  optionalNumber,
  optionalString,
  readJsonBody,
  requiredString,
} from "@/lib/ops/server/rule-http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const DEFAULT_COUNT = 6
const DEFAULT_SPACING_MS = 500

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
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

  const count = optionalNumber(body.value, "count", 2, 20)
  if (!count.ok) return jsonError(400, "INVALID_REQUEST", count.message)

  const spacing = optionalNumber(body.value, "spacingMs", 0, 1500)
  if (!spacing.ok) return jsonError(400, "INVALID_REQUEST", spacing.message)

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

  const total = Math.round(count.value ?? DEFAULT_COUNT)
  const spacingMs = Math.round(spacing.value ?? DEFAULT_SPACING_MS)
  const startedAt = Date.now()
  const triggers: StormTrigger[] = []

  for (let seq = 1; seq <= total; seq++) {
    if (seq > 1 && spacingMs > 0) await sleep(spacingMs)
    const now = Date.now()
    const outcome = registerTrigger(channelId.value, ruleId, now)
    triggers.push({
      seq,
      isNewIncident: outcome.isNewIncident,
      suppressed: outcome.suppressed,
      incidentId: outcome.status.incidentId ?? "",
      offsetMs: now - startedAt,
    })
  }

  const finishedAt = Date.now()
  const status = getWindowStatus(channelId.value, ruleId, finishedAt)
  const incidentsCreated = triggers.filter((t) => t.isNewIncident).length

  const response: StormResponse = {
    channelId: channelId.value,
    ruleId,
    total,
    incidentsCreated,
    suppressedCount: total - incidentsCreated,
    foldedIntoExisting: incidentsCreated === 0,
    primaryIncidentId: triggers[0].incidentId,
    cooldownRemainingSec: status.cooldownRemainingSec,
    elapsedMs: finishedAt - startedAt,
    triggers,
    status,
    metrics: getMetrics(),
  }
  return jsonOk(response)
}
