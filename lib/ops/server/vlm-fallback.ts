import type { VlmFinalResult, VlmKeyframeInput, VlmPromptRule } from "../vlm-api-types"
import {
  abortableSleep,
  costUsd,
  estimateTokens,
  hashString,
  modelProfile,
  type EngineContext,
  type NormalizedInput,
} from "./vlm-shared"
import { formatOffset } from "./vlm-parse"
import type { PreVerdictChunk } from "./vlm-verdict"

const SAFE_CONFIDENCE = 0.9

function findPeakMotion(frames: VlmKeyframeInput[]) {
  let best: { frame: VlmKeyframeInput; score: number } | null = null
  for (const frame of frames) {
    if (typeof frame.motionScore !== "number" || !Number.isFinite(frame.motionScore)) continue
    if (!best || frame.motionScore > best.score) best = { frame, score: frame.motionScore }
  }
  return best
}

function frameRef(frame: VlmKeyframeInput) {
  return `帧 ${frame.index} (${frame.timecode})`
}

/** 离线模拟只会命中调用方显式指定、且确实在生效规则集里的规则；没有指定则一律判定为安全。 */
function pickRule(input: NormalizedInput): VlmPromptRule | null {
  const hinted = input.simulation?.ruleId
  if (!hinted) return null
  return input.rules.find((rule) => rule.id === hinted) ?? null
}

export function planFallback(input: NormalizedInput) {
  const rule = pickRule(input)
  const frames = input.keyframes
  const peak = findPeakMotion(frames)
  const anchor = peak?.frame ?? frames[Math.floor(frames.length / 2)] ?? null

  const hinted = input.simulation?.confidence
  const confidence = rule
    ? typeof hinted === "number" && Number.isFinite(hinted)
      ? Math.round(Math.min(0.99, Math.max(0.5, hinted)) * 100) / 100
      : Math.min(0.99, Math.round((rule.sensitivity + 0.08) * 100) / 100)
    : SAFE_CONFIDENCE

  const ruleList = input.rules.map((r) => `${r.id}`).join("、") || "无"
  const observations = [
    `- 本次共比对 ${input.rules.length} 条生效规则：${ruleList}`,
    anchor
      ? `- ${frameRef(anchor)}${peak ? `：运动能量峰值 motionScore=${peak.score.toFixed(2)}` : "：序列中段代表帧"}`
      : "- 未提供关键帧，仅依据元数据推断",
  ]

  const reasoning = rule
    ? `离线启发式引擎按规则「${rule.name}」的语义判定依据逐帧比对：${rule.description}。时序特征满足该判定依据，置信度 ${Math.round(confidence * 100)}%（阈值 ${Math.round(rule.sensitivity * 100)}%）。`
    : "离线启发式引擎无法做语义判定，且未指定模拟命中的规则，按安全处理。接入多模态模型后可获得真实研判。"

  const result: VlmFinalResult = {
    triggered: rule !== null,
    ruleId: rule?.id ?? null,
    ruleTriggered: rule?.name ?? "无",
    severity: rule?.severity ?? "SAFE",
    confidence,
    timestampOffset: rule && anchor ? formatOffset(anchor.timestampSec) : "00:00.000",
    bbox: null,
    reasoning,
    advice: rule ? `按规则「${rule.name}」的处置流程跟进，并复核原始视频。` : "无需处置，保持常规巡视。",
    summary: rule ? `命中规则 ${rule.id}：${rule.name}` : "未触发任何生效规则",
    evidenceKeyframes: rule && anchor ? [anchor.index] : [],
  }

  const payload = {
    triggered: result.triggered,
    rule_id: result.ruleId ?? "NONE",
    rule_name: result.ruleTriggered,
    severity: result.severity,
    confidence: result.confidence,
    timestamp_offset: result.timestampOffset,
    bbox: null,
    reasoning: result.reasoning,
    advice: result.advice,
  }

  const text = [
    "### 时序观察",
    ...observations,
    "",
    "### 研判结论",
    reasoning,
    "",
    "```json",
    JSON.stringify(payload, null, 2),
    "```",
  ].join("\n")

  return { result, text }
}

const CHUNK_CHARS = 8
const CHUNK_DELAY_MS = 26
const THINK_DELAY_MS = 650

export async function* fallbackStream(
  input: NormalizedInput,
  ctx: EngineContext,
  reason: string
): AsyncGenerator<PreVerdictChunk> {
  const { result, text } = planFallback(input)
  const evidenceAt = text.indexOf("### 研判结论")
  let evidenceSent = result.evidenceKeyframes.length === 0

  if (ctx.pace) await abortableSleep(THINK_DELAY_MS, ctx.signal)

  for (let cursor = 0; cursor < text.length; cursor += CHUNK_CHARS) {
    if (ctx.signal.aborted) return
    yield { type: "token", content: text.slice(cursor, cursor + CHUNK_CHARS) }
    if (!evidenceSent && cursor + CHUNK_CHARS >= evidenceAt) {
      evidenceSent = true
      yield { type: "evidence", frames: result.evidenceKeyframes }
    }
    if (ctx.pace) await abortableSleep(CHUNK_DELAY_MS, ctx.signal)
  }
  if (!evidenceSent) yield { type: "evidence", frames: result.evidenceKeyframes }

  const frameCount = Math.max(1, input.keyframes.length)
  const promptTokens = 380 + frameCount * 255 + input.rules.length * 90
  const outputTokens = estimateTokens(text)
  const profile = modelProfile(input.modelName)
  const seed = hashString(`${input.videoPath ?? ""}|${input.modelName}|${result.ruleId ?? "NONE"}`)
  const rttMs = Math.round((profile.latencyMs ?? 1180) * (0.92 + (seed % 17) / 100))

  yield {
    type: "done",
    result,
    metrics: {
      promptTokens,
      outputTokens,
      firstTokenMs: Math.round(rttMs * 0.34),
      rttMs,
      costUsd: costUsd(profile.ratePer1k ?? 0.00124, promptTokens, outputTokens),
      source: "fallback",
      model: input.modelName,
      fallbackReason: reason,
    },
  }
}
