import type { InspectionRule, RuleSeverity } from "./rules-types"

/** 通用绑定范围：ALL = 全部视频源（实时通道 + 本地视频），LOCAL = 本地导入/检索目录视频。 */
export const SOURCE_ALL = "ALL"
export const SOURCE_LOCAL = "LOCAL"
export const SCOPE_BINDINGS: readonly string[] = [SOURCE_ALL, SOURCE_LOCAL]

export type RuleSource = { kind: "local" } | { kind: "channel"; channelId: string }

const DEFAULT_SENSITIVITY: Record<InspectionRule["type"], number> = {
  GEOMETRIC: 0.5,
  THRESHOLD: 0.6,
  PROMPT_SEMANTIC: 0.7,
}

export const SEVERITY_RANK: Record<RuleSeverity, number> = { INFO: 0, WARNING: 1, CRITICAL: 2 }

export function ruleSensitivity(rule: Pick<InspectionRule, "type" | "sensitivity">) {
  return rule.sensitivity ?? DEFAULT_SENSITIVITY[rule.type]
}

/** VLM 语义判定依据：语义规则取 Prompt，确定性规则取逻辑说明，都缺失时退回规则名称。 */
export function ruleDescription(rule: Pick<InspectionRule, "name" | "prompt" | "logic">) {
  return (rule.prompt ?? rule.logic ?? "").trim() || rule.name
}

/** 纯几何确定性规则（电子围栏/绊线）由一级感知引擎判定，不应作为 Prompt 下发给 VLM。 */
export function isGeometricOnlyRule(rule: Pick<InspectionRule, "type" | "logic" | "prompt">) {
  if (rule.type === "GEOMETRIC") return true
  return !rule.prompt?.trim() && /不调用大模型/.test(rule.logic ?? "")
}

export function bindsSource(rule: Pick<InspectionRule, "boundChannels">, source: RuleSource) {
  if (rule.boundChannels.includes(SOURCE_ALL)) return true
  return source.kind === "local"
    ? rule.boundChannels.includes(SOURCE_LOCAL)
    : rule.boundChannels.includes(source.channelId)
}

/** 一级规则筛选：已启用，且绑定了 ALL / 当前机位 / LOCAL（本地视频）。 */
export function matchRulesForSource(rules: InspectionRule[], source: RuleSource) {
  return rules.filter((rule) => rule.enabled && bindsSource(rule, source))
}

export function bindingLabel(channel: string) {
  if (channel === SOURCE_ALL) return "全部视频源"
  if (channel === SOURCE_LOCAL) return "本地视频"
  return channel
}
