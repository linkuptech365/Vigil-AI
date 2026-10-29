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

/** 已失效绑定（通道被删除、或旧版硬编码 CAM-xx / 机器 ID）的统一展示文案，不暴露内部代号。 */
export const STALE_CHANNEL_LABEL = "已失效通道"

/** 通道 ID → 用户在监控流配置里设置的名称。 */
export type ChannelNames = ReadonlyMap<string, string>

/**
 * 绑定项的唯一展示依据：范围取固定文案，通道一律取用户设置的名称；
 * 找不到对应通道时显示「已失效通道」，绝不回显 CAM-01 或哈希 ID。
 */
export function bindingLabel(channel: string, names?: ChannelNames) {
  if (channel === SOURCE_ALL) return "全部视频源"
  if (channel === SOURCE_LOCAL) return "本地视频"
  return names?.get(channel) ?? STALE_CHANNEL_LABEL
}

/**
 * 绑定互斥规整：「全部视频源」与具体通道 / 本地视频不能并存。
 * 新勾选 ALL 时清空其余；在 ALL 已存在时再勾选其他项，则自动取消 ALL。
 */
export function normalizeBinding(previous: readonly string[], next: readonly string[]): string[] {
  const unique = Array.from(new Set(next))
  if (!unique.includes(SOURCE_ALL)) return unique
  if (unique.length === 1) return [SOURCE_ALL]
  return previous.includes(SOURCE_ALL) ? unique.filter((item) => item !== SOURCE_ALL) : [SOURCE_ALL]
}

/** 服务端兜底：没有「上一状态」可参考时，ALL 与其他项并存一律收敛为 ALL。 */
export function collapseBinding(channels: readonly string[]): string[] {
  const unique = Array.from(new Set(channels))
  return unique.includes(SOURCE_ALL) ? [SOURCE_ALL] : unique
}
