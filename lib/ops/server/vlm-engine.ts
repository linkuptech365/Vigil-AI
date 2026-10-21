import type { VlmProtocol, VlmStreamChunk } from "../vlm-api-types"
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

async function* runRemote(
  input: NormalizedInput,
  plan: Extract<EnginePlan, { kind: "remote" }>,
  ctx: EngineContext
): AsyncGenerator<PreVerdictChunk, RemoteOutcome> {
  const images = collectImages(input.keyframes, plan.protocol)
  const systemPrompt = buildSystemInstruction(input.rules)
  const userPrompt = buildUserPrompt(input, images.length)

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
    return {
      ok: false,
      aborted: ctx.signal.aborted,
      reason: describeRemoteError(error, plan.url),
      emitted: text.length > 0,
    }
  } finally {
    timeout.dispose()
  }

  const result = parseFinalResult(text, input.rules, input.keyframes)
  if (!result) {
    return {
      ok: false,
      aborted: false,
      reason: text ? "远端输出无法解析为合规 JSON" : "远端模型返回了空内容",
      emitted: text.length > 0,
    }
  }

  const rttMs = Math.max(1, Math.round(performance.now() - startedAt))
  const promptTokens =
    usage && usage.promptTokens > 0
      ? usage.promptTokens
      : estimateTokens(systemPrompt + userPrompt) + images.length * IMAGE_TOKEN_ESTIMATE
  const outputTokens = usage && usage.outputTokens > 0 ? usage.outputTokens : estimateTokens(text)
  const profile = modelProfile(input.modelName)

  yield { type: "evidence", frames: result.evidenceKeyframes }
  yield {
    type: "done",
    result,
    metrics: {
      promptTokens,
      outputTokens,
      firstTokenMs: firstTokenMs || rttMs,
      rttMs,
      costUsd: costUsd(profile.ratePer1k, promptTokens, outputTokens),
      source: "remote",
      model: input.modelName,
      protocol: plan.protocol,
    },
  }
  return { ok: true }
}

async function* withVerdict(
  input: NormalizedInput,
  chunks: AsyncGenerator<PreVerdictChunk>
): AsyncGenerator<VlmStreamChunk> {
  for await (const chunk of chunks) {
    if (chunk.type !== "done") {
      yield chunk
      continue
    }
    const { result, verdict } = applyVerdict(input, chunk.result)
    if (verdict.belowThreshold) yield { type: "evidence", frames: [] }
    yield { type: "done", result, metrics: chunk.metrics, verdict }
  }
}

export function runAnalysis(input: NormalizedInput, ctx: EngineContext): AsyncGenerator<VlmStreamChunk> {
  return withVerdict(input, runPipeline(input, ctx))
}

async function* runPipeline(input: NormalizedInput, ctx: EngineContext): AsyncGenerator<PreVerdictChunk> {
  const frameCount = input.keyframes.length
  yield {
    type: "thinking",
    message: frameCount > 0 ? `正在解析 ${frameCount} 帧时序图像特征...` : "正在解析视频元数据...",
  }

  const plan = planEngine(input, ctx.requestHost)
  let reason: string

  if (plan.kind === "remote") {
    const outcome = yield* runRemote(input, plan, ctx)
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
