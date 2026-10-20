import type { VlmProtocol, VlmStreamChunk } from "../vlm-api-types"
import { isBlockedHost, isGatewayItself, isLocalHost } from "./url-guard"
import { fallbackStream } from "./vlm-fallback"
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  collectImages,
  describeRemoteError,
  detectProtocol,
  parseFinalResult,
  protocolLabel,
  streamRemote,
} from "./vlm-remote"
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
    url = new URL(input.apiUrl)
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
): AsyncGenerator<VlmStreamChunk, RemoteOutcome> {
  const images = collectImages(input.keyframes, plan.protocol)
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
      system: SYSTEM_PROMPT,
      user: userPrompt,
      images,
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

  const validIndices = new Set(input.keyframes.map((frame) => frame.index))
  const result = parseFinalResult(text, validIndices)
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
      : estimateTokens(SYSTEM_PROMPT + userPrompt) + images.length * IMAGE_TOKEN_ESTIMATE
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

export async function* runAnalysis(
  input: NormalizedInput,
  ctx: EngineContext
): AsyncGenerator<VlmStreamChunk> {
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
