import type { VlmProtocol, VlmStreamChunk } from "../vlm-api-types"
import { recordVlmCall, type RecordVlmCallInput } from "@/lib/storage/vlm-call-store"
import { isBlockedHost, isGatewayItself, isLocalHost } from "./url-guard"
import { fallbackStream } from "./vlm-fallback"
import { buildSystemInstruction, buildUserPrompt } from "./vlm-prompt"
import { parseFinalResult } from "./vlm-parse"
import {
  collectImages,
  describeRemoteError,
  detectProtocol,
  normalizeEndpoint,
  protocolLabel,
  streamRemote,
} from "./vlm-remote"
import { applyVerdict, type PreVerdictChunk } from "./vlm-verdict"
import {
  costUsd,
  estimateTokens,
  modelProfile,
  withTimeout,
  type EngineContext,
  type NormalizedInput,
} from "./vlm-shared"

const REMOTE_TIMEOUT_MS = 30_000
const IMAGE_TOKEN_ESTIMATE = 300

type EnginePlan =
  | { kind: "remote"; url: URL; protocol: VlmProtocol }
  | { kind: "fallback"; reason: string }

type RemoteOutcome =
  | { ok: true }
  | { ok: false; aborted: boolean; reason: string; emitted: boolean }

/** 远端调用成功后暂存的流水，待二级裁决（告警/忽略）出来后一并落盘。 */
interface CallTrace {
  pending: RecordVlmCallInput | null
}

type CallBase = Pick<
  RecordVlmCallInput,
  "trigger" | "streamId" | "streamName" | "alertId" | "model" | "protocol" | "rules" | "systemPrompt" | "userPrompt" | "imageUrls"
>

function recordCall(ctx: EngineContext, entry: RecordVlmCallInput) {
  try {
    ctx.call?.onRecorded?.(recordVlmCall(entry))
  } catch (error) {
    console.error("[vlm-call-log] 记录调用流水失败：", error instanceof Error ? error.message : error)
  }
}

function planEngine(input: NormalizedInput, requestHost: string | null): EnginePlan {
  if (!input.apiUrl) return { kind: "fallback", reason: "未配置模型 API 端点" }

  let url: URL
  try {
    url = normalizeEndpoint(input.apiUrl)
  } catch {
    return { kind: "fallback", reason: "API 端点格式无效" }
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { kind: "fallback", reason: "仅支持 http(s) 协议的模型端点" }
  }
  if (isBlockedHost(url.hostname)) {
    return { kind: "fallback", reason: "该地址属于云元数据保留网段，已拒绝访问" }
  }
  if (isGatewayItself(url, requestHost)) {
    return { kind: "fallback", reason: "端点指向本网关自身，未配置外部模型" }
  }
  if (!input.apiKey && !isLocalHost(url.hostname)) {
    return { kind: "fallback", reason: "未配置 API Key" }
  }
  return { kind: "remote", url, protocol: detectProtocol(url) }
}

/** 本次请求是否会真正调用远端模型（否则走离线启发式，不需要像素帧） */
export function willCallRemote(input: NormalizedInput, requestHost: string | null) {
  return planEngine(input, requestHost).kind === "remote"
}

async function* runRemote(
  input: NormalizedInput,
  plan: Extract<EnginePlan, { kind: "remote" }>,
  ctx: EngineContext,
  trace: CallTrace
): AsyncGenerator<PreVerdictChunk, RemoteOutcome> {
  const images = collectImages(input.keyframes, plan.protocol)
  const systemPrompt = buildSystemInstruction(input.rules, input.tier1Existing)
  const userPrompt = buildUserPrompt(input, images.length)
  const meta = ctx.call ?? { trigger: "manual" as const, streamId: input.sourceKey }
  const base: CallBase = {
    trigger: meta.trigger,
    streamId: meta.streamId ?? null,
    streamName: meta.streamName,
    alertId: meta.alertId ?? null,
    model: input.modelName,
    protocol: plan.protocol,
    rules: input.rules.map((rule) => ({ id: rule.id, name: rule.name, description: rule.description })),
    systemPrompt,
    userPrompt,
    imageUrls: images.map((image) => image.url),
  }

  yield {
    type: "thinking",
    message:
      images.length > 0
        ? `正在调用 ${protocolLabel(plan.protocol)} 端点，附带 ${images.length} 帧画面...`
        : `正在调用 ${protocolLabel(plan.protocol)} 端点（未附带像素帧，仅依据时序元数据推理）...`,
  }

  const timeout = withTimeout(ctx.signal, REMOTE_TIMEOUT_MS)
  const startedAt = performance.now()
  let text = ""
  let firstTokenMs = 0
  let usage: { promptTokens: number; outputTokens: number } | null = null

  const recordFailure = (error: string) => {
    // 网关没有任何响应时没有产生扣费，不估算 Token；已收到内容或 usage 才计入
    const consumed = usage !== null || text.length > 0
    const promptTokens = usage?.promptTokens || (consumed ? estimateTokens(systemPrompt + userPrompt) + images.length * IMAGE_TOKEN_ESTIMATE : 0)
    const completionTokens = usage?.outputTokens || estimateTokens(text)
    recordCall(ctx, {
      ...base,
      status: "failed",
      outcome: "ERROR",
      summary: error,
      output: text,
      rttMs: performance.now() - startedAt,
      promptTokens,
      completionTokens,
      usageEstimated: consumed && usage === null,
      costUsd: costUsd(modelProfile(input.modelName).ratePer1k, promptTokens, completionTokens),
      error,
    })
  }

  try {
    for await (const event of streamRemote({
      url: plan.url,
      protocol: plan.protocol,
      apiKey: input.apiKey,
      model: input.modelName,
      system: systemPrompt,
      user: userPrompt,
      images,
      stream: input.remoteStream,
      signal: timeout.signal,
    })) {
      if (event.kind === "usage") {
        usage = { promptTokens: event.promptTokens, outputTokens: event.outputTokens }
        continue
      }
      if (text === "") firstTokenMs = Math.max(1, Math.round(performance.now() - startedAt))
      text += event.content
      yield { type: "token", content: event.content }
    }
  } catch (error) {
    const reason = ctx.signal.aborted ? "调用方已取消请求" : describeRemoteError(error, plan.url)
    recordFailure(reason)
    return {
      ok: false,
      aborted: ctx.signal.aborted,
      reason: describeRemoteError(error, plan.url),
      emitted: text.length > 0,
    }
  } finally {
    timeout.dispose()
  }

  console.log(
    `[VLM_RESPONSE] 模型 ${input.modelName} 返回 ${text.length} 字符，耗时 ${Math.round(performance.now() - startedAt)}ms，请求挂载 ${images.length} 帧`
  )
  const result = parseFinalResult(text, input.rules, input.keyframes)
  if (!result) {
    const reason = text ? "远端输出无法解析为合规 JSON" : "远端模型返回了空内容"
    recordFailure(reason)
    return { ok: false, aborted: false, reason, emitted: text.length > 0 }
  }

  const rttMs = Math.max(1, Math.round(performance.now() - startedAt))
  const promptTokens =
    usage && usage.promptTokens > 0
      ? usage.promptTokens
      : estimateTokens(systemPrompt + userPrompt) + images.length * IMAGE_TOKEN_ESTIMATE
  const outputTokens = usage && usage.outputTokens > 0 ? usage.outputTokens : estimateTokens(text)
  const profile = modelProfile(input.modelName)
  const cost = costUsd(profile.ratePer1k, promptTokens, outputTokens)

  trace.pending = {
    ...base,
    status: "dismissed",
    outcome: "SAFE",
    output: text,
    rttMs,
    promptTokens,
    completionTokens: outputTokens,
    usageEstimated: !(usage && usage.promptTokens > 0 && usage.outputTokens > 0),
    costUsd: cost,
  }

  yield { type: "evidence", frames: result.evidenceKeyframes }
  yield {
    type: "done",
    result,
    metrics: {
      promptTokens,
      outputTokens,
      firstTokenMs: firstTokenMs || rttMs,
      rttMs,
      costUsd: cost,
      source: "remote",
      model: input.modelName,
      protocol: plan.protocol,
    },
  }
  return { ok: true }
}

async function* withVerdict(
  input: NormalizedInput,
  chunks: AsyncGenerator<PreVerdictChunk>,
  ctx: EngineContext,
  trace: CallTrace
): AsyncGenerator<VlmStreamChunk> {
  for await (const chunk of chunks) {
    if (chunk.type !== "done") {
      yield chunk
      continue
    }
    const { result, verdict } = applyVerdict(input, chunk.result)
    if (trace.pending) {
      const outcome = verdict.excluded
        ? "EXCLUDED"
        : verdict.belowThreshold
          ? "BELOW_THRESHOLD"
          : verdict.shadowReview
            ? "SHADOW"
            : verdict.triggered
              ? verdict.suppression?.suppressed
                ? "FOLDED"
                : "ALARM"
              : "SAFE"
      recordCall(ctx, {
        ...trace.pending,
        status: outcome === "ALARM" || outcome === "FOLDED" ? "alarm" : "dismissed",
        outcome,
        ruleName: verdict.ruleName ?? result.ruleTriggered,
        confidence: result.confidence,
        summary: result.summary,
      })
      trace.pending = null
    }
    if (verdict.belowThreshold) yield { type: "evidence", frames: [] }
    yield { type: "done", result, metrics: chunk.metrics, verdict }
  }
}

export function runAnalysis(input: NormalizedInput, ctx: EngineContext): AsyncGenerator<VlmStreamChunk> {
  const trace: CallTrace = { pending: null }
  return withVerdict(input, runPipeline(input, ctx, trace), ctx, trace)
}

async function* runPipeline(input: NormalizedInput, ctx: EngineContext, trace: CallTrace): AsyncGenerator<PreVerdictChunk> {
  const frameCount = input.keyframes.length
  yield {
    type: "thinking",
    message: frameCount > 0 ? `正在解析 ${frameCount} 帧时序图像特征...` : "正在解析视频元数据...",
  }

  const plan = planEngine(input, ctx.requestHost)
  let reason: string

  if (plan.kind === "remote") {
    const outcome = yield* runRemote(input, plan, ctx, trace)
    if (outcome.ok || outcome.aborted) return
    reason = outcome.reason
    if (outcome.emitted) yield { type: "reset", reason }
  } else {
    reason = plan.reason
  }

  if (ctx.signal.aborted) return
  yield { type: "thinking", message: `${reason}，已切换内置时序启发式引擎（离线模拟）` }
  yield* fallbackStream(input, ctx, reason)
}
