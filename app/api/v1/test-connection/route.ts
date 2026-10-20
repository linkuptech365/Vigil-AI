import { NextResponse } from "next/server"

import type {
  ConnectionTestRequest,
  ConnectionTestResponse,
  HealthResponse,
} from "@/lib/ops/api-types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const PROBE_TIMEOUT_MS = 4000
const MAX_BODY_CHARS = 65536
const GATEWAY_PORT = process.env.PORT ?? "3000"
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])
const REACHABLE_WITH_JSON = new Set([400, 401, 403, 422])

function respond(payload: Omit<ConnectionTestResponse, "timestamp">, status: number) {
  const body: ConnectionTestResponse = { ...payload, timestamp: new Date().toISOString() }
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

function fail(message: string, endpoint: string, rttMs = 0) {
  return respond({ status: "error", rttMs, modelDetected: "", endpoint, message }, 400)
}

function parseRequest(body: unknown): ConnectionTestRequest | null {
  if (!body || typeof body !== "object") return null
  const { apiUrl, apiKey, modelName } = body as Record<string, unknown>
  if (typeof apiUrl !== "string") return null
  return {
    apiUrl: apiUrl.trim(),
    apiKey: typeof apiKey === "string" && apiKey.trim() ? apiKey.trim() : undefined,
    modelName: typeof modelName === "string" && modelName.trim() ? modelName.trim() : undefined,
  }
}

function isBlockedHost(hostname: string) {
  return (
    hostname.startsWith("169.254.") ||
    hostname === "metadata.google.internal" ||
    hostname === "[fd00:ec2::254]"
  )
}

function isGatewayItself(url: URL, requestHost: string | null) {
  const port = url.port || (url.protocol === "https:" ? "443" : "80")
  const onLoopbackPort = LOCAL_HOSTS.has(url.hostname) && port === GATEWAY_PORT
  return onLoopbackPort || (requestHost !== null && url.host === requestHost)
}

function describeNetworkError(error: unknown, url: URL) {
  const name = error instanceof Error ? error.name : ""
  const cause = error instanceof Error ? (error.cause as { code?: string } | undefined) : undefined
  const code = cause?.code ?? ""

  if (name === "TimeoutError" || name === "AbortError" || code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT") {
    return `连接超时（${PROBE_TIMEOUT_MS / 1000}s 内无响应），请检查网络防火墙或服务是否已启动`
  }
  if (code === "ECONNREFUSED") {
    return `连接被拒绝：${url.host} 上没有服务在监听，请确认端口与服务进程`
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return `DNS 解析失败：无法解析主机名 ${url.hostname}，请检查域名拼写`
  }
  if (code === "ECONNRESET" || code === "UND_ERR_SOCKET") {
    return "连接被对端重置，请检查协议（http/https）是否与服务端一致"
  }
  if (code.startsWith("CERT_") || code.includes("SELF_SIGNED") || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") {
    return "TLS 证书校验失败，请检查证书是否有效或改用受信任的证书"
  }
  return `请求失败：${error instanceof Error ? error.message : "未知错误"}`
}

function detectModel(json: unknown, fallback: string) {
  if (json && typeof json === "object") {
    const record = json as Record<string, unknown>
    if (typeof record.model === "string") return record.model
    if (Array.isArray(record.data)) {
      const first: unknown = record.data[0]
      if (first && typeof first === "object") {
        const id = (first as Record<string, unknown>).id
        if (typeof id === "string") return id
      }
    }
  }
  return fallback
}

function extractErrorDetail(json: unknown) {
  if (!json || typeof json !== "object") return ""
  const record = json as Record<string, unknown>
  const candidate =
    typeof record.error === "string"
      ? record.error
      : record.error && typeof record.error === "object"
        ? (record.error as Record<string, unknown>).message
        : (record.detail ?? record.message)
  return typeof candidate === "string" ? candidate.slice(0, 80) : ""
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

async function pingGatewayItself(endpoint: string) {
  const startedAt = performance.now()
  try {
    const response = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/api/v1/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    const rttMs = Math.max(1, Math.round(performance.now() - startedAt))
    const health = (await response.json()) as Partial<HealthResponse>
    if (!response.ok || health.status !== "healthy") {
      return fail(`本地网关健康检查未通过（HTTP ${response.status}）`, endpoint, rttMs)
    }
    return respond(
      {
        status: "success",
        rttMs,
        modelDetected: health.service ?? "Vigil-AI Gateway",
        endpoint,
        message: `本地网关自检通过，v${health.version ?? "?"}，已运行 ${health.uptime ?? 0}s`,
      },
      200
    )
  } catch (error) {
    const rttMs = Math.round(performance.now() - startedAt)
    return fail(
      `本地网关自检失败：${error instanceof Error ? error.message : "未知错误"}`,
      endpoint,
      rttMs
    )
  }
}

export async function POST(request: Request) {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return fail("请求体不是有效的 JSON", "")
  }

  const input = parseRequest(payload)
  if (!input) return fail("缺少必填字段 apiUrl（字符串）", "")

  if (input.apiUrl === "") {
    return pingGatewayItself("/api/v1/health")
  }

  let url: URL
  try {
    url = new URL(input.apiUrl)
  } catch {
    return fail("无法解析 API 端点，请检查 URL 格式（需包含 http:// 或 https://）", input.apiUrl)
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return fail("仅支持 http:// 或 https:// 协议的端点", input.apiUrl)
  }
  if (isBlockedHost(url.hostname)) {
    return fail("该地址属于云元数据保留网段，已被网关拒绝探测", url.origin)
  }
  if (isGatewayItself(url, request.headers.get("host"))) {
    return pingGatewayItself(url.origin + url.pathname)
  }

  const endpoint = `${url.origin}${url.pathname}`
  const fallbackModel = input.modelName ?? "未识别模型"
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  }
  if (input.apiKey) headers.Authorization = `Bearer ${input.apiKey}`

  const startedAt = performance.now()
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: input.modelName,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        stream: false,
      }),
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    const text = (await response.text()).slice(0, MAX_BODY_CHARS)
    const rttMs = Math.max(1, Math.round(performance.now() - startedAt))
    const json = parseJson(text)
    const status = response.status

    if (status >= 300 && status < 400) {
      return fail(`端点返回 HTTP ${status} 重定向，请直接填写最终地址`, endpoint, rttMs)
    }

    if (status >= 200 && status < 300) {
      return respond(
        {
          status: "success",
          rttMs,
          modelDetected: detectModel(json, fallbackModel),
          endpoint,
          message: `端点响应 HTTP ${status}，握手成功`,
        },
        200
      )
    }

    if (REACHABLE_WITH_JSON.has(status) && json !== undefined) {
      const detail = extractErrorDetail(json)
      const authIssue = status === 401 || status === 403
      return respond(
        {
          status: "success",
          rttMs,
          modelDetected: detectModel(json, fallbackModel),
          endpoint,
          message: authIssue
            ? `服务可达，但鉴权被拒绝（HTTP ${status}），请检查 API Key${detail ? `：${detail}` : ""}`
            : `服务可达并返回 HTTP ${status}${detail ? `：${detail}` : ""}（探测报文未携带真实视频帧，属预期）`,
        },
        200
      )
    }

    const detail = extractErrorDetail(json)
    const hint =
      status === 404 || status === 405
        ? "，请检查接口路径是否正确"
        : status >= 500
          ? "，服务端内部错误"
          : ""
    return fail(`端点返回 HTTP ${status}${detail ? `（${detail}）` : ""}${hint}`, endpoint, rttMs)
  } catch (error) {
    const rttMs = Math.round(performance.now() - startedAt)
    return fail(describeNetworkError(error, url), endpoint, rttMs)
  }
}
