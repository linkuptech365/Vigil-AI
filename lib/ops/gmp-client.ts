import type { GmpProvisionResponse } from "@/lib/ops/gmp-suite"

export const GMP_AUTOSCAN_KEY = "vigil-ai:autoscan"
export const VIGIL_SETTINGS_KEY = "vigil-ai:settings"

export async function provisionGmpSuite(): Promise<GmpProvisionResponse> {
  const response = await fetch("/api/v1/samples/provision", {
    method: "POST",
    signal: AbortSignal.timeout(20000),
  })
  const body = (await response.json().catch(() => null)) as
    | GmpProvisionResponse
    | { error?: string; code?: string }
    | null
  if (!response.ok || !body || !("status" in body) || body.status !== "success") {
    const message = body && "error" in body && body.error ? body.error : `HTTP ${response.status}`
    throw new Error(message)
  }
  return body
}

/** 把算例目录写入 /console 使用的本地配置，并标记进入配置中心后自动扫描。 */
export function queueGmpAutoscan(directory: string) {
  let saved: Record<string, unknown> = {}
  try {
    const raw = window.localStorage.getItem(VIGIL_SETTINGS_KEY)
    if (raw) saved = JSON.parse(raw) as Record<string, unknown>
  } catch {
    saved = {}
  }
  window.localStorage.setItem(VIGIL_SETTINGS_KEY, JSON.stringify({ ...saved, folderPath: directory }))
  window.sessionStorage.setItem(GMP_AUTOSCAN_KEY, "1")
}
