/** 链路审计（Pipeline Audit）共享类型：一级初筛逐帧门禁决策 + 二级 VLM 研判全量留痕。服务端与前端共用。 */

export const AUDIT_ENDPOINTS = {
  logs: "/api/v1/audit/logs",
  ingest: "/api/v1/audit/ingest",
} as const

export const DEFAULT_AUDIT_RETENTION = 500
export const MIN_AUDIT_RETENTION = 50
export const MAX_AUDIT_RETENTION = 5000
/** 报警类记录（真实告警 / 已投递二级研判）独立保留，不占用非报警额度，防止被海量拦截日志挤出。 */
export const MAX_ALARM_RECORDS = 1000

export type AuditDropCode =
  | "GATE_1_SUBJECT_MISSING"
  | "GATE_2_POSE_FAILED"
  | "GATE_3_ROI_OUT_OF_BOUNDS"
  | "GATE_4_MEDIA_MISSING"
  | "GATE_5_COOLDOWN"
  | "GATE_6_DEBOUNCE_PENDING"
  | "UNKNOWN"

export const AUDIT_DROP_LABEL: Record<AuditDropCode, string> = {
  GATE_1_SUBJECT_MISSING: "Gate 1 · 主体缺失",
  GATE_2_POSE_FAILED: "Gate 2 · 姿态不符",
  GATE_3_ROI_OUT_OF_BOUNDS: "Gate 3 · 未进入围栏",
  GATE_4_MEDIA_MISSING: "Gate 4 · 伴随介质缺失",
  GATE_5_COOLDOWN: "Gate 5 · 冷却抑制",
  GATE_6_DEBOUNCE_PENDING: "Gate 6 · 连续帧确认中",
  UNKNOWN: "未知原因",
}

export interface AuditRawDetection {
  prompt: string
  label: string
  role: string
  confidence: number
  /** 是否达到该词条的置信度门槛（未达到的候选只留痕，不参与门禁） */
  passed: boolean
  trackId: number | null
  /** 0-1000 归一化 [x1, y1, x2, y2] */
  box: [number, number, number, number]
}

export interface AuditGateStep {
  gate: string
  verdict: "pass" | "block" | "info"
  detail: string
}

export interface AuditRuleDecision {
  ruleId: string
  ruleName: string
  outcome: "pass" | "block" | "pending" | "escalated"
  dropCode: AuditDropCode | null
  gates: AuditGateStep[]
}

export type AuditTier1Outcome = "escalated" | "pending" | "cooldown" | "blocked" | "no_suspect"

export interface AuditTier1Record {
  kind: "tier1"
  id: string
  at: string
  streamId: string
  outcome: AuditTier1Outcome
  alarm: boolean
  /** 同一状态在去重窗口内连续出现的帧数 */
  repeat: number
  rawDetections: AuditRawDetection[]
  decisions: AuditRuleDecision[]
  reasons: string[]
  eventIds: string[]
}

export type AuditTier2Verdict = "ALARM" | "SAFE" | "EXCLUDED" | "BELOW_THRESHOLD" | "SHADOW" | "FOLDED" | "ERROR"

export interface AuditTier2Record {
  kind: "tier2"
  id: string
  at: string
  streamId: string
  streamName: string
  /** edge = 一级初筛送审；patrol / manual 等来自巡检；recheck = 告警复判 */
  source: string
  verdict: AuditTier2Verdict
  alarm: boolean
  ruleId: string | null
  ruleName: string
  confidence: number
  threshold: number | null
  /** 大模型完整推理论据（含判定为安全时的“为什么放行”） */
  reasoning: string
  summary: string
  exclusion?: { reason: string; action?: string }
  action?: string
  medium?: string
  frameCount: number
  model?: string
  engineSource?: string
  edge?: { trackId: string; edgeConfidence: number; label?: string }
  alertId?: string | null
  error?: string
}

export type AuditRecord = AuditTier1Record | AuditTier2Record

export interface AuditLogsResponse {
  status: "ok"
  enabled: boolean
  retention: number
  counts: { tier1: number; tier2: number; alarm: number; nonAlarm: number }
  records: AuditRecord[]
}

export function auditRetentionOf(value: unknown): number {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN
  if (!Number.isFinite(number)) return DEFAULT_AUDIT_RETENTION
  return Math.round(Math.min(MAX_AUDIT_RETENTION, Math.max(MIN_AUDIT_RETENTION, number)))
}
