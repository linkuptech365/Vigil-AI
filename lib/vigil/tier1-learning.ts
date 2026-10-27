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

export type HotspotKind = "target" | "exclusion"

/** 带语义标签的微锚点：target 为规则关联目标点位，exclusion 为易混淆的相邻点位（如饮水点）。 */
export interface LearnedMicroHotspot {
  /** 形如 hotspot_food_tray */
  id: string
  kind: HotspotKind
  center: [number, number]
  radius: number
  description: string
  learnedAt: string
}

export const MAX_MICRO_HOTSPOTS = 6
export const MAX_EXCLUSIONS = 8
/** 误报反馈累计上调单条规则置信度门槛的上限 */
export const MAX_SENSITIVITY_BOOST = 0.2
const SENSITIVITY_STEP = 0.05

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
  /** 语义微锚点（旧数据缺省） */
  microHotspots?: LearnedMicroHotspot[]
  /** 误报反馈沉淀的负条件（排除场景），随每次二级研判注入提示词（旧数据缺省） */
  exclusions?: string[]
  /** 按规则累计的置信度门槛上调值（旧数据缺省） */
  sensitivityBoost?: Record<string, number>
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
  hotspotsChanged?: boolean
}

const HOTSPOT_ID = /^hotspot_[a-z0-9_]{2,32}$/

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

  if (Array.isArray(input.micro_hotspots)) {
    const seen = new Set<string>()
    const spots: NonNullable<Tier1Feedback["micro_hotspots"]> = []
    for (const raw of input.micro_hotspots) {
      if (!isRecord(raw) || spots.length >= MAX_MICRO_HOTSPOTS) continue
      const id = text(raw.id, 40).toLowerCase()
      const kind = raw.kind === "exclusion" ? "exclusion" : raw.kind === "target" ? "target" : null
      if (!kind || !HOTSPOT_ID.test(id) || seen.has(id) || !Array.isArray(raw.center) || raw.center.length !== 2) continue
      const [x, y] = raw.center.map(Number)
      const radius = Number(raw.radius)
      if (![x, y, radius].every(Number.isFinite)) continue
      seen.add(id)
      spots.push({
        id,
        kind,
        center: [Math.round(clamp(x, 0, 1000)), Math.round(clamp(y, 0, 1000))],
        radius: Math.round(clamp(radius, 20, 1000)),
        description: text(raw.description, 40) || id,
      })
    }
    if (spots.length > 0) feedback.micro_hotspots = spots
  }

  if (input.trigger_policy === "DUAL_INTERACTION" || input.trigger_policy === "ANCHOR_PROXIMITY") {
    feedback.trigger_policy = input.trigger_policy
  }

  return feedback.recommended_tags || feedback.spatial_hotspot || feedback.trigger_policy || feedback.micro_hotspots ? feedback : undefined
}

export function emptyLearning(streamId: string, now = new Date()): Tier1Learning {
  return {
    streamId,
    version: 0,
    updatedAt: now.toISOString(),
    tags: [],
    anchor: null,
    microHotspots: [],
    exclusions: [],
    sensitivityBoost: {},
    policy: "DUAL_INTERACTION",
    note: "初始词表",
    history: [],
  }
}

export function learningIsActive(learning: Tier1Learning | null | undefined) {
  return Boolean(
    learning &&
      (learning.tags.length > 0 ||
        learning.anchor ||
        (learning.microHotspots?.length ?? 0) > 0 ||
        (learning.exclusions?.length ?? 0) > 0)
  )
}

function snapshot(learning: Tier1Learning): Tier1LearningState {
  const { streamId: _streamId, history: _history, ...state } = learning
  return {
    ...state,
    tags: state.tags.map((tag) => ({ ...tag })),
    anchor: state.anchor ? { ...state.anchor } : null,
    microHotspots: (state.microHotspots ?? []).map((spot) => ({ ...spot })),
    exclusions: [...(state.exclusions ?? [])],
    sensitivityBoost: { ...(state.sensitivityBoost ?? {}) },
  }
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

  const microHotspots = (base.microHotspots ?? []).map((spot) => ({ ...spot }))
  let hotspotsChanged = false
  for (const item of feedback.micro_hotspots ?? []) {
    const next: LearnedMicroHotspot = { ...item, learnedAt: now.toISOString() }
    const index = microHotspots.findIndex((spot) => spot.id === item.id)
    if (index >= 0) {
      const old = microHotspots[index]
      const same =
        old.kind === next.kind &&
        Math.abs(old.center[0] - next.center[0]) <= 8 &&
        Math.abs(old.center[1] - next.center[1]) <= 8 &&
        Math.abs(old.radius - next.radius) <= 12
      if (!same) {
        microHotspots[index] = next
        hotspotsChanged = true
      }
    } else if (microHotspots.length < MAX_MICRO_HOTSPOTS) {
      microHotspots.push(next)
      hotspotsChanged = true
    }
  }

  let policy = base.policy
  if (feedback.trigger_policy && feedback.trigger_policy !== policy) {
    // 没有锚点就无法按锚点触发，忽略这种无法执行的策略建议
    if (feedback.trigger_policy === "DUAL_INTERACTION" || anchor) policy = feedback.trigger_policy
  }
  const policyChanged = policy !== base.policy

  const changed = addedTags.length > 0 || anchorUpdated || policyChanged || hotspotsChanged
  if (!changed) return { learning: base, changed, addedTags, skippedDuplicate, skippedByCap, anchorUpdated, policyChanged, hotspotsChanged }

  const parts: string[] = []
  if (addedTags.length > 0) parts.push(`新增 ${addedTags.map((tag) => tag.labelZh).join("、")}`)
  if (anchorUpdated && anchor) parts.push(`记忆热点「${anchor.description}」`)
  if (hotspotsChanged) parts.push(`微锚点 ${(feedback.micro_hotspots ?? []).map((spot) => spot.id).join("、")}`)
  if (policyChanged) parts.push(policy === "ANCHOR_PROXIMITY" ? "策略切换为锚点靠近触发" : "策略恢复为双目标重叠")

  return {
    learning: {
      streamId,
      version: base.version + 1,
      updatedAt: now.toISOString(),
      tags,
      anchor,
      microHotspots,
      exclusions: [...(base.exclusions ?? [])],
      sensitivityBoost: { ...(base.sensitivityBoost ?? {}) },
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
    hotspotsChanged,
  }
}

/** 清空学习内容，恢复初始词表；本次清空本身也会进入历史，可被回滚。 */
export function resetLearning(current: Tier1Learning | null, streamId: string, now = new Date()): Tier1Learning {
  const base = current ?? emptyLearning(streamId, now)
  if (!learningIsActive(base) && base.policy === "DUAL_INTERACTION" && Object.keys(base.sensitivityBoost ?? {}).length === 0) return base
  return {
    streamId,
    version: base.version + 1,
    updatedAt: now.toISOString(),
    tags: [],
    anchor: null,
    microHotspots: [],
    exclusions: [],
    sensitivityBoost: {},
    policy: "DUAL_INTERACTION",
    note: "已恢复初始词表并清除记忆锚点与误报负条件",
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
    microHotspots: (previous.microHotspots ?? []).map((spot) => ({ ...spot })),
    exclusions: [...(previous.exclusions ?? [])],
    sensitivityBoost: { ...(previous.sensitivityBoost ?? {}) },
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
  hotspots: Array<{ id: string; kind: HotspotKind; center: [number, number]; radius: number; description: string }>
}

export function toWorkerLearning(learning: Tier1Learning): WorkerLearning {
  return {
    version: learning.version,
    policy: learning.policy,
    tags: learning.tags.map(({ promptEn, labelZh, role, confidence }) => ({ promptEn, labelZh, role, confidence })),
    anchor: learning.anchor ? { center: learning.anchor.center, radius: learning.anchor.radius, description: learning.anchor.description } : null,
    hotspots: (learning.microHotspots ?? []).map(({ id, kind, center, radius, description }) => ({ id, kind, center, radius, description })),
  }
}

export interface FalsePositiveInput {
  ruleId?: string
  /** 误报的具体原因（如"猫在喝水而非进食"），会沉淀为该通道的负条件 */
  exclusion?: string
  /** 误报发生位置（0~1000），可选；提供时记为一个 exclusion 微锚点 */
  at?: { center: [number, number]; radius: number; description?: string }
}

export interface FalsePositiveMerge {
  learning: Tier1Learning
  changed: boolean
  exclusionAdded: boolean
  boostedTo: number | null
}

/**
 * 用户在告警面板标记误报后，把"负条件"沉淀到该通道：
 * 排除场景进入后续所有二级研判提示词，对应规则的置信度门槛小幅上调，误报位置记为排除微锚点。
 */
export function applyFalsePositive(current: Tier1Learning | null, streamId: string, input: FalsePositiveInput, now = new Date()): FalsePositiveMerge {
  const base = current ?? emptyLearning(streamId, now)
  const exclusions = [...(base.exclusions ?? [])]
  const sensitivityBoost = { ...(base.sensitivityBoost ?? {}) }
  const microHotspots = (base.microHotspots ?? []).map((spot) => ({ ...spot }))
  const parts: string[] = []

  const exclusion = text(input.exclusion, 80)
  let exclusionAdded = false
  if (exclusion && !exclusions.some((item) => item.toLowerCase() === exclusion.toLowerCase())) {
    exclusions.push(exclusion)
    if (exclusions.length > MAX_EXCLUSIONS) exclusions.shift()
    exclusionAdded = true
    parts.push(`负条件「${exclusion}」`)
  }

  let boostedTo: number | null = null
  if (input.ruleId) {
    const previous = sensitivityBoost[input.ruleId] ?? 0
    const next = Math.round(Math.min(MAX_SENSITIVITY_BOOST, previous + SENSITIVITY_STEP) * 100) / 100
    if (next !== previous) {
      sensitivityBoost[input.ruleId] = next
      boostedTo = next
      parts.push(`规则门槛 +${Math.round(next * 100)}%`)
    }
  }

  let hotspotAdded = false
  if (input.at && Number.isFinite(input.at.center[0]) && Number.isFinite(input.at.center[1])) {
    const center: [number, number] = [Math.round(clamp(input.at.center[0], 0, 1000)), Math.round(clamp(input.at.center[1], 0, 1000))]
    const duplicate = microHotspots.some(
      (spot) => spot.kind === "exclusion" && Math.abs(spot.center[0] - center[0]) <= 40 && Math.abs(spot.center[1] - center[1]) <= 40
    )
    if (!duplicate && microHotspots.length < MAX_MICRO_HOTSPOTS) {
      microHotspots.push({
        id: `hotspot_fp_${microHotspots.length + 1}`,
        kind: "exclusion",
        center,
        radius: Math.round(clamp(input.at.radius, 20, 400)),
        description: text(input.at.description, 40) || "误报点位",
        learnedAt: now.toISOString(),
      })
      hotspotAdded = true
      parts.push("误报点位")
    }
  }

  if (!exclusionAdded && boostedTo === null && !hotspotAdded) return { learning: base, changed: false, exclusionAdded, boostedTo }
  return {
    learning: {
      streamId,
      version: base.version + 1,
      updatedAt: now.toISOString(),
      tags: base.tags.map((tag) => ({ ...tag })),
      anchor: base.anchor ? { ...base.anchor } : null,
      microHotspots,
      exclusions,
      sensitivityBoost,
      policy: base.policy,
      note: `误报反馈：${parts.join("；")}`,
      history: pushHistory(base),
    },
    changed: true,
    exclusionAdded,
    boostedTo,
  }
}

export interface Tier1LearningResponse {
  status: "ok"
  learning: Record<string, Tier1Learning>
  /** 执行重置/回滚后，视觉服务热更新的结果 */
  reload?: { ok: boolean; reloadMs: number; message: string }
  /** 执行 merge 后的并入统计 */
  merge?: { added: number; skipped: number; reenabled: number; total: number }
}
