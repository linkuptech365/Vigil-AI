import type { VlmKeyframeInput, VlmProtocol } from "../vlm-api-types"
import { isBlockedHost } from "./url-guard"

export class RemoteError extends Error {}

const MAX_IMAGES = 8
const MAX_IMAGE_CHARS = 2_500_000
const DATA_IMAGE = /^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/
const MODEL_ALIASES: Record<string, string> = {
  "gpt-4o-mini-video": "gpt-4o-mini",
  "qwen2.5-vl-72b": "qwen2.5-vl-72b-instruct",
}

export function detectProtocol(url: URL): VlmProtocol {
  const path = url.pathname.toLowerCase()
  if (path.includes("multimodal-generation")) return "dashscope"
  if (path.endsWith("/api/chat")) return "ollama"
  return "openai"
}

/** 去掉末尾斜杠；OpenAI 协议下仅给到 `/v1` 时补全 `/chat/completions`，已完整的路径保持原样 */
export function normalizeEndpoint(raw: string) {
  const url = new URL(raw.trim())
  const path = url.pathname.replace(/\/+$/, "")
  url.pathname = path || "/"
  if (detectProtocol(url) === "openai" && /\/v\d+$/i.test(path)) {
    url.pathname = `${path}/chat/completions`
  }
  return url
}

export function protocolLabel(protocol: VlmProtocol) {
  if (protocol === "dashscope") return "DashScope"
  if (protocol === "ollama") return "Ollama"
  return "OpenAI 兼容"
}

function isSafeHttps(raw: string) {
  try {
    const url = new URL(raw)
    return url.protocol === "https:" && !isBlockedHost(url.hostname)
  } catch {
    return false
  }
}

export function collectImages(frames: VlmKeyframeInput[], protocol: VlmProtocol) {
  const images: string[] = []
  for (const frame of frames) {
    if (images.length >= MAX_IMAGES) break
    const url = frame.imageUrl
    if (!url || url.length > MAX_IMAGE_CHARS) continue
    if (DATA_IMAGE.test(url)) images.push(url)
    else if (protocol !== "ollama" && isSafeHttps(url)) images.push(url)
  }
  return images
}

export interface RemoteCall {
  url: URL
  protocol: VlmProtocol
  apiKey?: string
  model: string
  system: string
  user: string
  images: string[]
  /** OpenAI 协议下是否请求 SSE 流式输出；false 时发送 `stream: false` */
  stream: boolean
  signal: AbortSignal
}

export type RemoteEvent =
  | { kind: "token"; content: string }
  | { kind: "usage"; promptTokens: number; outputTokens: number }

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function pickNumber(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key]
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        const record = asRecord(part)
        return record && typeof record.text === "string" ? record.text : ""
      })
      .join("")
  }
  return ""
}

function buildBody(call: RemoteCall): Record<string, unknown> {
  const model = call.protocol === "ollama" ? call.model : (MODEL_ALIASES[call.model] ?? call.model)

  if (call.protocol === "ollama") {
    const images = call.images.map((url) => url.slice(url.indexOf(",") + 1))
    return {
      model,
      messages: [
        { role: "system", content: call.system },
        { role: "user", content: call.user, ...(images.length ? { images } : {}) },
      ],
      stream: true,
      options: { temperature: 0.2 },
    }
  }

  if (call.protocol === "dashscope") {
    return {
      model,
      input: {
        messages: [
          { role: "system", content: [{ text: call.system }] },
          { role: "user", content: [...call.images.map((image) => ({ image })), { text: call.user }] },
        ],
      },
      parameters: { result_format: "message" },
    }
  }

  const userContent = call.images.length
    ? [{ type: "text", text: call.user }, ...call.images.map((url) => ({ type: "image_url", image_url: { url } }))]
    : call.user
  return {
    model,
    messages: [
      { role: "system", content: call.system },
      { role: "user", content: userContent },
    ],
    stream: call.stream,
    ...(call.stream ? { stream_options: { include_usage: true } } : {}),
    temperature: 0.2,
    max_tokens: 1500,
  }
}

async function* readLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline = buffer.indexOf("\n")
      while (newline >= 0) {
        yield buffer.slice(0, newline).replace(/\r$/, "")
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf("\n")
      }
    }
    buffer += decoder.decode()
    if (buffer) yield buffer
  } finally {
    reader.releaseLock()
  }
}

function* sliceText(text: string, size = 24) {
  for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size)
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function errorDetail(json: unknown) {
  const record = asRecord(json)
  if (!record) return ""
  const error = record.error
  const candidate =
    typeof error === "string" ? error : (asRecord(error)?.message ?? record.message ?? record.detail)
  return typeof candidate === "string" ? candidate.slice(0, 120) : ""
}

function statusReason(status: number) {
  if (status === 401 || status === 403) return "鉴权失败，请检查 API Key"
  if (status === 404) return "接口路径不存在，请检查端点 URL 与模型名称"
  if (status === 400 || status === 422) return "请求参数错误，请检查模型名称与请求参数"
  if (status === 413) return "请求体过大，请减少抽帧数量或压缩图片"
  if (status === 429) return "触发限流或额度不足"
  if (status >= 500) return "远端服务内部错误"
  return "请求被拒绝"
}

export function logRemoteError(response: Pick<Response, "status" | "statusText">, body: string) {
  console.error(`[VLM Remote Error] HTTP ${response.status} ${response.statusText} | Body: ${body.slice(0, 300)}`)
}

function snippet(text: string, max = 100) {
  return text.replace(/\s+/g, " ").trim().slice(0, max)
}

async function* textLines(text: string): AsyncGenerator<string> {
  for (const line of text.split("\n")) yield line.replace(/\r$/, "")
}

async function* openaiSseEvents(lines: AsyncIterable<string>): AsyncGenerator<RemoteEvent> {
  for await (const line of lines) {
    if (!line.startsWith("data:")) continue
    const payload = line.slice(5).trim()
    if (!payload) continue
    if (payload === "[DONE]") return
    const record = asRecord(parseJson(payload))
    if (!record) continue
    if (record.error) {
      console.error(`[VLM Remote Error] SSE error event | Body: ${payload.slice(0, 300)}`)
      throw new RemoteError(`流式响应返回错误${errorDetail(record) ? `（${errorDetail(record)}）` : ""}`)
    }
    const choice = Array.isArray(record.choices) ? asRecord(record.choices[0]) : null
    const content = textFromContent(asRecord(choice?.delta)?.content)
    if (content) yield { kind: "token", content }
    const usage = asRecord(record.usage)
    if (usage) {
      yield {
        kind: "usage",
        promptTokens: pickNumber(usage, "prompt_tokens") ?? 0,
        outputTokens: pickNumber(usage, "completion_tokens") ?? 0,
      }
    }
  }
}

export async function* streamRemote(call: RemoteCall): AsyncGenerator<RemoteEvent> {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (call.apiKey) headers.Authorization = `Bearer ${call.apiKey}`

  const response = await fetch(call.url, {
    method: "POST",
    headers,
    body: JSON.stringify(buildBody(call)),
    redirect: "manual",
    cache: "no-store",
    signal: call.signal,
  })

  if (response.status >= 300 && response.status < 400) {
    logRemoteError(response, response.headers.get("location") ?? "")
    throw new RemoteError(`HTTP ${response.status} 重定向，请直接填写最终地址`)
  }
  if (!response.ok) {
    const raw = await response.text().catch(() => "")
    logRemoteError(response, raw)
    const detail = errorDetail(parseJson(raw))
    throw new RemoteError(
      `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}：${statusReason(response.status)}${detail ? `（${detail}）` : ""}`
    )
  }
  if (!response.body) throw new RemoteError("端点未返回响应体")

  const contentType = response.headers.get("content-type") ?? ""

  if (call.protocol === "ollama") {
    for await (const line of readLines(response.body)) {
      if (!line.trim()) continue
      const record = asRecord(parseJson(line))
      if (!record) continue
      const content = textFromContent(asRecord(record.message)?.content)
      if (content) yield { kind: "token", content }
      if (record.done === true) {
        yield {
          kind: "usage",
          promptTokens: pickNumber(record, "prompt_eval_count") ?? 0,
          outputTokens: pickNumber(record, "eval_count") ?? 0,
        }
      }
    }
    return
  }

  if (call.protocol === "openai" && contentType.includes("text/event-stream")) {
    yield* openaiSseEvents(readLines(response.body))
    return
  }

  const raw = await response.text()
  // 部分网关忽略 stream:false 或不带 SSE 的 Content-Type，按内容识别，避免直接 JSON.parse 抛语法错误
  if (call.protocol === "openai" && /^\s*data:/.test(raw)) {
    yield* openaiSseEvents(textLines(raw))
    return
  }

  const json = asRecord(parseJson(raw))
  if (!json) {
    logRemoteError(response, raw)
    throw new RemoteError(`HTTP ${response.status} 响应不是有效的 JSON${raw.trim() ? `（${snippet(raw)}）` : "（空响应体）"}，请检查端点路径是否为 /chat/completions`)
  }
  if (json.error && !json.choices && !json.output) {
    logRemoteError(response, raw)
    const detail = errorDetail(json)
    throw new RemoteError(`远端返回错误${detail ? `（${detail}）` : ""}`)
  }

  if (call.protocol === "dashscope") {
    const output = asRecord(json.output)
    const choice = Array.isArray(output?.choices) ? asRecord(output.choices[0]) : null
    const text = textFromContent(asRecord(choice?.message)?.content) || (typeof output?.text === "string" ? output.text : "")
    for (const piece of sliceText(text)) yield { kind: "token", content: piece }
    const usage = asRecord(json.usage)
    if (usage) {
      yield {
        kind: "usage",
        promptTokens: pickNumber(usage, "input_tokens") ?? 0,
        outputTokens: pickNumber(usage, "output_tokens") ?? 0,
      }
    }
    return
  }

  const choice = Array.isArray(json.choices) ? asRecord(json.choices[0]) : null
  const text = textFromContent(asRecord(choice?.message)?.content)
  for (const piece of sliceText(text)) yield { kind: "token", content: piece }
  const usage = asRecord(json.usage)
  if (usage) {
    yield {
      kind: "usage",
      promptTokens: pickNumber(usage, "prompt_tokens") ?? 0,
      outputTokens: pickNumber(usage, "completion_tokens") ?? 0,
    }
  }
}

export function describeRemoteError(error: unknown, url: URL) {
  if (error instanceof RemoteError) return error.message
  const name = error instanceof Error ? error.name : ""
  const cause = error instanceof Error ? (error.cause as { code?: string } | undefined) : undefined
  const code = cause?.code ?? ""
  console.error(
    `[VLM Remote Error] Network | ${name || "Error"} ${code} ${error instanceof Error ? error.message : String(error)} | ${url.origin}${url.pathname}`
  )

  if (name === "TimeoutError" || name === "AbortError" || code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT") {
    return "远端模型 30s 内无响应（超时）"
  }
  if (code === "ECONNREFUSED") return `连接被拒绝：${url.host} 上没有服务在监听`
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return `DNS 解析失败：无法解析主机名 ${url.hostname}`
  if (code === "ECONNRESET" || code === "UND_ERR_SOCKET") return "连接被对端重置，请检查 http/https 协议是否一致"
  if (code.startsWith("CERT_") || code.includes("SELF_SIGNED") || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") {
    return "TLS 证书校验失败"
  }
  return `请求失败：${error instanceof Error ? error.message : "未知错误"}`
}
