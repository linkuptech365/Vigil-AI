import type { UpdateRuleRequest, UpdateRuleResponse } from "@/lib/ops/rules-api-types"
import { SCOPE_BINDINGS } from "@/lib/ops/rule-binding"
import { ALL_CHANNELS, COOLDOWN_OPTIONS } from "@/lib/ops/rules-data"
import type { RuleActionKey, RuleSchedule, RuleSeverity } from "@/lib/ops/rules-types"
import { listRules, updateRule } from "@/lib/ops/server/rule-engine"
import { isRecord, jsonError, jsonOk, readJsonBody } from "@/lib/ops/server/rule-http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ACTION_KEYS: RuleActionKey[] = ["webhook", "dispatch", "siren"]

const SEVERITIES: RuleSeverity[] = ["INFO", "WARNING", "CRITICAL"]
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
      return jsonError(400, "INVALID_REQUEST", "severity 必须是 INFO、WARNING 或 CRITICAL")
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
      boundChannels.every(
        (channel) =>
          typeof channel === "string" && (ALL_CHANNELS.includes(channel) || SCOPE_BINDINGS.includes(channel))
      )
    if (!valid) {
      return jsonError(400, "INVALID_REQUEST", "boundChannels 必须是机位 ID 或 ALL / LOCAL 的数组")
    }
    patch.boundChannels = Array.from(new Set(boundChannels as string[]))
  }

  const { description } = body.value
  if (description !== undefined) {
    const text = typeof description === "string" ? description.trim() : ""
    if (text.length < 4 || text.length > 400) {
      return jsonError(400, "INVALID_REQUEST", "description 必须是 4~400 字的文本")
    }
    patch.description = text
  }

  const { sensitivity, actions } = body.value
  if (sensitivity !== undefined) {
    if (typeof sensitivity !== "number" || !Number.isFinite(sensitivity) || sensitivity < 0.3 || sensitivity > 0.99) {
      return jsonError(400, "INVALID_REQUEST", "sensitivity 必须是 0.3~0.99 之间的数字")
    }
    patch.sensitivity = Math.round(sensitivity * 100) / 100
  }
  if (actions !== undefined) {
    if (!isRecord(actions) || ACTION_KEYS.some((key) => typeof actions[key] !== "boolean")) {
      return jsonError(400, "INVALID_REQUEST", "actions 必须同时包含 webhook / dispatch / siren 三个布尔值")
    }
    patch.actions = {
      webhook: actions.webhook as boolean,
      dispatch: actions.dispatch as boolean,
      siren: actions.siren as boolean,
    }
  }

  if (Object.keys(patch).length === 0) {
    return jsonError(400, "INVALID_REQUEST", "没有可更新的字段")
  }

  const rule = updateRule(id, patch)
  if (!rule) return jsonError(404, "RULE_NOT_FOUND", `规则 ${id} 不存在`)

  const response: UpdateRuleResponse = { rule, rules: listRules() }
  return jsonOk(response)
}
