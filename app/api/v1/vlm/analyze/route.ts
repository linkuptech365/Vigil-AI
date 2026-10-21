import { NextResponse } from "next/server"

import type {
  VlmAnalyzeResponse,
  VlmApiError,
  VlmFinalResult,
  VlmKeyframeInput,
  VlmMetrics,
  VlmPromptRule,
  VlmSimulationHint,
  VlmSourceType,
  VlmStreamChunk,
  VlmVerdict,
} from "@/lib/ops/vlm-api-types"
import { defaultKeyframes, extractRealFrames, MIN_VALID_BASE64_CHARS } from "@/lib/ops/server/frame-extractor"
import { PathGuardError } from "@/lib/ops/server/path-guard"
import { locateVideo } from "@/lib/ops/server/video-locator"
import { runAnalysis, willCallRemote } from "@/lib/ops/server/vlm-engine"
import type { EngineContext, NormalizedInput } from "@/lib/ops/server/vlm-shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const MAX_BODY_CHARS = 8_000_000
const MAX_FRAMES = 16
const DEFAULT_MODEL = "qwen2.5-vl-72b"

function fail(message: string, status: number, code?: string) {
  const body: VlmApiError = { status: "error", message, ...(code ? { error: code } : {}) }
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function cleanText(value: unknown, max: number) {
  if (typeof value !== "string") return undefined
  const text = value.replace(/[\r\n\t]+/g, " ").trim().slice(0, max)
  return text || undefined
}

function parseKeyframes(value: unknown): VlmKeyframeInput[] | string {
  if (value === undefined) return []
  if (!Array.isArray(value)) return "keyframes 必须是数组"

  const frames: VlmKeyframeInput[] = []
  for (const item of value) {
    const record = asRecord(item)
    if (!record) return "keyframes 中包含无效条目"
    const { index, timestampSec, timecode, motionScore, imageUrl } = record
    if (typeof index !== "number" || !Number.isInteger(index)) return "keyframes[].index 必须是整数"
    if (typeof timestampSec !== "number" || !Number.isFinite(timestampSec)) return "keyframes[].timestampSec 必须是数字"
    frames.push({
      index,
      timestampSec,
      timecode: cleanText(timecode, 16) ?? "--:--",
      ...(typeof motionScore === "number" && Number.isFinite(motionScore) ? { motionScore } : {}),
      ...(typeof imageUrl === "string" && imageUrl ? { imageUrl } : {}),
    })
  }

  if (frames.length <= MAX_FRAMES) return frames
  return Array.from({ length: MAX_FRAMES }, (_, i) => frames[Math.round((i * (frames.length - 1)) / (MAX_FRAMES - 1))])
}

function parseSimulation(value: unknown): VlmSimulationHint | undefined {
  const record = asRecord(value)
  if (!record) return undefined
  const ruleId = cleanText(record.ruleId, 64)
  const confidence = typeof record.confidence === "number" && Number.isFinite(record.confidence) ? record.confidence : undefined
  if (!ruleId && confidence === undefined) return undefined
  return { ruleId, confidence }
}

const SEVERITY_VALUES: ReadonlySet<string> = new Set(["INFO", "WARNING", "CRITICAL"])
const MAX_RULES = 32

function parseRules(value: unknown): VlmPromptRule[] | string {
  if (!Array.isArray(value) || value.length === 0) return "rules 不能为空：当前视频源没有生效的检测规则"
  if (value.length > MAX_RULES) return `rules 最多 ${MAX_RULES} 条`

  const rules: VlmPromptRule[] = []
  const seen = new Set<string>()
  for (const item of value) {
    const record = asRecord(item)
    const id = cleanText(record?.id, 64)
    const name = cleanText(record?.name, 120)
    const description = cleanText(record?.description, 1200)
    if (!record || !id || !name || !description) return "rules 中的每一项都必须包含 id、name、description"
    if (seen.has(id)) return `rules 中存在重复的规则编号 ${id}`
    seen.add(id)

    const sensitivity = typeof record.sensitivity === "number" && Number.isFinite(record.sensitivity) ? record.sensitivity : 0.7
    const severity = typeof record.severity === "string" && SEVERITY_VALUES.has(record.severity) ? record.severity : "WARNING"
    const cooldown = typeof record.cooldownSeconds === "number" && Number.isFinite(record.cooldownSeconds) ? record.cooldownSeconds : 60
    rules.push({
      id,
      name,
      description,
      sensitivity: Math.round(Math.min(1, Math.max(0, sensitivity)) * 100) / 100,
      severity: severity as VlmPromptRule["severity"],
      cooldownSeconds: Math.min(86_400, Math.max(1, Math.round(cooldown))),
    })
  }
  return rules
}

function parseSourceType(value: unknown): VlmSourceType | undefined {
  return value === "local" || value === "channel" ? value : undefined
}

/** 前端视频对象的路径字段并不统一，按优先级宽容取值；最后兜底用文件名交给寻址器补全。 */
function pickVideoPath(record: Record<string, unknown>) {
  for (const key of ["videoPath", "path", "filePath", "name"] as const) {
    const value = cleanText(record[key], 1024)
    if (value) return value
  }
  return undefined
}

function normalizeRequest(body: unknown): { input: NormalizedInput } | { error: string } {
  const record = asRecord(body)
  if (!record) return { error: "请求体必须是 JSON 对象" }

  const keyframes = parseKeyframes(record.keyframes)
  if (typeof keyframes === "string") return { error: keyframes }

  const videoPath = pickVideoPath(record)
  if (!videoPath && keyframes.length === 0) return { error: "需要提供 keyframes 或 videoPath 之一" }

  const rules = parseRules(record.rules)
  if (typeof rules === "string") return { error: rules }

  const sourceType = parseSourceType(record.sourceType)
  const sourceKey = cleanText(record.sourceKey, 256) ?? (sourceType === "local" ? `LOCAL:${videoPath ?? "unknown"}` : "unknown")

  const apiKey = typeof record.apiKey === "string" && record.apiKey.trim() ? record.apiKey.trim().slice(0, 512) : undefined

  return {
    input: {
      videoPath,
      keyframes,
      apiUrl: cleanText(record.apiUrl, 2048),
      apiKey,
      modelName: cleanText(record.modelName, 128) ?? DEFAULT_MODEL,
      sourceType,
      sourceKey,
      rules,
      stream: record.stream !== false,
      remoteStream: record.remoteStream === true,
      simulation: parseSimulation(record.simulation),
    },
  }
}

function streamResponse(input: NormalizedInput, ctx: EngineContext, abort: AbortController) {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: VlmStreamChunk) => {
        if (abort.signal.aborted) return
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
      }
      try {
        for await (const chunk of runAnalysis(input, ctx)) send(chunk)
      } catch (error) {
        send({ type: "error", message: error instanceof Error ? error.message : "推理引擎内部错误" })
      } finally {
        if (!abort.signal.aborted) controller.close()
      }
    },
    cancel() {
      abort.abort()
    },
  })

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}

async function collectResponse(input: NormalizedInput, ctx: EngineContext) {
  let reasoning = ""
  let result: VlmFinalResult | null = null
  let metrics: VlmMetrics | null = null
  let verdict: VlmVerdict | null = null

  for await (const chunk of runAnalysis(input, ctx)) {
    if (chunk.type === "token") reasoning += chunk.content
    else if (chunk.type === "reset") reasoning = ""
    else if (chunk.type === "done") {
      result = chunk.result
      metrics = chunk.metrics
      verdict = chunk.verdict
    } else if (chunk.type === "error") return fail(chunk.message, 500)
  }

  if (!result || !metrics || !verdict) return fail("推理引擎未返回结果", 500)
  const body: VlmAnalyzeResponse = { status: "success", result, metrics, verdict, reasoning }
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } })
}

export async function POST(request: Request) {
  const raw = await request.text()
  if (raw.length > MAX_BODY_CHARS) return fail("请求体过大", 413)

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return fail("请求体不是有效的 JSON", 400)
  }

  const parsed = normalizeRequest(payload)
  if ("error" in parsed) return fail(parsed.error, 400)

  const abort = new AbortController()
  request.signal.addEventListener("abort", () => abort.abort(), { once: true })
  const requestHost = request.headers.get("host")
  const ctx: EngineContext = {
    signal: abort.signal,
    pace: parsed.input.stream,
    requestHost,
  }

  let input = parsed.input
  if (willCallRemote(input, requestHost)) {
    const prepared = await attachRealFrames(input, abort.signal)
    if ("error" in prepared) {
      console.error(`[VLM_ERROR] ${prepared.error}`)
      return fail(prepared.error, 400, prepared.code ?? "NO_VALID_IMAGE_FRAMES")
    }
    input = prepared.input
  }

  return input.stream ? streamResponse(input, ctx, abort) : collectResponse(input, ctx)
}

const FRAME_DATA_PREFIX = "data:image/jpeg;base64,"

function countValidFrames(frames: VlmKeyframeInput[]) {
  return frames.filter((frame) => {
    const url = frame.imageUrl
    if (!url) return false
    const data = url.startsWith("data:") ? url.slice(url.indexOf(",") + 1) : url
    return data.length > MIN_VALID_BASE64_CHARS
  }).length
}

/**
 * 发给远端视觉模型之前，必须让请求里带上真实像素帧。
 * 客户端已带图则直接使用；否则按 videoPath 现场抽帧。没有任何有效帧时返回错误，不发起模型调用。
 */
async function attachRealFrames(
  input: NormalizedInput,
  signal: AbortSignal
): Promise<{ input: NormalizedInput } | { error: string; code?: string }> {
  if (countValidFrames(input.keyframes) > 0) return { input }

  const NO_FRAMES = "视频抽帧失败：未能提取到任何有效图像帧，已终止调用，不会向模型发送纯文本请求。"
  if (!input.videoPath) {
    // 实时通道没有本地文件，保持原有行为（仅元数据推理）
    return input.sourceType === "local" ? { error: `${NO_FRAMES}（缺少 videoPath）` } : { input }
  }

  let resolvedPath: string
  try {
    resolvedPath = (await locateVideo(input.videoPath)).resolved
    console.log(`[VLM_LOCATE] raw=${input.videoPath} resolved=${resolvedPath}`)
  } catch (error) {
    if (!(error instanceof PathGuardError)) throw error
    // 实时通道的 videoPath 只是 "通道/片段" 标识，不是文件，沿用仅元数据推理
    if (input.sourceType !== "local") return { input }
    console.error(`[VLM_ERROR] 无法定位视频物理路径: rawPath=${input.videoPath}, reason=${error.message}`)
    return {
      error: `未能定位到视频文件：${input.videoPath}，请检查是否存放在 vidso/ 或 public/ 目录（${error.message}）`,
      code: "VIDEO_NOT_FOUND",
    }
  }

  try {
    const base = input.keyframes.length > 0 ? input.keyframes : await defaultKeyframes(resolvedPath)
    const { frames, errors } = await extractRealFrames(resolvedPath, base, signal)
    const valid = frames.filter((frame) => frame.base64.length > MIN_VALID_BASE64_CHARS)

    if (valid.length === 0) {
      return { error: `${NO_FRAMES}${errors.length ? `（${errors[0]}）` : ""}` }
    }
    const byIndex = new Map(valid.map((frame) => [frame.index, frame]))
    const keyframes = base.map((keyframe) => {
      const frame = byIndex.get(keyframe.index)
      return frame ? { ...keyframe, imageUrl: `${FRAME_DATA_PREFIX}${frame.base64}` } : keyframe
    })
    return { input: { ...input, keyframes } }
  } catch (error) {
    if (input.sourceType !== "local" && error instanceof PathGuardError) return { input }
    return { error: `${NO_FRAMES}（${error instanceof Error ? error.message : "未知错误"}）` }
  }
}
