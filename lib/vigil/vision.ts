import { auditRetentionOf, DEFAULT_AUDIT_RETENTION } from "./audit"

export type VisionRole = "anchor_person" | "required_ppe" | "hazard_target" | "subject_target" | "context_object"

export const VISION_ROLES: { id: VisionRole; label: string; hint: string }[] = [
  { id: "anchor_person", label: "主体锚点", hint: "画面中的人员，用于分配 Track ID 并关联其余目标" },
  { id: "required_ppe", label: "必需劳保", hint: "必须穿戴的装备，缺失即视为疑似违规" },
  { id: "hazard_target", label: "违规目标", hint: "一旦出现就视为疑似违规的物体或行为" },
  { id: "subject_target", label: "行为主体", hint: "行为的发起者（如猫、狗）；与「关联物体」空间靠近或框重叠时判为疑似" },
  { id: "context_object", label: "关联物体", hint: "行为发生的对象或场所（如喂食器、食盆、猫粮）；单独出现不触发" },
]

const ROLE_IDS: VisionRole[] = VISION_ROLES.map((role) => role.id)

export function visionRoleLabel(role: string) {
  return VISION_ROLES.find((item) => item.id === role)?.label ?? role
}

export interface VocabularyItem {
  id: string
  labelZh: string
  promptEn: string
  role: VisionRole
  enabled: boolean
}

export interface VisionConfig {
  enabled: boolean
  sampleFps: number
  motionThresholdPct: number
  confidenceLow: number
  confidenceHigh: number
  minConsecutiveFrames: number
  cooldownSeconds: number
  staticRecheckSeconds: number
  /** 链路审计模式：开启后一级门禁拦截 / 二级研判放行的每一帧都完整留痕，用于漏报排查与模型调优 */
  auditMode: boolean
  /** 非报警审计记录最多保留条数 */
  auditRetention: number
  /** 低照度增强：off 关闭；adaptive 仅对暗区轻量提亮（默认）；clahe 全画幅直方图均衡（旧版） */
  lowLightMode: LowLightMode
}

export type LowLightMode = "off" | "adaptive" | "clahe"
export const LOW_LIGHT_MODES: readonly LowLightMode[] = ["off", "adaptive", "clahe"]

/**
 * 未配置专属词表的通道使用的最小基线：只保留一个人员锚点用于分配 Track ID，
 * 不携带任何业务含义的检测词。检测词表全部归属通道，系统不再维护全局词表。
 */
export const BASELINE_VOCABULARY: VocabularyItem[] = [
  { id: "baseline-person", labelZh: "人员", promptEn: "person", role: "anchor_person", enabled: true },
]

export const DEFAULT_VISION_CONFIG: VisionConfig = {
  enabled: true,
  sampleFps: 2,
  motionThresholdPct: 1.5,
  confidenceLow: 0.4,
  confidenceHigh: 0.85,
  minConsecutiveFrames: 3,
  cooldownSeconds: 30,
  staticRecheckSeconds: 10,
  auditMode: false,
  auditRetention: DEFAULT_AUDIT_RETENTION,
  lowLightMode: "adaptive",
}

/** 仅作异常保护（防止误操作写入海量词条）；日常使用可视为不设上限。 */
export const MAX_VOCABULARY = 300
export const PROMPT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ,'\-/]{1,63}$/

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

export function sanitizeVocabulary(input: unknown): VocabularyItem[] | null {
  if (!Array.isArray(input)) return null
  const seen = new Set<string>()
  const result: VocabularyItem[] = []
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null) continue
    const item = raw as Record<string, unknown>
    const promptEn = typeof item.promptEn === "string" ? item.promptEn.replace(/\s+/g, " ").trim() : ""
    const role = item.role
    if (!PROMPT_PATTERN.test(promptEn)) continue
    if (typeof role !== "string" || !ROLE_IDS.includes(role as VisionRole)) continue
    const key = promptEn.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const labelZh = typeof item.labelZh === "string" ? item.labelZh.trim().slice(0, 24) : ""
    result.push({
      id: typeof item.id === "string" && item.id.trim() ? item.id.trim().slice(0, 40) : `v${result.length + 1}`,
      labelZh: labelZh || promptEn,
      promptEn,
      role: role as VisionRole,
      enabled: item.enabled !== false,
    })
    if (result.length >= MAX_VOCABULARY) break
  }
  const ids = new Set<string>()
  return result.map((item, index) => {
    let id = item.id
    if (ids.has(id)) id = `v${index + 1}-${Math.random().toString(36).slice(2, 6)}`
    ids.add(id)
    return { ...item, id }
  })
}

export interface VocabularyMergeResult {
  vocabulary: VocabularyItem[]
  added: number
  /** 英文词已存在而被忽略的条数（含因已有主体锚点而跳过的锚点）。 */
  skipped: number
  /** 英文词已存在但处于停用状态，被重新启用的条数。 */
  reenabled: number
}

/** 把新词条追加到现有词表：保留已有词条的全部手动编辑，按英文词去重，已有启用的主体锚点时不再重复添加锚点。 */
export function mergeVocabulary(existing: VocabularyItem[], incoming: VocabularyItem[]): VocabularyMergeResult {
  const merged = existing.map((item) => ({ ...item }))
  const indexByKey = new Map(merged.map((item, index) => [item.promptEn.trim().toLowerCase(), index]))
  const usedIds = new Set(merged.map((item) => item.id))
  let added = 0
  let skipped = 0
  let reenabled = 0
  const stamp = Date.now().toString(36)

  for (const item of incoming) {
    const key = item.promptEn.trim().toLowerCase()
    const at = indexByKey.get(key)
    if (at !== undefined) {
      if (merged[at].enabled) skipped += 1
      else {
        merged[at] = { ...merged[at], enabled: true }
        reenabled += 1
      }
      continue
    }
    if (item.role === "anchor_person" && merged.some((entry) => entry.role === "anchor_person" && entry.enabled)) {
      skipped += 1
      continue
    }
    if (merged.length >= MAX_VOCABULARY) break
    let id = `v${stamp}${added}`
    while (usedIds.has(id)) id += "x"
    usedIds.add(id)
    indexByKey.set(key, merged.length)
    merged.push({ ...item, id, enabled: true })
    added += 1
  }
  return { vocabulary: merged, added, skipped, reenabled }
}

/** 合并并校验部分配置；非法字段回退到 base 的取值。服务端与前端共用。 */
export function sanitizeVisionConfig(input: unknown, base: VisionConfig = DEFAULT_VISION_CONFIG): VisionConfig {
  const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {}
  const low = clampNumber(raw.confidenceLow, 0.05, 0.95, base.confidenceLow)
  const high = Math.min(0.99, Math.max(low + 0.05, clampNumber(raw.confidenceHigh, 0.1, 0.99, base.confidenceHigh)))
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : base.enabled,
    sampleFps: clampNumber(raw.sampleFps, 0.2, 10, base.sampleFps),
    motionThresholdPct: clampNumber(raw.motionThresholdPct, 0, 50, base.motionThresholdPct),
    confidenceLow: low,
    confidenceHigh: high,
    minConsecutiveFrames: Math.round(clampNumber(raw.minConsecutiveFrames, 1, 30, base.minConsecutiveFrames)),
    cooldownSeconds: clampNumber(raw.cooldownSeconds, 0, 3600, base.cooldownSeconds),
    staticRecheckSeconds: clampNumber(raw.staticRecheckSeconds, 0, 300, base.staticRecheckSeconds),
    auditMode: typeof raw.auditMode === "boolean" ? raw.auditMode : base.auditMode,
    auditRetention: raw.auditRetention === undefined ? base.auditRetention : auditRetentionOf(raw.auditRetention),
    lowLightMode: LOW_LIGHT_MODES.includes(raw.lowLightMode as LowLightMode) ? (raw.lowLightMode as LowLightMode) : base.lowLightMode,
  }
}

export type VisionStatus = "ready" | "degraded" | "loading" | "starting" | "offline" | "installing" | "disabled"
export type VisionIssue = "not-installed" | "no-python" | "crashed" | "unreachable" | "disabled"

export interface VisionStats {
  totalFrames: number
  tier0Filtered: number
  tier1Inferred: number
  tier1Passed: number
  tier1Pending: number
  tier2Triggered: number
  cooldownSuppressed: number
  motionOnlyFrames: number
  tier2Confirmed: number
  tier2Rejected: number
  tier2Failed: number
}

export const EMPTY_VISION_STATS: VisionStats = {
  totalFrames: 0,
  tier0Filtered: 0,
  tier1Inferred: 0,
  tier1Passed: 0,
  tier1Pending: 0,
  tier2Triggered: 0,
  cooldownSuppressed: 0,
  motionOnlyFrames: 0,
  tier2Confirmed: 0,
  tier2Rejected: 0,
  tier2Failed: 0,
}

export interface VisionRawCandidate {
  prompt: string
  role: string
  conf: number
  threshold: number
  passed: boolean
  box: number[]
}

export interface VisionRawTop {
  at: string
  predictFloor: number
  /** 词表是否已真正注入模型（false 说明通道词表与模型当前词表不一致） */
  vocabSynced: boolean
  appliedCount: number
  channelVocabCount: number
  frame: {
    width: number
    height: number
    imgsz: number
    luma: number
    grayscale: boolean
    enhanced: boolean
    rescued: boolean
  }
  top: VisionRawCandidate[]
}

export interface VisionStreamHealth {
  online: boolean
  monitored: boolean
  frames: number
  motionPct?: number | null
  persons?: number
  /** 词表中通过门槛的非人员目标数（猫 / 食盆等） */
  subjects?: number
  /** Gate 0 最近一帧模型原始输出诊断 */
  rawTop?: VisionRawTop | null
  pendingTracks?: number
  /** 帧缓冲（Ring Buffer）里当前缓存的帧数 */
  ringFrames?: number
  /** 该通道下发到视觉服务的围栏数；0 表示全局检测模式 */
  zones?: number
  error: string
}

/** 初筛命中日志里一帧画面上检出的单个标签 */
export interface VisionHitTag {
  label: string
  prompt: string
  role: string
  confidence: number
}

/** nodet：本帧模型没有任何词条越过 Gate 0（无主体或全部被置信度拦截） */
export type VisionHitGate = "passed" | "pending" | "cooldown" | "escalated" | "nodet"

export interface VisionHitEntry {
  id: string
  at: string
  streamId: string
  gate: VisionHitGate
  hits: VisionHitTag[]
  reasons: string[]
  /** 连续命中进度，仅 pending 时有意义 */
  progress?: { hits: number; need: number }
  /** gate 为 escalated 时对应的二级研判事件 id，可在 recentEvents 里查到研判结果 */
  eventId?: string
  /** 相同内容在去重窗口内重复出现的次数 */
  repeat: number
  /** 该条由「记忆锚点靠近」触发（自优化闭环带来的触发路径），而非双目标重叠 */
  anchor?: boolean
}

export interface VisionHitsResponse {
  status: "ok"
  online: boolean
  mode: string
  modelLoaded: boolean
  message: string
  hitLog: VisionHitEntry[]
  recentEvents: VisionEvent[]
  stats: VisionStats
  streams: {
    id: string
    name: string
    monitored: boolean
    online: boolean
    frames: number
    ringFrames: number
    zones: number
    persons: number
    subjects: number
    rawTop: VisionRawTop | null
    error: string
  }[]
}

export interface VisionEvent {
  id: string
  at: string
  streamId: string
  trackId: string
  label: string
  confidence: number
  reasons: string[]
  status: "pending" | "confirmed" | "rejected" | "error"
  summary: string
  alertId?: string | null
}

export interface VisionClassView {
  promptEn: string
  labelZh: string
  role: string
}

export interface VisionInfo {
  status: VisionStatus
  issue?: VisionIssue
  message: string
  mode: string
  device: string
  enabled: boolean
  modelLoaded: boolean
  weightsPresent: boolean
  trackerKind: string
  classes: VisionClassView[]
  stats: VisionStats
  streams: Record<string, VisionStreamHealth>
  recentEvents: VisionEvent[]
  hitLog: VisionHitEntry[]
  versions: Record<string, string>
  lastReloadMs: number
  restarts: number
  installOutput?: string
}

export interface FunnelView {
  total: number
  tier0: number
  tier1Passed: number
  tier1Other: number
  tier2: number
  interceptPct: number
}

/** 漏斗口径：被 Tier-0 / Tier-1 拦下的帧数占全部采样帧的百分比 */
export function funnelView(stats: VisionStats): FunnelView {
  const total = stats.totalFrames
  const tier0 = stats.tier0Filtered
  const tier1Passed = stats.tier1Passed
  const tier2 = stats.tier2Triggered
  const tier1Other = Math.max(0, stats.tier1Inferred - tier1Passed - tier2)
  const intercepted = tier0 + tier1Passed
  return {
    total,
    tier0,
    tier1Passed,
    tier1Other,
    tier2,
    interceptPct: total > 0 ? Math.round((intercepted / total) * 1000) / 10 : 0,
  }
}

export interface VisionConfigResponse {
  status: "ok"
  config: VisionConfig
  engine: VisionInfo
  reload?: { ok: boolean; reloadMs: number; message: string }
}

export interface InspectDetection {
  prompt: string
  labelZh: string
  role: VisionRole
  confidence: number
  trackId: number | null
  box: number[]
}

export interface InspectResponse {
  ok: boolean
  streamId: string
  mode: string
  device: string
  degraded: boolean
  reason: string
  motionPct: number | null
  latencyMs: number
  detections: InspectDetection[]
  gate: {
    decision: "passed" | "suspect" | "no-target" | "degraded"
    persons: number
    passedPersons: number
    minConsecutiveFrames: number
    suspects: { key: string; trackId: number | null; confidence: number; reasons: string[]; hits: number }[]
  }
  thresholds: { motionThresholdPct: number; confidenceLow: number; confidenceHigh: number }
  annotatedJpegBase64: string
}

export const VISION_ENDPOINTS = {
  config: "/api/v1/vision/config",
  engine: "/api/v1/vision/engine",
  hits: "/api/v1/vision/hits",
  learning: "/api/v1/vision/learning",
} as const

export function streamAnnotatedUrl(streamId: string) {
  return `/api/v1/streams/${encodeURIComponent(streamId)}/annotated`
}

export function streamOverlayUrl(streamId: string) {
  return `/api/v1/streams/${encodeURIComponent(streamId)}/overlay`
}
export function streamInspectUrl(streamId: string) {
  return `/api/v1/streams/${encodeURIComponent(streamId)}/inspect`
}
