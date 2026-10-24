import { CAMERAS } from "@/lib/ops/data"
import { INITIAL_ZONES } from "@/lib/ops/perception-data"
import { SEVERITY_RANK, SOURCE_ALL, bindsSource, ruleSensitivity } from "@/lib/ops/rule-binding"
import type { RoiZone } from "@/lib/ops/perception-types"
import type {
  AffinityFactor,
  ClusterEventInput,
  ClusterEvidence,
  ClusteredIncident,
  ClusteredIncidentResponse,
  CollisionType,
  CreateRuleRequest,
  EvaluateSeverity,
  RuleEvaluateRequest,
  RuleEvaluateResponse,
  SuppressionPulse,
  SuppressionSnapshot,
  SuppressionStatus,
  UpdateRuleRequest,
} from "@/lib/ops/rules-api-types"
import {
  ALL_CHANNELS,
  CORRELATION_WINDOW_SECONDS,
  EVIDENCE_CHAIN,
  INITIAL_DEDUP_METRICS,
  INITIAL_INSPECTION_RULES,
} from "@/lib/ops/rules-data"
import type {
  DeduplicationMetrics,
  EvidenceTrigger,
  InspectionRule,
  RuleSchedule,
  RuleSeverity,
} from "@/lib/ops/rules-types"
import {
  detectTripwireCrossing,
  distanceToSegment,
  pointInPolygon,
  type Vec2,
} from "./rule-geometry"
import { GMP_CLEANROOM_RULES } from "@/lib/ops/gmp-cleanroom-rules"
import { isDemoEnabled } from "@/lib/storage/demo-store"
import { loadRules, seedRules, writeRules } from "@/lib/storage/rules-store"
import { extractTags, matchScenario, tagLabel } from "./rule-semantic"

/* ---------------------------------------------------------------- constants */

const DEFAULT_WINDOW_SECONDS = 60
/** ROI data is stored in percent (0~100); the evaluate API works in 0~1000. */
const ROI_SCALE = 10
/** Distance (0~1000 units) under which a lone point counts as touching a tripwire. */
const TRIPWIRE_TOLERANCE = 12
const MAX_PULSES = 120
const MAX_EVENTS = 500
const MIN_CLUSTER_AFFINITY = 0.65
const SHANGHAI_TZ = "Asia/Shanghai"

/** Physical neighbours: east gate -> workshop -> tank farm -> warehouse lane. */
const ADJACENT_PAIRS: [string, string][] = [
  ["CAM-01", "CAM-02"],
  ["CAM-02", "CAM-03"],
  ["CAM-03", "CAM-04"],
]

/* -------------------------------------------------------------------- state */

interface WindowState {
  channelId: string
  ruleId: string
  activeIncidentId: string
  windowStart: number
  lastTriggeredAt: number
  windowMs: number
  rawTriggers: number
  suppressedCount: number
  pulses: { id: number; offsetMs: number; kind: SuppressionPulse["kind"] }[]
}

interface ClusterEvent {
  id: number
  channelId: string
  ruleId: string
  incidentId: string
  tags: string[]
  timestampMs: number
  kind: "incident" | "suppressed" | "raw"
  note: string
  titleHint?: string
  roleHint?: EvidenceTrigger["role"]
}

interface EngineState {
  rules: InspectionRule[]
  windows: Map<string, WindowState>
  metrics: DeduplicationMetrics
  events: ClusterEvent[]
  pulseSeq: number
  eventSeq: number
  lastIncidentTs: number
}

const globalStore = globalThis as typeof globalThis & { __vigilRuleEngine?: EngineState }

function ruleTags(rule: InspectionRule) {
  return extractTags(`${rule.name} ${rule.prompt ?? rule.logic ?? ""}`)
}

const EMPTY_METRICS: DeduplicationMetrics = {
  rawTriggersCount: 0,
  suppressedCount: 0,
  incidentCount: 0,
  correlatedCount: 0,
}

function seedState(): EngineState {
  const demo = isDemoEnabled()
  const now = Date.now()
  const rules: InspectionRule[] = loadRules(demo ? seedRules() : [])

  const windows = new Map<string, WindowState>()
  if (!demo) {
    return {
      rules,
      windows,
      metrics: { ...EMPTY_METRICS },
      events: [],
      pulseSeq: 100,
      eventSeq: 0,
      lastIncidentTs: 0,
    }
  }
  const seededStart = now - 41_000
  windows.set(windowKey("CAM-02", "RULE-03"), {
    channelId: "CAM-02",
    ruleId: "RULE-03",
    activeIncidentId: "INC-20261020-009",
    windowStart: seededStart,
    lastTriggeredAt: seededStart + 23_000,
    windowMs: DEFAULT_WINDOW_SECONDS * 1000,
    rawTriggers: 4,
    suppressedCount: 3,
    pulses: [
      { id: 1, offsetMs: 0, kind: "incident" },
      { id: 2, offsetMs: 8_000, kind: "suppressed" },
      { id: 3, offsetMs: 15_000, kind: "suppressed" },
      { id: 4, offsetMs: 23_000, kind: "suppressed" },
    ],
  })

  const events: ClusterEvent[] = EVIDENCE_CHAIN.map((row, index) => {
    const rule = rules.find((r) => r.id === row.rule)
    return {
      id: index + 1,
      channelId: row.channelId,
      ruleId: row.rule,
      incidentId: "INC-20261020-008",
      tags: rule ? ruleTags(rule) : [],
      timestampMs: Date.parse(`2026-10-20T${row.time}+08:00`),
      kind: row.role === "primary" ? "incident" : "suppressed",
      note: row.note,
      roleHint: row.role,
      titleHint: index === 0 ? "东门通道至1号车间逃窜/冲突事件" : undefined,
    }
  })

  return {
    rules,
    windows,
    metrics: { ...INITIAL_DEDUP_METRICS },
    events,
    pulseSeq: 100,
    eventSeq: events.length,
    lastIncidentTs: 0,
  }
}

/** 版本升级后新增的内置规则会补进已有规则库；已存在的规则（含用户改动）一律不动。 */
function mergeMissingSeeds(state: EngineState) {
  const missing = seedRules().filter((seed) => !state.rules.some((rule) => rule.id === seed.id))
  if (missing.length === 0) return
  const next = [...state.rules, ...missing]
  try {
    writeRules(next)
  } catch (error) {
    console.error("[rule-engine] 新增内置规则写盘失败，仅在内存中生效：", error)
  }
  state.rules = next
}

function engine(): EngineState {
  if (!globalStore.__vigilRuleEngine) {
    const state = seedState()
    if (isDemoEnabled()) mergeMissingSeeds(state)
    globalStore.__vigilRuleEngine = state
  }
  return globalStore.__vigilRuleEngine
}

/**
 * 演示开关切换时同步规则库：开启时补入内置示例规则，关闭时移除未被用户自建的内置规则，
 * 并丢弃预置的冷却窗口、证据链和指标，下次访问时按新开关状态重建。
 */
export function applyDemoMode(enabled: boolean) {
  const builtinIds = new Set(INITIAL_INSPECTION_RULES.map((rule) => rule.id))
  const current = loadRules()
  const next = enabled
    ? [...current, ...seedRules().filter((seed) => !current.some((rule) => rule.id === seed.id))]
    : current.filter((rule) => !builtinIds.has(rule.id) || rule.custom)
  writeRules(next)
  globalStore.__vigilRuleEngine = undefined
}

function windowKey(channelId: string, ruleId: string) {
  return `${channelId}::${ruleId}`
}

/* -------------------------------------------------------------- rule access */

export function isKnownChannel(channelId: string) {
  return ALL_CHANNELS.includes(channelId)
}

export function listRules(): InspectionRule[] {
  return engine().rules.map((rule) => ({ ...rule, boundChannels: [...rule.boundChannels] }))
}

export function findRule(ruleId: string) {
  return engine().rules.find((rule) => rule.id === ruleId)
}

export function defaultRuleForChannel(channelId: string) {
  return engine().rules.find((rule) => rule.enabled && bindsSource(rule, { kind: "channel", channelId }))
}

function cloneRule(rule: InspectionRule): InspectionRule {
  return {
    ...rule,
    boundChannels: [...rule.boundChannels],
    actions: rule.actions ? { ...rule.actions } : undefined,
  }
}

/** 先写盘、成功后再替换内存状态，写盘失败时内存与文件保持一致并向上抛出。 */
function commitRules(state: EngineState, next: InspectionRule[]) {
  writeRules(next)
  state.rules = next
}

function newCustomRuleId(existing: InspectionRule[]) {
  let stamp = Date.now()
  while (existing.some((rule) => rule.id === `RULE-CUSTOM-${stamp}`)) stamp += 1
  return `RULE-CUSTOM-${stamp}`
}

export function createCustomRule(input: CreateRuleRequest): InspectionRule {
  const state = engine()
  const rule: InspectionRule = {
    id: newCustomRuleId(state.rules),
    name: input.name,
    type: "PROMPT_SEMANTIC",
    prompt: input.prompt,
    boundChannels: input.boundChannels?.length ? [...input.boundChannels] : [SOURCE_ALL],
    severity: input.severity ?? "WARNING",
    cooldownSeconds: DEFAULT_WINDOW_SECONDS,
    schedule: "24x7",
    enabled: true,
    custom: true,
    sensitivity: input.sensitivity,
    actions: { ...input.actions },
  }
  commitRules(state, [...state.rules, rule])
  return cloneRule(rule)
}

export function updateRule(ruleId: string, patch: UpdateRuleRequest): InspectionRule | null {
  const state = engine()
  const current = state.rules.find((rule) => rule.id === ruleId)
  if (!current) return null

  const rule = cloneRule(current)
  if (patch.enabled !== undefined) rule.enabled = patch.enabled
  if (patch.severity !== undefined) rule.severity = patch.severity
  if (patch.cooldownSeconds !== undefined) rule.cooldownSeconds = patch.cooldownSeconds
  if (patch.schedule !== undefined) rule.schedule = patch.schedule
  if (patch.boundChannels !== undefined) rule.boundChannels = [...patch.boundChannels]
  if (patch.sensitivity !== undefined) rule.sensitivity = patch.sensitivity
  if (patch.actions !== undefined) rule.actions = { ...patch.actions }
  if (patch.description !== undefined) {
    if (rule.type === "PROMPT_SEMANTIC") rule.prompt = patch.description
    else rule.logic = patch.description
  }

  commitRules(
    state,
    state.rules.map((item) => (item.id === ruleId ? rule : item))
  )
  return cloneRule(rule)
}

export type DeleteRuleResult = "deleted" | "not_found" | "builtin"

/** 自定义规则物理删除；内置规则只能停用，不允许删除。 */
export function deleteRule(ruleId: string): DeleteRuleResult {
  const state = engine()
  const target = state.rules.find((rule) => rule.id === ruleId)
  if (!target) return "not_found"
  if (!target.custom) return "builtin"
  commitRules(
    state,
    state.rules.filter((rule) => rule.id !== ruleId)
  )
  return "deleted"
}

/** 恢复出厂：规则��重置为内置规则，自定义规则与所有改动一并清除。 */
export function resetRules(): InspectionRule[] {
  const state = engine()
  commitRules(state, isDemoEnabled() ? seedRules() : [])
  return listRules()
}

/** 载入 GMP 洁净室标准预设：已存在的同 ID 规则恢复为预设值并启用，缺失的补入；其他规则不动。 */
export function applyGmpPreset(): InspectionRule[] {
  const state = engine()
  const presets = new Map(GMP_CLEANROOM_RULES.map((rule) => [rule.id, cloneRule(rule)]))
  const replaced = state.rules.map((rule) => presets.get(rule.id) ?? rule)
  const present = new Set(replaced.map((rule) => rule.id))
  const missing = [...presets.values()].filter((rule) => !present.has(rule.id))
  commitRules(state, [...replaced, ...missing])
  return listRules()
}

/* ------------------------------------------------- sliding-window suppression */

function statusOf(
  channelId: string,
  ruleId: string,
  window: WindowState | undefined,
  now: number
): SuppressionStatus {
  const active = window !== undefined && now - window.lastTriggeredAt < window.windowMs
  const remainingMs = active && window ? window.windowMs - (now - window.lastTriggeredAt) : 0
  return {
    channelId,
    ruleId,
    incidentId: window?.activeIncidentId ?? null,
    windowSeconds: window ? window.windowMs / 1000 : DEFAULT_WINDOW_SECONDS,
    windowActive: active,
    elapsedSec: window ? Math.round(((now - window.windowStart) / 1000) * 10) / 10 : 0,
    cooldownRemainingSec: Math.ceil(remainingMs / 1000),
    rawTriggers: window?.rawTriggers ?? 0,
    suppressedCount: window?.suppressedCount ?? 0,
    pulses: (window?.pulses ?? []).map((pulse) => ({
      id: pulse.id,
      offsetSec: Math.round((pulse.offsetMs / 1000) * 10) / 10,
      kind: pulse.kind,
    })),
  }
}

export function getWindowStatus(channelId: string, ruleId: string, now = Date.now()) {
  return statusOf(channelId, ruleId, engine().windows.get(windowKey(channelId, ruleId)), now)
}

export interface TriggerOutcome {
  isNewIncident: boolean
  suppressed: boolean
  status: SuppressionStatus
  metrics: DeduplicationMetrics
}

function nextIncidentId(state: EngineState, now: number) {
  const ts = now <= state.lastIncidentTs ? state.lastIncidentTs + 1 : now
  state.lastIncidentTs = ts
  return `INC-${ts}`
}

/**
 * Registers one trigger against the (channel, rule) cooldown window.
 * Inside an active window the trigger is folded into the existing incident and the
 * window restarts its countdown from this trigger; otherwise a new incident is opened.
 */
export interface TriggerOptions {
  /** 规则库中查不到该规则时使用的冷却窗口（秒） */
  windowSeconds?: number
  /** 本地视频源不参与跨机位聚类，只计入冷却窗口与去重指标 */
  skipEvent?: boolean
}

export function registerTrigger(
  channelId: string,
  ruleId: string,
  now = Date.now(),
  options: TriggerOptions = {}
): TriggerOutcome {
  const state = engine()
  const rule = findRule(ruleId)
  const windowMs = (rule?.cooldownSeconds ?? options.windowSeconds ?? DEFAULT_WINDOW_SECONDS) * 1000
  const key = windowKey(channelId, ruleId)
  const existing = state.windows.get(key)
  const active = existing !== undefined && now - existing.lastTriggeredAt < existing.windowMs

  state.pulseSeq += 1
  state.metrics.rawTriggersCount += 1

  let window: WindowState
  if (existing && active) {
    window = existing
    window.lastTriggeredAt = now
    window.rawTriggers += 1
    window.suppressedCount += 1
    window.pulses.push({ id: state.pulseSeq, offsetMs: now - window.windowStart, kind: "suppressed" })
    if (window.pulses.length > MAX_PULSES) window.pulses.splice(1, 1)
    state.metrics.suppressedCount += 1
  } else {
    window = {
      channelId,
      ruleId,
      activeIncidentId: nextIncidentId(state, now),
      windowStart: now,
      lastTriggeredAt: now,
      windowMs,
      rawTriggers: 1,
      suppressedCount: 0,
      pulses: [{ id: state.pulseSeq, offsetMs: 0, kind: "incident" }],
    }
    state.windows.set(key, window)
    state.metrics.incidentCount += 1
  }

  const isNewIncident = !(existing && active)
  if (!options.skipEvent) {
    pushEvent(state, {
      channelId,
      ruleId,
      incidentId: window.activeIncidentId,
      tags: rule ? ruleTags(rule) : [],
      timestampMs: now,
      kind: isNewIncident ? "incident" : "suppressed",
      note: isNewIncident
        ? `${rule?.name ?? ruleId} 触发，生成工单并派发告警`
        : `${Math.round(window.windowMs / 1000)}s 冷却窗口内重复触发，证据已折叠`,
    })
  }

  return {
    isNewIncident,
    suppressed: !isNewIncident,
    status: statusOf(channelId, ruleId, window, now),
    metrics: { ...state.metrics },
  }
}

export function getSnapshot(now = Date.now()): SuppressionSnapshot {
  const state = engine()
  const channels: Record<string, SuppressionStatus | null> = {}
  for (const channelId of ALL_CHANNELS) {
    let latest: WindowState | undefined
    for (const window of state.windows.values()) {
      if (window.channelId !== channelId) continue
      if (!latest || window.lastTriggeredAt > latest.lastTriggeredAt) latest = window
    }
    channels[channelId] = latest ? statusOf(channelId, latest.ruleId, latest, now) : null
  }
  return { channels, metrics: { ...state.metrics }, serverTime: now }
}

export function getMetrics(): DeduplicationMetrics {
  return { ...engine().metrics }
}

/* ------------------------------------------------------------- evaluation */

function shanghaiHour(date: Date) {
  const hour = new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    hourCycle: "h23",
    timeZone: SHANGHAI_TZ,
  }).format(date)
  return Number(hour)
}

function scheduleActive(schedule: RuleSchedule, date: Date) {
  const hour = shanghaiHour(date)
  if (schedule === "NIGHT_ONLY") return hour >= 22 || hour < 6
  if (schedule === "WORK_HOURS") return hour >= 8 && hour < 18
  return true
}

function normalizeConfidence(value: number) {
  const ratio = value > 1 ? value / 100 : value
  return Math.min(1, Math.max(0, ratio))
}

function ruleThreshold(rule: InspectionRule) {
  return ruleSensitivity(rule)
}

function maxSeverity(a: RuleSeverity, b: RuleSeverity): RuleSeverity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b
}

function scaleZone(zone: RoiZone): Vec2[] {
  return zone.coordinates.map(([x, y]) => [x * ROI_SCALE, y * ROI_SCALE] as const)
}

interface RuleHit {
  rule: InspectionRule
  severity: RuleSeverity
  collisionType: CollisionType
  reason: string
  matchedZoneId?: string
}

type RuleVerdict = { hit: RuleHit } | { miss: string }

function evaluateGeometry(
  rule: InspectionRule,
  req: RuleEvaluateRequest,
  confidence: number
): RuleVerdict {
  if (!req.targetCoords) return { miss: `${rule.id} 需要 targetCoords 才能做几何判定` }
  const point: Vec2 = req.targetCoords
  const previous: Vec2 | undefined = req.previousCoords

  const zones = INITIAL_ZONES.filter((zone) => {
    if (!zone.enabled || zone.cameraId !== req.channelId) return false
    if (rule.type === "THRESHOLD" && !(zone.type === "polygon" && zone.severity === "critical")) return false
    if (req.targetClass && !zone.targets.includes(req.targetClass as RoiZone["targets"][number])) return false
    return true
  })
  if (zones.length === 0) return { miss: `${req.channelId} 上没有适用于该目标类型的 ROI 区域` }
  if (confidence < ruleThreshold(rule)) {
    return { miss: `置信度 ${(confidence * 100).toFixed(0)}% 低于规则阈值 ${(ruleThreshold(rule) * 100).toFixed(0)}%` }
  }

  for (const zone of zones) {
    const shape = scaleZone(zone)
    const zoneSeverity: RuleSeverity = zone.severity === "critical" ? "CRITICAL" : "WARNING"
    const severity = maxSeverity(rule.severity, zoneSeverity)

    if (zone.type === "polygon") {
      if (pointInPolygon(point, shape)) {
        return {
          hit: {
            rule,
            severity,
            collisionType: "ROI_POLYGON",
            matchedZoneId: zone.id,
            reason: `目标足底坐标 [${point[0]}, ${point[1]}] 位于多边形区域「${zone.name}」内部（射线法判定）`,
          },
        }
      }
      continue
    }

    const [a, b] = shape
    if (previous) {
      const crossing = detectTripwireCrossing(previous, point, a, b, zone.directional === true)
      if (crossing.crossed && crossing.wrongWay) {
        return {
          hit: {
            rule,
            severity,
            collisionType: "TRIPWIRE",
            matchedZoneId: zone.id,
            reason: `目标轨迹 [${previous[0]}, ${previous[1]}] -> [${point[0]}, ${point[1]}] ${zone.directional ? "逆向" : ""}穿越绊线「${zone.name}」`,
          },
        }
      }
    } else if (distanceToSegment(point, a, b) <= TRIPWIRE_TOLERANCE) {
      return {
        hit: {
          rule,
          severity,
          collisionType: "TRIPWIRE",
          matchedZoneId: zone.id,
          reason: `目标位于绊线「${zone.name}」${TRIPWIRE_TOLERANCE} 单位范围内（未提供上一帧坐标，按距离判定）`,
        },
      }
    }
  }
  return { miss: "目标未进入任��� ROI 区域，也未穿越绊线" }
}

function evaluateSemantic(rule: InspectionRule, req: RuleEvaluateRequest, confidence: number): RuleVerdict {
  if (!req.scenarioText?.trim()) return { miss: `${rule.id} 需要 scenarioText 才能做语义判定` }
  if (confidence < ruleThreshold(rule)) {
    return { miss: `置信度 ${(confidence * 100).toFixed(0)}% 低于规则阈值 ${(ruleThreshold(rule) * 100).toFixed(0)}%` }
  }
  const match = matchScenario(`${rule.name} ${rule.prompt ?? ""}`, req.scenarioText)
  if (!match.matched) return { miss: `研判文本与规则 Prompt「${rule.name}」语义不相关` }
  const tags = match.sharedTags.map(tagLabel)
  return {
    hit: {
      rule,
      severity: rule.severity,
      collisionType: "VLM_SEMANTIC",
      reason: tags.length
        ? `研判文本命中规则语义标签：${tags.join("、")}`
        : `研判文本与规则 Prompt 的文字重合度 ${(match.score * 100).toFixed(0)}%`,
    },
  }
}

function evaluateRule(rule: InspectionRule, req: RuleEvaluateRequest, when: Date): RuleVerdict {
  if (!rule.enabled) return { miss: `${rule.id} 已停用` }
  if (!bindsSource(rule, { kind: "channel", channelId: req.channelId })) {
    return { miss: `${rule.id} 未绑定 ${req.channelId}` }
  }
  if (!scheduleActive(rule.schedule, when)) return { miss: `${rule.id} 当前不在生效时段` }
  const confidence = normalizeConfidence(req.confidence)
  return rule.type === "PROMPT_SEMANTIC"
    ? evaluateSemantic(rule, req, confidence)
    : evaluateGeometry(rule, req, confidence)
}

export type EvaluateOutcome =
  | { ok: true; response: RuleEvaluateResponse }
  | { ok: false; status: number; code: string; error: string }

export function evaluateRules(req: RuleEvaluateRequest, now = Date.now()): EvaluateOutcome {
  if (!isKnownChannel(req.channelId)) {
    return { ok: false, status: 404, code: "CHANNEL_NOT_FOUND", error: `未知通道 ${req.channelId}` }
  }

  const when = req.timestamp ? new Date(req.timestamp) : new Date(now)
  const state = engine()

  let candidates: InspectionRule[]
  if (req.ruleId) {
    const rule = findRule(req.ruleId)
    if (!rule) return { ok: false, status: 404, code: "RULE_NOT_FOUND", error: `规则 ${req.ruleId} 不存在` }
    candidates = [rule]
  } else {
    candidates = state.rules.filter(
      (rule) => rule.enabled && bindsSource(rule, { kind: "channel", channelId: req.channelId })
    )
  }

  const hits: RuleHit[] = []
  const misses: string[] = []
  for (const rule of candidates) {
    const verdict = evaluateRule(rule, req, when)
    if ("hit" in verdict) hits.push(verdict.hit)
    else misses.push(verdict.miss)
  }

  if (hits.length === 0) {
    const explicit = req.ruleId ? findRule(req.ruleId) : undefined
    return {
      ok: true,
      response: {
        violated: false,
        ruleId: explicit?.id ?? "",
        ruleName: explicit?.name ?? "未命中任何规则",
        severity: "SAFE",
        collisionType: "NONE",
        suppressed: false,
        cooldownRemainingSec: 0,
        incidentId: "",
        reason: misses[0] ?? `${req.channelId} 没有绑定已启用的规则`,
      },
    }
  }

  hits.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
  const best = hits[0]
  const outcome = registerTrigger(req.channelId, best.rule.id, now)

  return {
    ok: true,
    response: {
      violated: true,
      ruleId: best.rule.id,
      ruleName: best.rule.name,
      severity: best.severity satisfies EvaluateSeverity,
      collisionType: best.collisionType,
      suppressed: outcome.suppressed,
      cooldownRemainingSec: outcome.status.cooldownRemainingSec,
      incidentId: outcome.status.incidentId ?? "",
      reason: best.reason,
      matchedZoneId: best.matchedZoneId,
    },
  }
}

/* ------------------------------------------------------ cross-camera cluster */

function pushEvent(state: EngineState, event: Omit<ClusterEvent, "id">) {
  state.eventSeq += 1
  state.events.push({ ...event, id: state.eventSeq })
  if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS)
}

export function ingestClusterEvents(inputs: ClusterEventInput[], now = Date.now()) {
  const state = engine()
  for (const input of inputs) {
    const rule = input.ruleId ? findRule(input.ruleId) : undefined
    const timestampMs = input.timestamp ? Date.parse(input.timestamp) : now
    pushEvent(state, {
      channelId: input.channelId,
      ruleId: rule?.id ?? input.ruleId ?? "EXTERNAL",
      incidentId: `INC-${timestampMs}`,
      tags: input.tags?.length ? input.tags : rule ? ruleTags(rule) : [],
      timestampMs,
      kind: "raw",
      note: "外部上报事件，参与跨机位聚类",
    })
  }
}

function areAdjacent(a: string, b: string) {
  return ADJACENT_PAIRS.some(([x, y]) => (x === a && y === b) || (x === b && y === a))
}

function overlapCoefficient(a: string[], b: string[]) {
  if (a.length === 0 || b.length === 0) return 0.5
  const setB = new Set(b)
  const shared = a.filter((tag) => setB.has(tag)).length
  return shared / Math.min(a.length, b.length)
}

interface PairScore {
  affinity: number
  temporal: number
  semantic: number
  topology: number
}

function scorePair(a: ClusterEvent, b: ClusterEvent, windowMs: number): PairScore {
  const delta = Math.abs(a.timestampMs - b.timestampMs)
  const temporal = Math.max(0, 1 - (delta / windowMs) ** 2)
  const semantic = overlapCoefficient(a.tags, b.tags)
  const topology = 1
  return { affinity: 0.5 * temporal + 0.35 * semantic + 0.15 * topology, temporal, semantic, topology }
}

function formatClock(ms: number) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone: SHANGHAI_TZ,
  }).format(new Date(ms))
}

function cameraName(channelId: string) {
  return CAMERAS.find((camera) => camera.id === channelId)?.name ?? channelId
}

function cameraImage(channelId: string) {
  return CAMERAS.find((camera) => camera.id === channelId)?.image ?? ""
}

function round1(value: number) {
  return Math.round(value * 10) / 10
}

function buildIncident(events: ClusterEvent[], edges: Map<string, PairScore>): ClusteredIncident {
  const sorted = [...events].sort((a, b) => a.timestampMs - b.timestampMs)
  const channelOrder: string[] = []
  const counts = new Map<string, number>()
  for (const event of sorted) {
    if (!channelOrder.includes(event.channelId)) channelOrder.push(event.channelId)
    counts.set(event.channelId, (counts.get(event.channelId) ?? 0) + 1)
  }

  const primaryChannelId = channelOrder.reduce((best, id) => {
    const bestCount = counts.get(best) ?? 0
    const count = counts.get(id) ?? 0
    return count >= bestCount ? id : best
  }, channelOrder[0])

  const primaryEvent =
    sorted.find((e) => e.roleHint === "primary") ??
    sorted.find((e) => e.channelId === primaryChannelId && e.kind === "incident") ??
    sorted.find((e) => e.channelId === primaryChannelId) ??
    sorted[0]

  const seenChannels = new Set<string>()
  const evidence: ClusterEvidence[] = sorted.map((event) => {
    const firstOnChannel = !seenChannels.has(event.channelId)
    seenChannels.add(event.channelId)
    const role: EvidenceTrigger["role"] =
      event.roleHint ??
      (event.id === primaryEvent.id
        ? "primary"
        : event.channelId !== primaryChannelId && (event.kind === "incident" || firstOnChannel)
          ? "correlated"
          : "folded")
    return {
      time: formatClock(event.timestampMs),
      channelId: event.channelId,
      rule: event.ruleId,
      role,
      note: event.note,
    }
  })

  const edgeScores = [...edges.values()]
  const average = (pick: (score: PairScore) => number) =>
    edgeScores.length ? edgeScores.reduce((sum, score) => sum + pick(score), 0) / edgeScores.length : 0
  const factors: AffinityFactor[] = [
    { key: "temporal", label: "跨机位时间间隔吻合度", value: round1(average((s) => s.temporal) * 100) },
    { key: "semantic", label: "事件语义标签一致度", value: round1(average((s) => s.semantic) * 100) },
    { key: "topology", label: "机位物理拓扑相邻度", value: round1(average((s) => s.topology) * 100) },
  ]

  const tagCounts = new Map<string, number>()
  for (const event of sorted) for (const tag of event.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
  const dominantTag = [...tagCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  const generatedTitle = `${cameraName(channelOrder[0])}至${cameraName(channelOrder[channelOrder.length - 1])}${
    dominantTag ? tagLabel(dominantTag) : "联动"
  }事件`

  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const earliestIncidentId = sorted[0].incidentId

  return {
    incidentId: earliestIncidentId,
    title: sorted.find((e) => e.titleHint)?.titleHint ?? generatedTitle,
    primaryChannelId,
    relatedChannelIds: channelOrder.filter((id) => id !== primaryChannelId),
    startTime: formatClock(first.timestampMs),
    durationSeconds: Math.round((last.timestampMs - first.timestampMs) / 1000),
    rawTriggersFolded: sorted.length,
    spatialAffinity: round1(average((s) => s.affinity) * 100),
    dualKeyframes: channelOrder.slice(0, 2).map((channelId) => {
      const frame = sorted.find((event) => event.channelId === channelId) ?? first
      return { channelId, timestamp: formatClock(frame.timestampMs), thumbnail: cameraImage(channelId) }
    }),
    factors,
    evidence,
  }
}

export function clusterIncidents(
  windowSeconds = CORRELATION_WINDOW_SECONDS,
  now = Date.now()
): ClusteredIncidentResponse {
  const state = engine()
  const windowMs = windowSeconds * 1000
  const events = [...state.events].sort((a, b) => a.timestampMs - b.timestampMs)

  const parent = events.map((_, index) => index)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b)
  }

  /** Best cross-camera pair per component and ordered channel pair. */
  const bestEdges = new Map<number, Map<string, PairScore>>()
  const crossEdges: { i: number; j: number; key: string; score: PairScore }[] = []

  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      if (events[j].timestampMs - events[i].timestampMs > windowMs) break
      const a = events[i]
      const b = events[j]
      if (a.channelId === b.channelId) {
        if (a.incidentId === b.incidentId || a.tags.some((tag) => b.tags.includes(tag))) union(i, j)
        continue
      }
      if (!areAdjacent(a.channelId, b.channelId)) continue
      const score = scorePair(a, b, windowMs)
      if (score.affinity < MIN_CLUSTER_AFFINITY) continue
      union(i, j)
      const key = [a.channelId, b.channelId].sort().join("<>")
      crossEdges.push({ i, j, key, score })
    }
  }

  for (const edge of crossEdges) {
    const root = find(edge.i)
    const map = bestEdges.get(root) ?? new Map<string, PairScore>()
    const current = map.get(edge.key)
    if (!current || edge.score.affinity > current.affinity) map.set(edge.key, edge.score)
    bestEdges.set(root, map)
  }

  const groups = new Map<number, ClusterEvent[]>()
  events.forEach((event, index) => {
    const root = find(index)
    groups.set(root, [...(groups.get(root) ?? []), event])
  })

  const clusters: { incident: ClusteredIncident; endMs: number }[] = []
  for (const [root, group] of groups) {
    const edges = bestEdges.get(root)
    if (!edges || new Set(group.map((e) => e.channelId)).size < 2) continue
    const endMs = Math.max(...group.map((e) => e.timestampMs))
    clusters.push({ incident: buildIncident(group, edges), endMs })
  }
  clusters.sort((a, b) => b.endMs - a.endMs)
  const incidents = clusters.map((cluster) => cluster.incident)

  return {
    windowSeconds,
    evaluatedEvents: events.length,
    incidents,
    primary: incidents[0] ?? null,
    generatedAt: new Date(now).toISOString(),
  }
}
