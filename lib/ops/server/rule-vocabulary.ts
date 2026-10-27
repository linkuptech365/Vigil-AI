import { matchRulesForSource } from "@/lib/ops/rule-binding"
import type { InspectionRule } from "@/lib/ops/rules-types"
import { loadChannelPerception } from "@/lib/storage/channel-perception-store"
import { loadRules } from "@/lib/storage/rules-store"
import type { ActiveClass, ChannelRuleBinding, CompiledTag } from "@/lib/vigil/channel-perception"
import { BASELINE_VOCABULARY } from "@/lib/vigil/vision"

const WILDCARD = "*"

export function normalizeClass(text: string) {
  return text.split(/\s+/).filter(Boolean).join(" ").toLowerCase()
}

/** 通道当前生效的规则：已启用，且绑定了 ALL 或该通道。 */
export function activeRulesForChannel(channelId: string, rules: InspectionRule[] = loadRules()) {
  return matchRulesForSource(rules, { kind: "channel", channelId })
}

/** Active Vocabulary = Union(subject_classes + context_classes) over the channel's enabled rules. */
export function deriveChannelBinding(channelId: string, rules: InspectionRule[] = loadRules()): ChannelRuleBinding {
  const active = activeRulesForChannel(channelId, rules)
  const classes = new Map<string, ActiveClass>()
  let wildcard = false

  const add = (raw: string, kind: ActiveClass["kind"], rule: InspectionRule) => {
    const promptEn = normalizeClass(raw)
    if (!promptEn) return
    if (promptEn === WILDCARD) {
      wildcard = true
      return
    }
    const entry = classes.get(promptEn) ?? { promptEn, kind, ruleIds: [], ruleNames: [], inVocabulary: false, labelZh: promptEn }
    if (kind === "subject") entry.kind = "subject"
    if (!entry.ruleIds.includes(rule.id)) {
      entry.ruleIds.push(rule.id)
      entry.ruleNames.push(rule.name)
    }
    classes.set(promptEn, entry)
  }

  for (const rule of active) {
    const pipeline = rule.pipeline
    if (!pipeline) continue
    for (const cls of pipeline.perception_gate.subject_classes) add(cls, "subject", rule)
    for (const cls of pipeline.interaction_gate.context_classes ?? []) add(cls, "context", rule)
    // 手部姿态判定需要人体框计算腰线，与 Worker 的注入行为一致
    if (pipeline.perception_gate.hand_pose_filter === "HAND_ELEVATED") add("person", "subject", rule)
  }

  return {
    rules: active.map((rule) => ({ id: rule.id, name: rule.name, hasPipeline: Boolean(rule.pipeline) })),
    classes: [...classes.values()],
    wildcard,
  }
}

export interface RuleDerivedVocabulary {
  /** 下发给 Worker 的词条：只含被已启用规则引用的已编译词条 */
  tags: CompiledTag[]
  /** 已存储但未被任何已启用规则引用的孤儿词条 */
  orphans: CompiledTag[]
  binding: ChannelRuleBinding
  source: "rules" | "baseline"
}

export function deriveVocabulary(channelId: string, rules: InspectionRule[] = loadRules()): RuleDerivedVocabulary {
  const binding = deriveChannelBinding(channelId, rules)
  const stored = loadChannelPerception(channelId)?.compiled_tags ?? []
  const baseline = BASELINE_VOCABULARY.map((item) => ({ ...item }))

  if (binding.rules.length === 0) {
    // 没有任何启用规则：只保留基线锚点，历史编译词条全部视为孤儿
    return { tags: baseline, orphans: stored, binding, source: "baseline" }
  }

  const byKey = new Map(stored.map((tag) => [normalizeClass(tag.promptEn), tag]))
  const tags: CompiledTag[] = []
  for (const entry of binding.classes) {
    const stored = byKey.get(entry.promptEn)
    // 规则引用的类别即使没有已编译词条，也必须进入推理词表，否则会被静默丢弃导致一级模型“没有这个词”
    const tag: CompiledTag = stored ?? {
      id: `rule-${entry.promptEn.replace(/[^a-z0-9]+/g, "-")}`,
      labelZh: entry.promptEn,
      promptEn: entry.promptEn,
      role: entry.promptEn === "person" ? "anchor_person" : entry.kind === "subject" ? "subject_target" : "context_object",
      enabled: true,
    }
    entry.inVocabulary = Boolean(stored)
    entry.labelZh = tag.labelZh || entry.promptEn
    tags.push(tag)
  }
  if (binding.wildcard && !tags.some((tag) => tag.role === "anchor_person")) tags.unshift(baseline[0])

  const used = new Set(tags.map((tag) => normalizeClass(tag.promptEn)))
  const orphans = stored.filter((tag) => !used.has(normalizeClass(tag.promptEn)))
  return { tags, orphans, binding, source: "rules" }
}

/** 下发给 Worker 的通道规则绑定：Worker 用它做词表物理剔除与 Gate 0.5 校验。 */
export interface WorkerChannelRules {
  ruleIds: string[]
  classes: string[]
  wildcard: boolean
}

export function workerChannelRules(streamIds: string[], rules: InspectionRule[] = loadRules()): Record<string, WorkerChannelRules> {
  const out: Record<string, WorkerChannelRules> = {}
  for (const channelId of new Set(streamIds)) {
    const binding = deriveChannelBinding(channelId, rules)
    out[channelId] = {
      ruleIds: binding.rules.map((rule) => rule.id),
      classes: binding.classes.map((entry) => entry.promptEn),
      wildcard: binding.wildcard,
    }
  }
  return out
}
