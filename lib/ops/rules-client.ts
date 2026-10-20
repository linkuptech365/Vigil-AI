import type { ApiErrorBody } from "./rules-api-types"

export const RULES_ENDPOINT = "/api/v1/rules"
export const SUPPRESS_ENDPOINT = "/api/v1/rules/suppress"
export const STORM_ENDPOINT = "/api/v1/rules/simulate-storm"
export const CLUSTER_ENDPOINT = "/api/v1/rules/cluster"

export class RulesApiError extends Error {
  code: string
  status: number

  constructor(message: string, code: string, status: number) {
    super(message)
    this.name = "RulesApiError"
    this.code = code
    this.status = status
  }
}

async function parse<T>(response: Response): Promise<T> {
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new RulesApiError(`服务端返回了无法解析的响应 (HTTP ${response.status})`, "BAD_RESPONSE", response.status)
  }
  if (!response.ok) {
    const body = payload as Partial<ApiErrorBody>
    throw new RulesApiError(body.error ?? `请求失败 (HTTP ${response.status})`, body.code ?? "REQUEST_FAILED", response.status)
  }
  return payload as T
}

export async function getJson<T>(url: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, { cache: "no-store" })
  } catch {
    throw new RulesApiError("无法连接到规则引擎服务", "NETWORK_ERROR", 0)
  }
  return parse<T>(response)
}

export async function sendJson<T>(url: string, method: "POST" | "PATCH", body: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  } catch {
    throw new RulesApiError("无法连接到规则引擎服务", "NETWORK_ERROR", 0)
  }
  return parse<T>(response)
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知错误"
}
