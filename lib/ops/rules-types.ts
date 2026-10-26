import type { RulePipelineConfig } from "./types"

export type InspectionRuleType = "GEOMETRIC" | "THRESHOLD" | "PROMPT_SEMANTIC"
export type RuleSeverity = "INFO" | "WARNING" | "CRITICAL"
export type RuleSchedule = "24x7" | "NIGHT_ONLY" | "WORK_HOURS"
export type RuleActionKey = "webhook" | "dispatch" | "siren"

export interface InspectionRule {
  id: string
  name: string
  type: InspectionRuleType
  prompt?: string
  /** Plain-language summary of the deterministic logic, shown for non-prompt rules. */
  logic?: string
  boundChannels: string[]
  severity: RuleSeverity
  cooldownSeconds: number
  schedule: RuleSchedule
  enabled: boolean
  /** Only present on rules created through the natural language creator. */
  custom?: boolean
  sensitivity?: number
  /** 规则自带的明确排除场景（如"猫在喝水"），二级研判必须逐条比对 */
  exclusions?: string[]
  /** 通用 4 阶段解耦管道；存在即启用，由边缘视觉 Worker 逐级门禁、VLM 最终裁决 */
  pipeline?: RulePipelineConfig
  actions?: Record<RuleActionKey, boolean>
}

export interface DeduplicationMetrics {
  rawTriggersCount: number
  suppressedCount: number
  incidentCount: number
  correlatedCount: number
}

export interface CorrelatedIncident {
  incidentId: string
  title: string
  primaryChannelId: string
  relatedChannelIds: string[]
  startTime: string
  durationSeconds: number
  rawTriggersFolded: number
  spatialAffinity: number
  dualKeyframes: { channelId: string; timestamp: string; thumbnail: string }[]
}

export type PulseKind = "incident" | "suppressed"

export interface TriggerPulse {
  id: number
  /** Seconds since the first trigger of this incident. */
  offset: number
  kind: PulseKind
}

export interface ChannelCooldown {
  incidentId: string | null
  pulses: TriggerPulse[]
  /** Seconds since the first trigger of the current incident. */
  elapsed: number
  windowSeconds: number
}

export interface EvidenceTrigger {
  time: string
  channelId: string
  rule: string
  role: "primary" | "folded" | "correlated"
  note: string
}
