import type { ChunkRecord, VideoItem } from "@/lib/vigil/types"
import type { VlmReasoningResult, VlmSeverity } from "./vlm-types"
import type { VlmFinalResult, VlmMetrics } from "./vlm-api-types"

const SLICE_PREFIX = "slice:"

export interface LocalSlice {
  id: string
  video: VideoItem
  chunk: ChunkRecord
}

export const localSliceId = (videoId: string, index: number) => `${SLICE_PREFIX}${videoId}:${index}`

export function parseLocalSliceId(id: string): { videoId: string; index: number } | null {
  if (!id.startsWith(SLICE_PREFIX)) return null
  const body = id.slice(SLICE_PREFIX.length)
  const split = body.lastIndexOf(":")
  if (split <= 0) return null
  const index = Number(body.slice(split + 1))
  return Number.isInteger(index) ? { videoId: body.slice(0, split), index } : null
}

/** 汇聚全局队列里所有已经开始分析的本地视频切片。 */
export function buildLocalSlices(queue: VideoItem[]): LocalSlice[] {
  return queue.flatMap((video) =>
    (video.chunks ?? [])
      .filter((chunk) => chunk.status !== "pending")
      .map((chunk) => ({ id: localSliceId(video.id, chunk.index), video, chunk }))
  )
}

export function localSliceEventId(slice: LocalSlice) {
  return `EVT-LOCAL-${slice.video.name.replace(/\.[^.]+$/, "").slice(0, 12)}-C${slice.chunk.index}`
}

export function localSliceVerdict(chunk: ChunkRecord) {
  if (chunk.status === "alert") return chunk.ruleName ?? "疑似违规"
  if (chunk.status === "safe") return "合规"
  if (chunk.status === "failed") return "分析失败"
  return "分析中"
}

export function localSliceLabel(slice: LocalSlice) {
  const { chunk, video } = slice
  return `EVT-LOCAL: ${video.name} · CHUNK ${chunk.index}/${chunk.total} [${chunk.startStr}-${chunk.endStr}] ${localSliceVerdict(chunk)}`
}

function clampIndexes(frames: number[], count: number) {
  return Array.from(new Set(frames.filter((f) => Number.isInteger(f) && f >= 0 && f < count)))
}

export function toLocalReasoningResult(
  slice: LocalSlice,
  modelName: string,
  final: VlmFinalResult,
  metrics: VlmMetrics,
  reasoning: string,
  frameCount: number
): VlmReasoningResult {
  const eventId = localSliceEventId(slice)
  const evidence = clampIndexes(final.evidenceKeyframes, frameCount)
  const confidence = Math.round(final.confidence * 1000) / 10
  const steps = deriveSteps(reasoning, final.reasoning)

  return {
    eventId,
    channelId: "LOCAL",
    modelUsed: modelName,
    confidence,
    severity: final.severity as VlmSeverity,
    summary: final.summary,
    reasoningChain: steps,
    evidenceKeyframes: evidence,
    violationClauses: final.triggered ? [final.ruleTriggered] : [],
    actionAdvice: final.advice,
    tokenUsage: { prompt: metrics.promptTokens, completion: metrics.outputTokens, totalCost: metrics.costUsd },
    rawJson: {
      schema_version: "vigil.vlm.v1",
      event_id: eventId,
      source: "local",
      video: slice.video.name,
      chunk: `${slice.chunk.index}/${slice.chunk.total}`,
      chunk_range: `${slice.chunk.startStr}-${slice.chunk.endStr}`,
      model: modelName,
      engine: metrics.source,
      ...(metrics.fallbackReason ? { fallback_reason: metrics.fallbackReason } : {}),
      severity: final.severity,
      confidence: final.confidence,
      summary: final.summary,
      rule_triggered: final.ruleTriggered,
      rule_id: final.ruleId,
      timestamp_offset: final.timestampOffset,
      bbox: final.bbox,
      evidence_keyframes: evidence.map((i) => ({
        index: i,
        timestamp: slice.chunk.frames[i]?.timestamp ?? null,
      })),
      recommended_action: final.advice,
      token_usage: { prompt: metrics.promptTokens, completion: metrics.outputTokens },
      first_token_ms: metrics.firstTokenMs,
      latency_ms: metrics.rttMs,
      human_review_required: final.severity === "CRITICAL",
    },
  }
}

function deriveSteps(reasoning: string, fallback: string) {
  const steps: string[] = []
  let section = ""
  for (const raw of reasoning.split("\n")) {
    const line = raw.trim()
    if (line.startsWith("### ")) section = line.slice(4)
    else if (line.startsWith("```")) section = "json"
    else if (section.includes("时序观察") && line.startsWith("- ")) steps.push(line.slice(2))
    else if (section.includes("研判结论") && line) steps.push(line)
  }
  if (steps.length >= 2) return steps
  return fallback
    .split(/(?<=[。；])/)
    .map((s) => s.trim())
    .filter(Boolean)
}
