/** 命中全量留存（Hit Ledger）共享类型：服务端落盘与前端「历史命中明细」共用。条数上限绑定审计保留条数。 */
import type { AuditRawDetection, AuditRuleDecision } from "./audit"
import type { VisionHitGate, VisionHitTag } from "./vision"

export const HIT_HISTORY_ENDPOINTS = {
  history: "/api/v1/hits/history",
  ingest: "/api/v1/hits/ingest",
} as const

/** nodet（模型无任何特征响应）不属于命中，不进入留存。 */
export type HitHistoryGate = Exclude<VisionHitGate, "nodet">

/** 面向复盘的归类：alarm = 已投递二级研判；blocked = 被门禁拦截 / 累积 / 冷却；passed = 已检出但合规放行归档。 */
export type HitHistoryStatus = "alarm" | "blocked" | "passed"

export const HIT_GATES: HitHistoryGate[] = ["escalated", "pending", "cooldown", "passed"]

export const HIT_STATUS_OF_GATE: Record<HitHistoryGate, HitHistoryStatus> = {
  escalated: "alarm",
  pending: "blocked",
  cooldown: "blocked",
  passed: "passed",
}

export const HIT_STATUS_LABEL: Record<HitHistoryStatus, string> = {
  alarm: "已报警送审",
  blocked: "被门禁拦截",
  passed: "放行 · 合规归档",
}

export const HIT_GATE_LABEL: Record<HitHistoryGate, string> = {
  escalated: "已投递二级研判",
  pending: "累积确认中",
  cooldown: "冷却抑制",
  passed: "已检出 · 未触发",
}

export interface HitHistoryRecord {
  id: string
  /** 首次命中时间 */
  at: string
  /** 同一状态在去重窗口内最后一次命中的时间 */
  lastAt: string
  streamId: string
  gate: HitHistoryGate
  tags: VisionHitTag[]
  reasons: string[]
  repeat: number
  progress?: { hits: number; need: number }
  eventId?: string
  anchor?: boolean
  /** 触发帧截屏（服务端以文件保存，通过 hitFrameUrl 读取） */
  hasFrame: boolean
  frameWidth: number
  frameHeight: number
  /** 与截屏同一帧的原始检测框（含未达门槛的候选），0-1000 归一化 */
  rawDetections: AuditRawDetection[]
  /** 各规则逐级门禁（Gate 1~6）的通行 / 拦截结果 */
  decisions: AuditRuleDecision[]
}

export interface HitHistoryResponse {
  status: "ok"
  /** 容量上限，绑定「审计保留条数」设置 */
  retention: number
  /** 当前库内总条数（未经筛选） */
  total: number
  /** 命中当前筛选条件的条数 */
  matched: number
  counts: Record<HitHistoryStatus, number>
  offset: number
  limit: number
  records: HitHistoryRecord[]
}

export function hitFrameUrl(id: string) {
  return `${HIT_HISTORY_ENDPOINTS.history}/${encodeURIComponent(id)}/frame`
}

export function hitStatusOf(record: Pick<HitHistoryRecord, "gate">): HitHistoryStatus {
  return HIT_STATUS_OF_GATE[record.gate] ?? "passed"
}
