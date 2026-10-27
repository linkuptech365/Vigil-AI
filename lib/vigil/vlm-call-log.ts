/** 二级 VLM 真实调用流水的共享类型：服务端落盘与前端「VLM 调用实时流水」共用。 */

export const VLM_CALL_ENDPOINTS = {
  logs: "/api/v1/vlm/call-logs",
} as const

/** 触发源：任何会向模型网关发请求（并产生 Token 扣费）的入口都必须归入其中之一。 */
export type VlmCallTrigger = "edge_report" | "patrol" | "manual" | "compile"

export const VLM_CALL_TRIGGERS: VlmCallTrigger[] = ["edge_report", "patrol", "manual", "compile"]

export const VLM_TRIGGER_LABEL: Record<VlmCallTrigger, string> = {
  edge_report: "一级告警上报",
  patrol: "定时巡检漏斗",
  manual: "人工手动研判",
  compile: "词表编译",
}

/** 红色违规告警 / 绿色合规忽略 / 灰色异常失败 */
export type VlmCallStatus = "alarm" | "dismissed" | "failed"

export const VLM_STATUS_LABEL: Record<VlmCallStatus, string> = {
  alarm: "违规告警",
  dismissed: "合规忽略",
  failed: "异常失败",
}

/** 合规忽略的具体原因，便于解释“为什么扣了 Token 却没有告警”。 */
export type VlmCallOutcome =
  | "ALARM"
  | "FOLDED"
  | "SHADOW"
  | "EXCLUDED"
  | "BELOW_THRESHOLD"
  | "SAFE"
  | "COMPILED"
  | "ERROR"

export const VLM_OUTCOME_LABEL: Record<VlmCallOutcome, string> = {
  ALARM: "已生成告警",
  FOLDED: "冷却窗口内折叠",
  SHADOW: "存疑审计（未发告警）",
  EXCLUDED: "命中排他反例已拦截",
  BELOW_THRESHOLD: "置信度低于阈值",
  SAFE: "模型判定无违规",
  COMPILED: "词表编译完成",
  ERROR: "调用失败",
}

export interface VlmCallRuleSnapshot {
  id: string
  name: string
  description: string
}

export interface VlmCallRecord {
  id: string
  at: string
  trigger: VlmCallTrigger
  streamId: string | null
  streamName: string
  /** 触发案卷（告警）ID；研判后才产生告警的调用会在告警落库后回填 */
  alertId: string | null
  model: string
  protocol: string
  status: VlmCallStatus
  outcome: VlmCallOutcome
  ruleName: string
  confidence: number | null
  summary: string
  /** 送检图片帧数 */
  frameCount: number
  /** 已保存可回看的缩略帧数量（最多 3 张） */
  savedFrames: number
  rttMs: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  /** 网关未回传 usage，Token 为本地估算值 */
  usageEstimated: boolean
  costUsd: number
  error?: string
}

export interface VlmCallDetail extends VlmCallRecord {
  rules: VlmCallRuleSnapshot[]
  systemPrompt: string
  userPrompt: string
  /** 模型原始输出（含推理文本与 JSON） */
  output: string
}

export interface VlmCallStats {
  calls: number
  succeeded: number
  failed: number
  alarms: number
  dismissed: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costUsd: number
  /** 0 ~ 1；无调用时为 null */
  successRate: number | null
  byTrigger: Record<VlmCallTrigger, number>
}

export interface VlmCallLogsResponse {
  status: "ok"
  /** 当前保留的流水总数 */
  retained: number
  capacity: number
  /** 自 since 起的统计（默认为服务端当日 0 点） */
  stats: VlmCallStats
  matched: number
  offset: number
  limit: number
  records: VlmCallRecord[]
}

export function vlmFrameUrl(id: string, index: number) {
  return `${VLM_CALL_ENDPOINTS.logs}/${encodeURIComponent(id)}/frames/${index}`
}
