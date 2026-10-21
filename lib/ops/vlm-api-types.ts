import type { RuleSeverity } from "./rules-types"
import type { VlmSeverity } from "./vlm-types"

export type VlmProtocol = "openai" | "ollama" | "dashscope"
export type VlmEngineSource = "remote" | "fallback"
export type VlmSourceType = "local" | "channel"

export interface VlmKeyframeInput {
  index: number
  timestampSec: number
  timecode: string
  motionScore?: number
  /** data:image/(png|jpeg|webp);base64 或 https 地址。缺省时模型只能依据时序元数据推理。 */
  imageUrl?: string
}

/** 注入大模型仲裁指令的单条规则，全部字段来自规则库，不含任何内置业务内容。 */
export interface VlmPromptRule {
  id: string
  name: string
  /** 语义判定依据 */
  description: string
  /** 置信度阈值，0 ~ 1 */
  sensitivity: number
  severity: RuleSeverity
  cooldownSeconds: number
}

/** 仅离线兜底引擎使用：指定要命中的规则与置信度，真实远端模型会忽略它。 */
export interface VlmSimulationHint {
  ruleId?: string | null
  confidence?: number
}

export interface VlmAnalyzeRequest {
  /** 视频路径或文件名，服务端经 video-locator 自动寻址到物理文件 */
  videoPath?: string
  /** 视频文件名；videoPath 缺失时作为寻址兜底 */
  name?: string
  keyframes?: VlmKeyframeInput[]
  /** 配置中心的模型档案 ID；服务端据此注入 URL / Key / 模型名 */
  modelProfileId?: string
  /** 以下三项仅为兼容外部调用方；前端一律改用 modelProfileId */
  apiUrl?: string
  apiKey?: string
  modelName?: string
  /** 视频源类型；传入后必须同时提供 rules，空规则集会被拒绝 */
  sourceType?: VlmSourceType
  /** 实时通道 ID，或本地视频的唯一标识，用于防抖窗口分桶 */
  sourceKey?: string
  /** 已按视频源筛选出的生效规则，由客户端从规则库读取 */
  rules?: VlmPromptRule[]
  /** 默认 true，返回 text/event-stream */
  stream?: boolean
  simulation?: VlmSimulationHint
}

export type VlmBbox = [number, number, number, number]

export interface VlmFinalResult {
  triggered: boolean
  /** 命中的规则编号，未命中为 null */
  ruleId: string | null
  /** 命中的规则名称，未命中为「无」 */
  ruleTriggered: string
  severity: VlmSeverity
  /** 0 ~ 1 */
  confidence: number
  /** 违规发生的时间戳，格式 mm:ss.mmm */
  timestampOffset: string
  /** [ymin, xmin, ymax, xmax]，归一化到 0 ~ 1000；无定位时为 null */
  bbox: VlmBbox | null
  /** 研判论据 */
  reasoning: string
  /** 处置指引 */
  advice: string
  /** 一句话概述，由 reasoning 截取，供列表展示 */
  summary: string
  /** 引用的关键帧，取值为请求中 keyframes[].index */
  evidenceKeyframes: number[]
}

/** 模型原始判定经阈值校验、防抖聚合后的最终裁决 */
export interface VlmVerdict {
  /** 是否产生有效预警（命中规则且置信度达到阈值） */
  triggered: boolean
  ruleId: string | null
  ruleName: string | null
  threshold: number | null
  /** 模型判定命中，但置信度低于规则阈值，已降级为安全 */
  belowThreshold: boolean
  /** 命中规则的防抖状态；未触发时为空 */
  suppression?: VlmSuppression
}

export interface VlmSuppression {
  incidentId: string | null
  windowSeconds: number
  /** 窗口内重复触发，已折叠进既有事件证据链 */
  suppressed: boolean
  isNewIncident: boolean
  /** 当前事件的累计触发次数（含本次） */
  triggerCount: number
  suppressedCount: number
  /** 当前事件从首次触发到现在持续的秒数 */
  elapsedSec: number
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
  | { type: "done"; result: VlmFinalResult; metrics: VlmMetrics; verdict: VlmVerdict }
  | { type: "error"; message: string }

export interface VlmAnalyzeResponse {
  status: "success"
  result: VlmFinalResult
  metrics: VlmMetrics
  verdict: VlmVerdict
  /** 完整的 Markdown 推理文本 */
  reasoning: string
}

export interface VlmApiError {
  status: "error"
  message: string
  /** 机器可读的错误码，例如 NO_VALID_IMAGE_FRAMES */
  error?: string
}

/** 随队列条目保存的完整研判报告 */
export interface VlmAnalysisReport {
  result: VlmFinalResult
  metrics: VlmMetrics
  verdict?: VlmVerdict
  reasoning: string
}
