import type { CreateRuleRequest, CreateRuleResponse, RulesListResponse } from "@/lib/ops/rules-api-types"
import type { RuleActionKey } from "@/lib/ops/rules-types"
import { createCustomRule, listRules } from "@/lib/ops/server/rule-engine"
import { isRecord, jsonError, jsonOk, readJsonBody, requiredString } from "@/lib/ops/server/rule-http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ACTION_KEYS: RuleActionKey[] = ["webhook", "dispatch", "siren"]

export async function GET() {
  const body: RulesListResponse = { rules: listRules() }
  return jsonOk(body)
}

export async function POST(request: Request) {
  const body = await readJsonBody(request)
  if (!body.ok) return jsonError(400, "INVALID_JSON", body.message)

  const name = requiredString(body.value, "name", 30)
  if (!name.ok) return jsonError(400, "INVALID_REQUEST", name.message)
  if (name.value.length < 2) return jsonError(400, "INVALID_REQUEST", "name 至少 2 个字符")

  const prompt = requiredString(body.value, "prompt", 500)
  if (!prompt.ok) return jsonError(400, "INVALID_REQUEST", prompt.message)
  if (prompt.value.length < 8) return jsonError(400, "INVALID_REQUEST", "prompt 至少 8 个字符")

  const sensitivity = body.value.sensitivity
  if (typeof sensitivity !== "number" || !Number.isFinite(sensitivity) || sensitivity < 0.6 || sensitivity > 0.95) {
    return jsonError(400, "INVALID_REQUEST", "sensitivity 必须是 0.6 到 0.95 之间的数字")
  }

  const rawActions = body.value.actions
  if (!isRecord(rawActions) || !ACTION_KEYS.every((key) => typeof rawActions[key] === "boolean")) {
    return jsonError(400, "INVALID_REQUEST", "actions 必须包含 webhook / dispatch / siren 三个布尔值")
  }

  const input: CreateRuleRequest = {
    name: name.value,
    prompt: prompt.value,
    sensitivity,
    actions: {
      webhook: rawActions.webhook as boolean,
      dispatch: rawActions.dispatch as boolean,
      siren: rawActions.siren as boolean,
    },
  }

  const rule = createCustomRule(input)
  const response: CreateRuleResponse = { rule, rules: listRules() }
  return jsonOk(response, 201)
}
