import type { VlmSeverity } from "./vlm-types"

export type VlmProtocol = "openai" | "ollama" | "dashscope"
export type VlmEngineSource = "remote" | "fallback"

export interface VlmKeyframeInput {
  index: number
  timestampSec: number
  timecode: string
  motionScore?: number
  /** data:image/(png|jpeg|webp);base64 或 https 地址。缺省时模型只能依据时序元数据推理。 */
  imageUrl?: string
}

/** 仅离线兜底引擎使用：指定要模拟的场景与置信度，真实远端模型会忽略它。 */
export interface VlmSimulationHint {
  scenario: string
  confidence?: number
}

export interface VlmAnalyzeRequest {
  videoPath?: string
  keyframes?: VlmKeyframeInput[]
  apiUrl?: string
  apiKey?: string
  modelName?: string
  ruleScenario?: string
  /** 默认 true，返回 text/event-stream */
  stream?: boolean
  simulation?: VlmSimulationHint
}

export interface VlmFinalResult {
  summary: string
  intentAnalysis: string
  severity: VlmSeverity
  /** 0 ~ 1 */
  confidence: number
  ruleTriggered: string
  /** 引用的关键帧，取值为请求中 keyframes[].index */
  evidenceKeyframes: number[]
  violationClauses: string[]
  actionAdvice: string
}

export interface VlmMetrics {
  promptTokens: number
  outputTokens: number
  firstTokenMs: number
  rttMs: number
  costUsd: number
  source: VlmEngineSource
  model: string
  protocol?: VlmProtocol
  /** source 为 fallback 时说明为何没有使用远端模型 */
  fallbackReason?: string
}

export type VlmStreamChunk =
  | { type: "thinking"; message: string }
  | { type: "token"; content: string }
  | { type: "evidence"; frames: number[] }
  /** 远端已输出部分文本后失败并切换到兜底引擎时，要求客户端清空已显示的文本 */
  | { type: "reset"; reason: string }
  | { type: "done"; result: VlmFinalResult; metrics: VlmMetrics }
  | { type: "error"; message: string }

export interface VlmAnalyzeResponse {
  status: "success"
  result: VlmFinalResult
  metrics: VlmMetrics
  /** 完整的 Markdown 推理文本 */
  reasoning: string
}

export interface VlmApiError {
  status: "error"
  message: string
}

/** 随队列条目保存的完整研判报告 */
export interface VlmAnalysisReport {
  result: VlmFinalResult
  metrics: VlmMetrics
  reasoning: string
}
