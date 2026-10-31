import type {
  VlmAnalyzeRequest,
  VlmAnalyzeResponse,
  VlmApiError,
  VlmStreamChunk,
} from "./vlm-api-types"

const ENDPOINT = "/api/v1/vlm/analyze"
export const SETTINGS_STORAGE_KEY = "vigil-ai:settings"
const API_KEY_STORAGE_KEY = "vigil-ai:api-key"

/** API Key 仅保存在当前标签页的 sessionStorage，关闭标签页即清除，不进入 localStorage。 */
export function readStoredApiKey() {
  try {
    return window.sessionStorage.getItem(API_KEY_STORAGE_KEY) ?? ""
  } catch {
    return ""
  }
}

export function storeApiKey(value: string) {
  try {
    if (value) window.sessionStorage.setItem(API_KEY_STORAGE_KEY, value)
    else window.sessionStorage.removeItem(API_KEY_STORAGE_KEY)
  } catch {
    // 隐私模式下 sessionStorage 可能不可写，此时仅在当前页面内存中生效
  }
}

/** 读取「配置」页保存的 API 端点与密钥，供其它页面的 VLM 调用复用。 */
export function readVlmEndpoint(): { apiUrl?: string; apiKey?: string } {
  let apiUrl: string | undefined
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY)
    const saved: unknown = raw ? JSON.parse(raw) : null
    if (saved && typeof saved === "object" && "apiUrl" in saved && typeof saved.apiUrl === "string") {
      apiUrl = saved.apiUrl.trim() || undefined
    }
  } catch {
    apiUrl = undefined
  }
  return { apiUrl, apiKey: readStoredApiKey() || undefined }
}

export function formatTimecode(totalSec: number) {
  const safe = Math.max(0, totalSec)
  const minutes = Math.floor(safe / 60)
  const seconds = safe - minutes * 60
  return `${String(minutes).padStart(2, "0")}:${seconds.toFixed(1).padStart(4, "0")}`
}

async function readErrorMessage(response: Response) {
  try {
    const body = (await response.json()) as Partial<VlmApiError>
    if (typeof body.message === "string") return body.message
  } catch {
    // 响应体不是 JSON，使用状态码兜底
  }
  return `VLM 接口返回 HTTP ${response.status}`
}

function parseChunk(data: string): VlmStreamChunk | null {
  try {
    const value: unknown = JSON.parse(data)
    if (!value || typeof value !== "object" || !("type" in value)) return null
    switch (value.type) {
      case "thinking":
      case "token":
      case "evidence":
      case "reset":
      case "done":
      case "error":
        return value as VlmStreamChunk
      default:
        return null
    }
  } catch {
    return null
  }
}

export function streamVlmAnalyze(
  request: VlmAnalyzeRequest,
  onChunk: (chunk: VlmStreamChunk) => void,
  signal?: AbortSignal
) {
  return streamSse(ENDPOINT, { ...request, stream: true }, onChunk, signal)
}

/** 对一级初筛已落库的告警做二级研判：服务端读取留存证据帧与规则，结论写回告警并入库检索索引。 */
export function streamAlertAnalyze(
  alertId: string,
  modelProfileId: string,
  ruleIds: string[],
  onChunk: (chunk: VlmStreamChunk) => void,
  signal?: AbortSignal
) {
  return streamSse(`/api/v1/vlm/candidates/${encodeURIComponent(alertId)}/analyze`, { modelProfileId, ruleIds }, onChunk, signal)
}

async function streamSse(
  endpoint: string,
  payload: unknown,
  onChunk: (chunk: VlmStreamChunk) => void,
  signal?: AbortSignal
) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(payload),
    signal,
  })
  if (!response.ok || !response.body) throw new Error(await readErrorMessage(response))

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  const dispatch = (frame: string) => {
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
    if (!data) return
    const chunk = parseChunk(data)
    if (chunk) onChunk(chunk)
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let boundary = buffer.indexOf("\n\n")
      while (boundary >= 0) {
        dispatch(buffer.slice(0, boundary))
        buffer = buffer.slice(boundary + 2)
        boundary = buffer.indexOf("\n\n")
      }
    }
    if (buffer.trim()) dispatch(buffer)
  } finally {
    reader.releaseLock()
  }
}

export async function analyzeVlmOnce(request: VlmAnalyzeRequest, signal?: AbortSignal) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...request, stream: false }),
    signal,
  })
  if (!response.ok) throw new Error(await readErrorMessage(response))
  return (await response.json()) as VlmAnalyzeResponse
}
