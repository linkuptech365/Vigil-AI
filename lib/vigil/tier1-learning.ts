import type { Tier1Feedback, Tier1TriggerPolicy } from "@/lib/ops/types"
import { PROMPT_PATTERN, type VocabularyItem } from "@/lib/vigil/vision"

/** 单通道最多自扩充的候选词数量，避免词表膨胀拖慢 YOLO-World 推理。 */
export const MAX_LEARNED_TAGS = 6
export const MAX_LEARNING_HISTORY = 10
const MAX_FEEDBACK_TAGS = 6

export type LearnedRole = "subject_target" | "context_object"

export interface LearnedTag {
  promptEn: string
  labelZh: string
  role: LearnedRole
  /** 该词条独立的置信度门槛（0.2 ~ 0.6） */
  confidence: number
  learnedAt: string
}

export interface LearnedAnchor {
  /** 归一化坐标 0~1000 */
  center: [number, number]
  radius: number
  description: string
  learnedAt: string
}

/** 某一版本的学习内容快照 */
export interface Tier1LearningState {
  version: number
  updatedAt: string
  tags: LearnedTag[]
  anchor: LearnedAnchor | null
  policy: Tier1TriggerPolicy
  /** 本次变更的简述，便于在界面上展示与回滚时识别 */
  note: string
}

export interface Tier1Learning extends Tier1LearningState {
  streamId: string
  history: Tier1LearningState[]
}

export interface Tier1MergeResult {
  learning: Tier1Learning
  changed: boolean
  addedTags: LearnedTag[]
  skippedDuplicate: number
  skippedByCap: number
  anchorUpdated: boolean
  policyChanged: boolean
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : ""
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** 校验并规整 VLM 输出的 tier1_feedback：任何不合规的部分都会被丢弃而不是抛错。 */
export function sanitizeTier1Feedback(input: unknown): Tier1Feedback | undefined {
  if (!isRecord(input)) return undefined
  const feedback: Tier1Feedback = {}

  if (Array.isArray(input.recommended_tags)) {
    const seen = new Set<string>()
    const tags: NonNullable<Tier1Feedback["recommended_tags"]> = []
    for (const raw of input.recommended_tags) {
      if (!isRecord(raw) || tags.length >= MAX_FEEDBACK_TAGS) continue
      const tag = text(raw.tag, 64)
      const role = raw.role === "subject_target" || raw.role === "context_object" ? raw.role : null
      if (!role || !PROMPT_PATTERN.test(tag) || seen.has(tag.toLowerCase())) continue
      seen.add(tag.toLowerCase())
      const threshold = typeof raw.confidence_threshold === "number" && Number.isFinite(raw.confidence_threshold) ? raw.confidence_threshold : 0.3
      tags.push({
        tag,
        zh_name: text(raw.zh_name, 24) || tag,
        role,
        confidence_threshold: Math.round(clamp(threshold, 0.2, 0.6) * 100) / 100,
      })
    }
    if (tags.length > 0) feedback.recommended_tags = tags
  }

  const hotspot = input.spatial_hotspot
  if (isRecord(hotspot) && Array.isArray(hotspot.center) && hotspot.center.length === 2) {
    const [x, y] = hotspot.center.map(Number)
    const radius = Number(hotspot.radius)
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(radius)) {
      feedback.spatial_hotspot = {
        center: [Math.round(clamp(x, 0, 1000)), Math.round(clamp(y, 0, 1000))],
        radius: Math.round(clamp(radius, 20, 1000)),
        description: text(hotspot.description, 40) || "记忆热点",
      }
    }
  }

  if (input.trigger_policy === "DUAL_INTERACTION" || input.trigger_policy === "ANCHOR_PROXIMITY") {
    feedback.trigger_policy = input.trigger_policy
  }

  return feedback.recommended_tags || feedback.spatial_hotspot || feedback.trigger_policy ? feedback : undefined
}

export function emptyLearning(streamId: string, now = new Date()): Tier1Learning {
  return {
    streamId,
    version: 0,
    updatedAt: now.toISOString(),
    tags: [],
    anchor: null,
    policy: "DUAL_INTERACTION",
    note: "初始词表",
    history: [],
  }
}

export function learningIsActive(learning: Tier1Learning | null | undefined) {
  return Boolean(learning && (learning.tags.length > 0 || learning.anchor))
}

function snapshot(learning: Tier1Learning): Tier1LearningState {
  const { streamId: _streamId, history: _history, ...state } = learning
  return { ...state, tags: state.tags.map((tag) => ({ ...tag })), anchor: state.anchor ? { ...state.anchor } : null }
}

function pushHistory(learning: Tier1Learning): Tier1LearningState[] {
  return [...learning.history, snapshot(learning)].slice(-MAX_LEARNING_HISTORY)
}

function sameAnchor(a: LearnedAnchor | null, b: LearnedAnchor | null) {
  if (!a || !b) return a === b
  return Math.abs(a.center[0] - b.center[0]) <= 8 && Math.abs(a.center[1] - b.center[1]) <= 8 && Math.abs(a.radius - b.radius) <= 12
}

/**
 * 把 VLM 的反馈合并进该通道的学习状态。
 * 去重（对照基础词表与已学词条）、受 MAX_LEARNED_TAGS 约束、锚点只保留最新一个；无实质变化时不升版本号。
 */
export function mergeTier1Feedback(
  current: Tier1Learning | null,
  streamId: string,
  feedback: Tier1Feedback,
  baseVocabulary: VocabularyItem[],
  now = new Date()
): Tier1MergeResult {
  const base = current ?? emptyLearning(streamId, now)
  const known = new Set(baseVocabulary.map((item) => item.promptEn.trim().toLowerCase()))
  for (const tag of base.tags) known.add(tag.promptEn.toLowerCase())

  const tags = base.tags.map((tag) => ({ ...tag }))
  const addedTags: LearnedTag[] = []
  let skippedDuplicate = 0
  let skippedByCap = 0
  for (const item of feedback.recommended_tags ?? []) {
    const key = item.tag.toLowerCase()
    if (known.has(key)) {
      skippedDuplicate += 1
      continue
    }
    if (tags.length >= MAX_LEARNED_TAGS) {
      skippedByCap += 1
      continue
    }
    known.add(key)
    const learned: LearnedTag = {
      promptEn: item.tag,
      labelZh: item.zh_name,
      role: item.role,
      confidence: item.confidence_threshold,
      learnedAt: now.toISOString(),
    }
    tags.push(learned)
    addedTags.push(learned)
  }

  let anchor = base.anchor
  let anchorUpdated = false
  if (feedback.spatial_hotspot) {
    const next: LearnedAnchor = { ...feedback.spatial_hotspot, learnedAt: now.toISOString() }
    if (!sameAnchor(anchor, next)) {
      anchor = next
      anchorUpdated = true
    }
  }

  let policy = base.policy
  if (feedback.trigger_policy && feedback.trigger_policy !== policy) {
    // 没有锚点就无法按锚点触发，忽略这种无法执行的策略建议
    if (feedback.trigger_policy === "DUAL_INTERACTION" || anchor) policy = feedback.trigger_policy
  }
  const policyChanged = policy !== base.policy

  const changed = addedTags.length > 0 || anchorUpdated || policyChanged
  if (!changed) return { learning: base, changed, addedTags, skippedDuplicate, skippedByCap, anchorUpdated, policyChanged }

  const parts: string[] = []
  if (addedTags.length > 0) parts.push(`新增 ${addedTags.map((tag) => tag.labelZh).join("、")}`)
  if (anchorUpdated && anchor) parts.push(`记忆热点「${anchor.description}」`)
  if (policyChanged) parts.push(policy === "ANCHOR_PROXIMITY" ? "策略切换为锚点靠近触发" : "策略恢复为双目标重叠")

  return {
    learning: {
      streamId,
      version: base.version + 1,
      updatedAt: now.toISOString(),
      tags,
      anchor,
      policy,
      note: parts.join("；"),
      history: pushHistory(base),
    },
    changed,
    addedTags,
    skippedDuplicate,
    skippedByCap,
    anchorUpdated,
    policyChanged,
  }
}

/** 清空学习内容，恢复初始词表；本次清空本身也会进入历史，可被回滚。 */
export function resetLearning(current: Tier1Learning | null, streamId: string, now = new Date()): Tier1Learning {
  const base = current ?? emptyLearning(streamId, now)
  if (!learningIsActive(base) && base.policy === "DUAL_INTERACTION") return base
  return {
    streamId,
    version: base.version + 1,
    updatedAt: now.toISOString(),
    tags: [],
    anchor: null,
    policy: "DUAL_INTERACTION",
    note: "已恢复初始词表并清除记忆锚点",
    history: pushHistory(base),
  }
}

/** 回滚到上一个历史快照；没有可回滚的历史时返回 null。版本号继续递增，不复用旧编号。 */
export function rollbackLearning(current: Tier1Learning | null, streamId: string, now = new Date()): Tier1Learning | null {
  if (!current || current.history.length === 0) return null
  const previous = current.history[current.history.length - 1]
  return {
    streamId,
    version: current.version + 1,
    updatedAt: now.toISOString(),
    tags: previous.tags.map((tag) => ({ ...tag })),
    anchor: previous.anchor ? { ...previous.anchor } : null,
    policy: previous.policy,
    note: `已回滚至 v${previous.version}`,
    history: current.history.slice(0, -1),
  }
}

/** 下发给 vision-worker 的精简结构 */
export interface WorkerLearning {
  version: number
  policy: Tier1TriggerPolicy
  tags: Array<{ promptEn: string; labelZh: string; role: LearnedRole; confidence: number }>
  anchor: { center: [number, number]; radius: number; description: string } | null
}

export function toWorkerLearning(learning: Tier1Learning): WorkerLearning {
  return {
    version: learning.version,
    policy: learning.policy,
    tags: learning.tags.map(({ promptEn, labelZh, role, confidence }) => ({ promptEn, labelZh, role, confidence })),
    anchor: learning.anchor ? { center: learning.anchor.center, radius: learning.anchor.radius, description: learning.anchor.description } : null,
  }
}

export interface Tier1LearningResponse {
  status: "ok"
  learning: Record<string, Tier1Learning>
  /** 执行重置/回滚后，视觉服务热更新的结果 */
  reload?: { ok: boolean; reloadMs: number; message: string }
}
