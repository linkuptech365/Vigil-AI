export type DeviationClass = "CRITICAL" | "MAJOR" | "MINOR"

export type CapaStatus = "DRAFT" | "IN_PROGRESS" | "QA_REVIEW" | "APPROVED"

export type RcaCategory = "HUMAN_ERROR" | "SUPPLY_SHORTAGE" | "INTERLOCK_FAULT" | "ENVIRONMENT"

export interface AuditLogEntry {
  id: string
  /** ISO timestamp. */
  at: string
  actor: string
  action: string
}

export interface GmpDeviationRecord {
  id: string
  ruleId: string
  channelId: string
  zone: string
  behavior: string
  clause: string
  classification: DeviationClass
  /** Local wall-clock time, `YYYY-MM-DD HH:mm:ss`. */
  occurredAt: string
  sha256: string
  operator: string
  shiftLead: string
  capaStatus: CapaStatus
  vlmExcerpt: string
  confidence: number
  /** Second offsets inside the channel's 30s clip that bound the incident. */
  clipStartSec: number
  clipEndSec: number
  auditLog: AuditLogEntry[]
}

export interface CapaFormState {
  deviationId: string
  rcaCategory: RcaCategory
  rcaNotes: string
  containment: string
  capaPlan: string
  /** `YYYY-MM-DD`, empty until chosen. */
  plannedDate: string
  qaOfficer: string
  /** ISO timestamp of the digital signature, set only on approval. */
  signedAt: string | null
  returnReason: string | null
  updatedAt: string
}

export interface AuditSnapshot {
  records: GmpDeviationRecord[]
  capa: Record<string, CapaFormState>
}

export const CLASSIFICATION_LABEL: Record<DeviationClass, string> = {
  CRITICAL: "临界偏差",
  MAJOR: "主要偏差",
  MINOR: "微小偏差",
}

export const CAPA_STATUS_LABEL: Record<CapaStatus, string> = {
  DRAFT: "待制定",
  IN_PROGRESS: "纠正措施执行中",
  QA_REVIEW: "QA质保复核中",
  APPROVED: "已批准结案",
}

export const CAPA_STATUS_ENGLISH: Record<CapaStatus, string> = {
  DRAFT: "Draft",
  IN_PROGRESS: "In Progress",
  QA_REVIEW: "QA Review",
  APPROVED: "Approved",
}

export const RCA_OPTIONS: { value: RcaCategory; label: string }[] = [
  { value: "HUMAN_ERROR", label: "人为失误/未执行更衣SOP" },
  { value: "SUPPLY_SHORTAGE", label: "洁净鞋备件不足/尺寸缺失" },
  { value: "INTERLOCK_FAULT", label: "物理阻隔门禁连锁故障" },
  { value: "ENVIRONMENT", label: "其他环境因素" },
]
