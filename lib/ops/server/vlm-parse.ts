import type { VlmBbox, VlmFinalResult, VlmPromptRule } from "../vlm-api-types"
import type { FineGrainedVerdict } from "../types"
import type { VlmSeverity } from "../vlm-types"
import { sanitizeTier1Feedback } from "@/lib/vigil/tier1-learning"

const SEVERITIES: ReadonlySet<string> = new Set(["CRITICAL", "WARNING", "INFO", "SAFE"])
const NO_RULE_VALUES: ReadonlySet<string> = new Set(["", "NONE", "NULL", "N/A", "无"])
const TIMESTAMP = /^(\d{1,3}):(\d{1,2})(?:\.(\d{1,3}))?$/

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

export function formatOffset(totalSec: number) {
  const safe = Math.max(0, totalSec)
  const minutes = Math.floor(safe / 60)
  const seconds = safe - minutes * 60
  const [whole, millis = "000"] = seconds.toFixed(3).split(".")
  return `${String(minutes).padStart(2, "0")}:${whole.padStart(2, "0")}.${millis}`
}

export function offsetToSeconds(offset: string) {
  const match = TIMESTAMP.exec(offset.trim())
  if (!match) return null
  const [, minutes, seconds, millis = "0"] = match
  return Number(minutes) * 60 + Number(seconds) + Number(millis.padEnd(3, "0")) / 1000
}

/** 模型给出的时间点；缺失或格式不合法时返回 null，由调用方用帧编号兜底。 */
function readOffsetSeconds(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value
  return offsetToSeconds(text(value))
}

function readFrameIndex(value: unknown) {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : Number.NaN
  return Number.isInteger(numeric) ? numeric : null
}

function parseBbox(value: unknown): VlmBbox | null {
  if (!Array.isArray(value) || value.length !== 4) return null
  const numbers = value.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : Number.NaN))
  if (numbers.some(Number.isNaN)) return null
  // 兼容 0~1 的小数归一化坐标，统一换算到 0~1000
  const scale = numbers.every((v) => v >= 0 && v <= 1) ? 1000 : 1
  const [ymin, xmin, ymax, xmax] = numbers.map((v) => Math.round(Math.min(1000, Math.max(0, v * scale))))
  if (ymax <= ymin || xmax <= xmin) return null
  return [ymin, xmin, ymax, xmax]
}

function unit(value: unknown, fallback: number) {
  let n = typeof value === "number" && Number.isFinite(value) ? value : fallback
  if (n > 1 && n <= 100) n /= 100
  return Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000
}

/** 解析 verdict_detail；缺失关键字段（动作与介质）时视为模型未按协议输出，返回 undefined。 */
export function parseFineVerdict(raw: unknown): FineGrainedVerdict | undefined {
  const record = asRecord(raw)
  if (!record) return undefined
  const action = text(record.primary_action ?? record.primaryAction).slice(0, 48)
  const target = asRecord(record.interaction_target ?? record.interactionTarget)
  const category = text(target?.category).slice(0, 48)
  if (!action && !category) return undefined
  const exclusionReason = text(record.exclusion_reason ?? record.exclusionReason).slice(0, 160)
  const confidence = unit(record.confidence, 0.5)
  return {
    is_alarm: record.is_alarm === true || record.isAlarm === true,
    primary_action: action || "unknown",
    interaction_target: { category: category || "unknown", confidence: unit(target?.confidence, confidence) },
    exclusion_matched: record.exclusion_matched === true || record.exclusionMatched === true,
    ...(exclusionReason ? { exclusion_reason: exclusionReason } : {}),
    confidence,
    ...(record.shadow_review === true || record.shadowReview === true ? { shadow_review: true } : {}),
  }
}

function leadingSentence(reasoning: string) {
  const first = reasoning.split(/(?<=[。！？!?；;])/)[0]?.trim() ?? ""
  return (first || reasoning).slice(0, 80)
}

/** 把帧时间戳换算成最贴近的关键帧 index，作为证据帧。 */
export function nearestFrameIndex(frames: { index: number; timestampSec: number }[], seconds: number) {
  let best: number | null = null
  let gap = Number.POSITIVE_INFINITY
  for (const frame of frames) {
    const diff = Math.abs(frame.timestampSec - seconds)
    if (diff < gap) {
      gap = diff
      best = frame.index
    }
  }
  return best
}

function coerceResult(
  raw: unknown,
  rules: VlmPromptRule[],
  frames: { index: number; timestampSec: number }[]
): VlmFinalResult | null {
  const record = asRecord(raw)
  if (!record) return null

  const severityRaw = text(record.severity).toUpperCase()
  const ruleIdRaw = text(record.rule_id ?? record.ruleId)
  const triggeredFlag = typeof record.triggered === "boolean" ? record.triggered : undefined
  if (triggeredFlag === undefined && !SEVERITIES.has(severityRaw)) return null

  const matched = NO_RULE_VALUES.has(ruleIdRaw.toUpperCase())
    ? undefined
    : rules.find((rule) => rule.id.toLowerCase() === ruleIdRaw.toLowerCase())
  // 模型必须引用规则库里真实存在的编号，否则视为未命中，防止幻觉出不存在的规则
  const fine = parseFineVerdict(record.verdict_detail ?? record.verdictDetail)
  // 防御性判定：模型自己声明非告警，或命中了排他反例，一律不得报警
  const triggered =
    (triggeredFlag ?? severityRaw !== "SAFE") &&
    matched !== undefined &&
    fine?.is_alarm !== false &&
    fine?.exclusion_matched !== true

  let confidence = typeof record.confidence === "number" && Number.isFinite(record.confidence) ? record.confidence : 0.5
  if (confidence > 1 && confidence <= 100) confidence /= 100
  confidence = Math.round(Math.min(1, Math.max(0, confidence)) * 1000) / 1000

  const reasoning = text(record.reasoning) || text(record.intentAnalysis) || text(record.summary)
  // 证据锚点：优先采用模型指明的帧编号，其次按时间点就近匹配；两者都缺失时才退到 0 秒
  const reportedSeconds = triggered ? readOffsetSeconds(record.timestamp_offset ?? record.timestampOffset) : null
  const reportedIndex = triggered ? readFrameIndex(record.frame_index ?? record.frameIndex) : null
  const modelFrame = reportedIndex === null ? undefined : frames.find((frame) => frame.index === reportedIndex)
  const anchorSeconds = reportedSeconds ?? modelFrame?.timestampSec ?? 0
  const timestampOffset = formatOffset(triggered ? anchorSeconds : 0)
  const severity: VlmSeverity = triggered
    ? SEVERITIES.has(severityRaw) && severityRaw !== "SAFE"
      ? (severityRaw as VlmSeverity)
      : matched.severity
    : "SAFE"

  const evidenceFrame = triggered ? (modelFrame?.index ?? nearestFrameIndex(frames, anchorSeconds)) : null

  return {
    triggered,
    ruleId: triggered ? matched.id : null,
    ruleTriggered: triggered ? matched.name : "无",
    severity,
    confidence,
    timestampOffset,
    bbox: triggered ? parseBbox(record.bbox) : null,
    reasoning: reasoning || (triggered ? "模型未给出论据" : "未发现符合任何生效规则的画面"),
    advice: text(record.advice ?? record.actionAdvice),
    summary: leadingSentence(reasoning) || (triggered ? matched.name : "未触发任何生效规则"),
    evidenceKeyframes: evidenceFrame === null ? [] : [evidenceFrame],
    ...(fine ? { fine } : {}),
    ...(triggered ? tier1FeedbackField(record.tier1_feedback ?? record.tier1Feedback) : {}),
  }
}

function tier1FeedbackField(raw: unknown) {
  const tier1Feedback = sanitizeTier1Feedback(raw)
  return tier1Feedback ? { tier1Feedback } : {}
}

export function parseFinalResult(
  output: string,
  rules: VlmPromptRule[],
  frames: { index: number; timestampSec: number }[]
): VlmFinalResult | null {
  const candidates: string[] = []
  const fence = /```(?:json)?\s*([\s\S]*?)```/gi
  let lastFence: string | null = null
  let match = fence.exec(output)
  while (match) {
    lastFence = match[1]
    match = fence.exec(output)
  }
  if (lastFence) candidates.push(lastFence)
  const first = output.indexOf("{")
  const last = output.lastIndexOf("}")
  if (first >= 0 && last > first) candidates.push(output.slice(first, last + 1))

  for (const candidate of candidates) {
    const result = coerceResult(parseJson(candidate.trim()), rules, frames)
    if (result) return result
  }
  return null
}
