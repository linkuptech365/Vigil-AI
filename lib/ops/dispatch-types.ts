export type DossierSeverity = "CRITICAL" | "WARNING"

export type DossierStatus =
  | "PENDING"
  | "DISPATCHED"
  | "IN_PROGRESS"
  | "RESOLVED"
  | "FALSE_POSITIVE"

export interface EvidenceDossier {
  dossierId: string
  incidentId: string
  channelId: string
  channelName: string
  title: string
  timestamp: string
  severity: DossierSeverity
  clipDuration: string
  clipSize: string
  keyframes: string[]
  sha256Hash: string
  violatedClauses: string[]
  status: DossierStatus
}

export interface DispatchAction {
  id: string
  dossierId: string
  operator: string
  actionType: string
  notes: string
  timestamp: string
}

export type BroadcastChannelType = "SIREN" | "WEBHOOK" | "IM_BOT" | "IOT_HARDWARE"

export type BroadcastRunStatus = "IDLE" | "SUCCESS" | "FAILED"

export interface ChannelBroadcastStatus {
  channelType: BroadcastChannelType
  name: string
  status: BroadcastRunStatus
  target: string
  lastFiredTime?: string
}

export interface KeyframeMeta {
  id: string
  /** 相对事件触发时刻 T0 的秒数偏移 */
  offsetSec: number
  label: string
  breach: boolean
  /** 检测框，百分比坐标 [x, y, w, h] */
  box: [number, number, number, number]
  confidence: number
}

export interface Responder {
  id: string
  name: string
  role: string
}

export type FalsePositiveReason =
  | "LIGHT_CHANGE"
  | "VEST_OCCLUSION"
  | "TOOL_MISJUDGED"
  | "OTHER"

export interface FalsePositiveFeedback {
  reason: FalsePositiveReason
  explanation: string
  submittedAt: string
}

export type QuickActionType = "VOICE_INTERCOM" | "RECTIFICATION_ORDER" | "SIGN_OFF"
