import { VLM_MODELS } from "../vlm-data"
import type { VlmKeyframeInput, VlmSimulationHint } from "../vlm-api-types"

export interface NormalizedInput {
  videoPath?: string
  keyframes: VlmKeyframeInput[]
  apiUrl?: string
  apiKey?: string
  modelName: string
  ruleScenario: string
  stream: boolean
  /** 向远端模型发起流式（SSE）请求；默认 false，即 `stream: false` */
  remoteStream: boolean
  simulation?: VlmSimulationHint
}

export interface EngineContext {
  /** 客户端断开（或取消流）时触发 */
  signal: AbortSignal
  /** 是否按人类可读的节奏吐字；非流式调用不需要 */
  pace: boolean
  requestHost: string | null
}

export function hashString(text: string) {
  let hash = 0
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0
  }
  return hash
}

export function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 1.6))
}

export function modelProfile(modelName: string) {
  const known = VLM_MODELS.find((m) => m.id === modelName)
  return {
    latencyMs: known?.latencyMs ?? null,
    ratePer1k: known?.costPer1kTokens ?? null,
  }
}

export function costUsd(ratePer1k: number | null, promptTokens: number, outputTokens: number) {
  if (ratePer1k === null) return 0
  return Math.round(((promptTokens + outputTokens) / 1000) * ratePer1k * 1e6) / 1e6
}

export function abortableSleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true }
    )
  })
}

export function withTimeout(parent: AbortSignal, ms: number) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new DOMException("timeout", "TimeoutError")), ms)
  const onParentAbort = () => controller.abort(parent.reason)
  if (parent.aborted) onParentAbort()
  else parent.addEventListener("abort", onParentAbort, { once: true })
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer)
      parent.removeEventListener("abort", onParentAbort)
    },
  }
}
