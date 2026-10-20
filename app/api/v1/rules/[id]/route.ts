import type { UpdateRuleRequest, UpdateRuleResponse } from "@/lib/ops/rules-api-types"
import { ALL_CHANNELS, COOLDOWN_OPTIONS } from "@/lib/ops/rules-data"
import type { RuleSchedule, RuleSeverity } from "@/lib/ops/rules-types"
import { listRules, updateRule } from "@/lib/ops/server/rule-engine"
import { jsonError, jsonOk, readJsonBody } from "@/lib/ops/server/rule-http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const SEVERITIES: RuleSeverity[] = ["WARNING", "CRITICAL"]
const SCHEDULES: RuleSchedule[] = ["24x7", "NIGHT_ONLY", "WORK_HOURS"]

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params

  const body = await readJsonBody(request)
  if (!body.ok) return jsonError(400, "INVALID_JSON", body.message)

  const patch: UpdateRuleRequest = {}
  const { enabled, severity, cooldownSeconds, schedule, boundChannels } = body.value

  if (enabled !== undefined) {
    if (typeof enabled !== "boolean") return jsonError(400, "INVALID_REQUEST", "enabled 必须是布尔值")
    patch.enabled = enabled
  }
  if (severity !== undefined) {
    if (!SEVERITIES.includes(severity as RuleSeverity)) {
      return jsonError(400, "INVALID_REQUEST", "severity 必须是 WARNING 或 CRITICAL")
    }
    patch.severity = severity as RuleSeverity
  }
  if (cooldownSeconds !== undefined) {
    if (!(COOLDOWN_OPTIONS as readonly number[]).includes(cooldownSeconds as number)) {
      return jsonError(400, "INVALID_REQUEST", `cooldownSeconds 必须是 ${COOLDOWN_OPTIONS.join(" / ")} 之一`)
    }
    patch.cooldownSeconds = cooldownSeconds as number
  }
  if (schedule !== undefined) {
    if (!SCHEDULES.includes(schedule as RuleSchedule)) {
      return jsonError(400, "INVALID_REQUEST", `schedule 必须是 ${SCHEDULES.join(" / ")} 之一`)
    }
    patch.schedule = schedule as RuleSchedule
  }
  if (boundChannels !== undefined) {
    const valid =
      Array.isArray(boundChannels) &&
      boundChannels.every((channel) => typeof channel === "string" && ALL_CHANNELS.includes(channel))
    if (!valid) return jsonError(400, "INVALID_REQUEST", "boundChannels 必须是已知通道 ID 的数组")
    patch.boundChannels = Array.from(new Set(boundChannels as string[]))
  }

  if (Object.keys(patch).length === 0) {
    return jsonError(400, "INVALID_REQUEST", "没有可更新的字段")
  }

  const rule = updateRule(id, patch)
  if (!rule) return jsonError(404, "RULE_NOT_FOUND", `规则 ${id} 不存在`)

  const response: UpdateRuleResponse = { rule, rules: listRules() }
  return jsonOk(response)
}
