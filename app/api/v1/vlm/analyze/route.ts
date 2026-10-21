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
import { runAnalysis } from "@/lib/ops/server/vlm-engine"
import type { EngineContext, NormalizedInput } from "@/lib/ops/server/vlm-shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const MAX_BODY_CHARS = 8_000_000
const MAX_FRAMES = 16
const DEFAULT_MODEL = "qwen2.5-vl-72b"

function fail(message: string, status: number) {
  const body: VlmApiError = { status: "error", message }
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

function normalizeRequest(body: unknown): { input: NormalizedInput } | { error: string } {
  const record = asRecord(body)
  if (!record) return { error: "请求体必须是 JSON 对象" }

  const keyframes = parseKeyframes(record.keyframes)
  if (typeof keyframes === "string") return { error: keyframes }

  const videoPath = cleanText(record.videoPath, 1024)
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
  const ctx: EngineContext = {
    signal: abort.signal,
    pace: parsed.input.stream,
    requestHost: request.headers.get("host"),
  }

  return parsed.input.stream ? streamResponse(parsed.input, ctx, abort) : collectResponse(parsed.input, ctx)
}
