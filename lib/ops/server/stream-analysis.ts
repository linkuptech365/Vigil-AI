import { randomUUID } from "node:crypto"

import { matchRulesForSource, ruleDescription, ruleSensitivity } from "@/lib/ops/rule-binding"
import type { VlmFinalResult, VlmKeyframeInput, VlmMetrics, VlmPromptRule, VlmVerdict } from "@/lib/ops/vlm-api-types"
import { MIN_VALID_BASE64_CHARS } from "@/lib/ops/server/frame-extractor"
import { getProfile, resolveEndpointUrl } from "@/lib/ops/server/model-profiles"
import { feedbackFromAnalysis, tier1ExistingForSource } from "@/lib/ops/server/tier1-feedback"
import { runAnalysis } from "@/lib/ops/server/vlm-engine"
import { loadRules } from "@/lib/storage/rules-store"
import { loadProfiles } from "@/lib/storage/model-store"
import { fireAutoLinkage } from "@/lib/ops/server/alert-linkage"
import { appendRecord, getStream, recordAnalysis, saveAlert } from "@/lib/storage/streams-store"
import { ensureEngine, grabFrame } from "@/lib/stream-engine"
import { profileReadiness } from "@/lib/vigil/model-registry"
import type { AnalyzeStreamResponse, StreamAlert, StreamAlertSource } from "@/lib/vigil/streams"

export class StreamAnalysisError extends Error {
  status: number
  code: string
  constructor(message: string, status: number, code: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export interface AnalyzeStreamOptions {
  streamId: string
  source: StreamAlertSource
  frameCount?: number
  intervalMs?: number
  modelProfileId?: string
  /** 边缘端已抓好的帧（Base64 或 data URL）；提供后不再从引擎抓帧 */
  providedFrames?: string[]
  edge?: { trackId: string; edgeConfidence: number; label?: string }
  requestHost: string | null
  signal: AbortSignal
}

export interface AnalyzeStreamOutcome extends AnalyzeStreamResponse {
  verdictDetail: VlmVerdict
  result: VlmFinalResult
}

const FRAME_WIDTH = 960
const MAX_FRAMES = 6

function timecode(seconds: number) {
  const whole = Math.floor(seconds)
  const ms = Math.round((seconds - whole) * 1000)
  const mm = String(Math.floor(whole / 60)).padStart(2, "0")
  const ss = String(whole % 60).padStart(2, "0")
  return `${mm}:${ss}.${String(ms).padStart(3, "0")}`
}

function decodeProvided(frames: string[]) {
  const buffers: Buffer[] = []
  for (const raw of frames.slice(0, MAX_FRAMES)) {
    const base64 = raw.startsWith("data:") ? raw.slice(raw.indexOf(",") + 1) : raw
    if (base64.length < MIN_VALID_BASE64_CHARS) continue
    const buffer = Buffer.from(base64, "base64")
    if (buffer.length > 4_000_000) continue
    buffers.push(buffer)
  }
  return buffers
}

async function captureFrames(streamId: string, count: number, intervalMs: number, signal: AbortSignal) {
  await ensureEngine({ waitMs: 5_000 })
  const buffers: Buffer[] = []
  for (let i = 0; i < count; i += 1) {
    if (signal.aborted) throw new StreamAnalysisError("请求已取消", 499, "ABORTED")
    try {
      const frame = await grabFrame(streamId, { width: FRAME_WIDTH, timeoutMs: i === 0 ? 20_000 : 8_000, signal })
      buffers.push(frame.buffer)
    } catch (error) {
      if (buffers.length === 0) {
        const message = error instanceof Error ? error.message : "抓帧失败"
        throw new StreamAnalysisError(`无法获取通道画面：${message}`, 502, "STREAM_OFFLINE")
      }
      break
    }
    if (i < count - 1) await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return buffers
}

function resolveProfile(modelProfileId?: string) {
  const profile = modelProfileId ? getProfile(modelProfileId) : (loadProfiles().find((p) => p.isDefault && p.enabled) ?? null)
  if (!profile) {
    throw new StreamAnalysisError(
      modelProfileId ? `模型档案 ${modelProfileId} 不存在，请到配置中心检查模型网关` : "没有可用的默认模型，请先在配置中心启用一个模型",
      400,
      "MODEL_NOT_FOUND"
    )
  }
  const readiness = profileReadiness({ ...profile, hasKey: profile.apiKey.length > 0 })
  if (!readiness.ready) {
    throw new StreamAnalysisError(`模型「${profile.name}」尚未就绪：${readiness.reason}。请到配置中心完善后重试`, 400, "MODEL_NOT_READY")
  }
  return profile
}

/** 任何一次研判（含失败）都会落一条记录，右侧告警流可以据此解释“为什么没有告警”。 */
export async function analyzeStream(options: AnalyzeStreamOptions): Promise<AnalyzeStreamOutcome> {
  try {
    return await runAnalysis_(options)
  } catch (error) {
    const meta = getStream(options.streamId)
    if (meta && !(error instanceof StreamAnalysisError && error.code === "ABORTED")) {
      appendRecord({
        at: new Date().toISOString(),
        streamId: meta.id,
        streamName: meta.name,
        source: options.source,
        outcome: "error",
        summary: error instanceof Error ? error.message : "研判失败",
        reason: error instanceof StreamAnalysisError ? error.code : "INTERNAL",
        edge: options.edge,
      })
    }
    throw error
  }
}

async function runAnalysis_(options: AnalyzeStreamOptions): Promise<AnalyzeStreamOutcome> {
  const meta = getStream(options.streamId)
  if (!meta) throw new StreamAnalysisError(`通道 ${options.streamId} 不存在`, 404, "STREAM_NOT_FOUND")

  const profile = resolveProfile(options.modelProfileId)

  const promptRules: VlmPromptRule[] = matchRulesForSource(loadRules(), { kind: "channel", channelId: meta.id }).map((rule) => ({
    id: rule.id,
    name: rule.name,
    description: ruleDescription(rule),
    sensitivity: ruleSensitivity(rule),
    severity: rule.severity,
    cooldownSeconds: rule.cooldownSeconds,
  }))
  if (promptRules.length === 0) {
    throw new StreamAnalysisError("该通道没有生效的稽查规则，请在规则库中把规则绑定到「全部视频源」", 409, "NO_RULES")
  }

  const count = Math.min(MAX_FRAMES, Math.max(1, options.frameCount ?? 4))
  const frames = options.providedFrames?.length
    ? decodeProvided(options.providedFrames)
    : await captureFrames(meta.id, count, options.intervalMs ?? 700, options.signal)
  if (frames.length === 0) throw new StreamAnalysisError("没有获取到有效的画面帧", 400, "NO_VALID_IMAGE_FRAMES")

  const capturedAt = new Date()
  const step = (options.intervalMs ?? 700) / 1000
  const keyframes: VlmKeyframeInput[] = frames.map((buffer, i) => ({
    index: i + 1,
    timestampSec: i * step,
    timecode: timecode(i * step),
    imageUrl: `data:image/jpeg;base64,${buffer.toString("base64")}`,
  }))

  let result: VlmFinalResult | null = null
  let metrics: VlmMetrics | null = null
  let verdict: VlmVerdict | null = null
  let errorMessage = ""

  const stream = runAnalysis(
    {
      keyframes,
      apiUrl: resolveEndpointUrl(profile),
      apiKey: profile.apiKey || undefined,
      modelName: profile.modelName,
      sourceType: "channel",
      sourceKey: meta.id,
      rules: promptRules,
      stream: false,
      remoteStream: false,
      tier1Existing: tier1ExistingForSource("channel", meta.id),
    },
    { signal: options.signal, pace: false, requestHost: options.requestHost }
  )
  for await (const chunk of stream) {
    if (chunk.type === "done") {
      result = chunk.result
      metrics = chunk.metrics
      verdict = chunk.verdict
      feedbackFromAnalysis("channel", meta.id, chunk.result, chunk.verdict)
    } else if (chunk.type === "error") {
      errorMessage = chunk.message
    }
  }

  if (!result || !metrics || !verdict) {
    recordAnalysis(meta.id, { at: capturedAt.toISOString(), status: "error", summary: errorMessage || "研判未返回结果" })
    throw new StreamAnalysisError(errorMessage || "研判未返回结果", 502, "ANALYSIS_FAILED")
  }

  let alert: StreamAlert | null = null
  const hit = verdict.triggered && result.ruleId
  const folded = verdict.suppression?.suppressed === true

  if (hit && !folded) {
    const created: StreamAlert = {
      id: randomUUID(),
      source: options.source,
      streamId: meta.id,
      streamName: meta.name,
      zone: meta.zone,
      triggeredAt: capturedAt.toISOString(),
      ruleId: result.ruleId as string,
      ruleName: result.ruleTriggered,
      severity: result.severity as StreamAlert["severity"],
      confidence: result.confidence,
      summary: result.summary,
      reasoning: result.reasoning,
      advice: result.advice,
      frames: keyframes.map((frame) => ({
        index: frame.index,
        timecode: frame.timecode,
        capturedAt: new Date(capturedAt.getTime() + frame.timestampSec * 1000).toISOString(),
      })),
      evidenceKeyframes: result.evidenceKeyframes,
      model: metrics.model,
      engineSource: metrics.source,
      edge: options.edge,
    }
    saveAlert(created, frames)
    alert = created
    void fireAutoLinkage(created.id).catch((error) => console.error("[linkage] 自动联动失败：", error))
  }

  recordAnalysis(meta.id, {
    at: capturedAt.toISOString(),
    status: hit ? "alert" : "safe",
    ruleName: hit ? result.ruleTriggered : undefined,
    confidence: result.confidence,
    summary: result.summary,
    alertId: alert?.id,
  })

  const edgeRejected = Boolean(options.edge) && !hit
  appendRecord({
    at: capturedAt.toISOString(),
    streamId: meta.id,
    streamName: meta.name,
    source: options.source,
    outcome: alert ? "alert" : hit ? "folded" : "safe",
    ruleName: hit ? result.ruleTriggered : undefined,
    confidence: result.confidence,
    summary: result.summary,
    reason: alert
      ? undefined
      : hit
        ? `防抖冷却窗口（${verdict.suppression?.windowSeconds ?? "-"} 秒）内重复触发，已折叠进既有事件证据链，不重复发告警`
        : verdict.belowThreshold
          ? "命中规则但置信度低于规则灵敏度阈值，未触发告警"
          : "大模型复核后判定画面无违规",
    alertId: alert?.id,
    edge: options.edge,
    hardSample: edgeRejected && (options.edge?.edgeConfidence ?? 0) >= 0.8 ? true : undefined,
  })

  return {
    status: "success",
    verdict: hit ? "alert" : "safe",
    summary: result.summary,
    confidence: result.confidence,
    ruleName: hit ? result.ruleTriggered : null,
    alert,
    frameCount: frames.length,
    model: metrics.model,
    engineSource: metrics.source,
    verdictDetail: verdict,
    result,
  }
}
