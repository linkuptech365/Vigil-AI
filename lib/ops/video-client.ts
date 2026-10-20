import type { VideoApiError } from "./video-types"

export async function postVideoApi<TRequest, TResponse extends { status: "success" }>(
  url: string,
  body: TRequest,
  timeoutMs = 20000
): Promise<TResponse> {
  let response: Response
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    throw new Error("无法连接 Vigil-AI 网关或请求超时")
  }

  const data = (await response.json().catch(() => null)) as TResponse | VideoApiError | null
  if (!data) throw new Error(`服务端返回了无法解析的响应 (HTTP ${response.status})`)
  if (data.status === "error") throw new Error(data.message)
  return data
}
