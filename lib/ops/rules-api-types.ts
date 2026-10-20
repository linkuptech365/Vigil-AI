import type {
  CorrelatedIncident,
  DeduplicationMetrics,
  EvidenceTrigger,
  InspectionRule,
  RuleActionKey,
  RuleSchedule,
  RuleSeverity,
} from "./rules-types"

export type EvaluateSeverity = RuleSeverity | "SAFE"
export type CollisionType = "ROI_POLYGON" | "TRIPWIRE" | "VLM_SEMANTIC" | "NONE"

export interface ApiErrorBody {
  error: string
  code: string
}

/* ---------------------------------------------------------------- evaluate */

export interface RuleEvaluateRequest {
  channelId: string
  ruleId?: string
  /** [x, y] of the target foot point, normalised to 0~1000 on both axes. */
  targetCoords?: [number, number]
  /** Previous foot point; required to detect a tripwire crossing, otherwise proximity is used. */
  previousCoords?: [number, number]
  /** 'person' | 'vehicle' | 'forklift' */
  targetClass?: string
  /** 0~1 or 0~100 (values above 1 are read as percent). */
  confidence: number
  scenarioText?: string
  /** ISO 8601, defaults to server time. */
  timestamp?: string
}

export interface RuleEvaluateResponse {
  violated: boolean
  ruleId: string
  ruleName: string
  severity: EvaluateSeverity
  collisionType: CollisionType
  suppressed: boolean
  cooldownRemainingSec: number
  incidentId: string
  /** Human readable explanation of the verdict. */
  reason: string
  matchedZoneId?: string
}

/* ---------------------------------------------------------------- suppress */

export interface SuppressRequest {
  channelId: string
  /** Defaults to the first enabled rule bound to the channel. */
  ruleId?: string
}

export interface SuppressionPulse {
  id: number
  /** Seconds since the first trigger of the incident. */
  offsetSec: number
  kind: "incident" | "suppressed"
}

export interface SuppressionStatus {
  channelId: string
  ruleId: string
  incidentId: string | null
  windowSeconds: number
  windowActive: boolean
  /** Seconds since the first trigger of the current incident. */
  elapsedSec: number
  cooldownRemainingSec: number
  rawTriggers: number
  suppressedCount: number
  pulses: SuppressionPulse[]
}

export interface SuppressResponse extends SuppressionStatus {
  isNewIncident: boolean
  suppressed: boolean
  metrics: DeduplicationMetrics
}

export interface SuppressionSnapshot {
  /** Most recently triggered window per channel, null when the channel never fired. */
  channels: Record<string, SuppressionStatus | null>
  metrics: DeduplicationMetrics
  serverTime: number
}

/* ------------------------------------------------------------------- storm */

export interface StormRequest {
  channelId: string
  ruleId?: string
  /** Number of triggers, 2~20. Defaults to 6. */
  count?: number
  /** Delay between triggers in ms, 0~1500. Defaults to 500. */
  spacingMs?: number
}

export interface StormTrigger {
  seq: number
  isNewIncident: boolean
  suppressed: boolean
  incidentId: string
  offsetMs: number
}

export interface StormResponse {
  channelId: string
  ruleId: string
  total: number
  incidentsCreated: number
  suppressedCount: number
  /** True when every trigger was folded into a ticket that already existed. */
  foldedIntoExisting: boolean
  primaryIncidentId: string
  cooldownRemainingSec: number
  elapsedMs: number
  triggers: StormTrigger[]
  status: SuppressionStatus
  metrics: DeduplicationMetrics
}

/* ----------------------------------------------------------------- cluster */

export interface ClusterEventInput {
  channelId: string
  ruleId?: string
  /** ISO 8601, defaults to server time. */
  timestamp?: string
  tags?: string[]
}

export interface ClusterRequest {
  events?: ClusterEventInput[]
  windowSeconds?: number
}

export interface AffinityFactor {
  key: "temporal" | "semantic" | "topology"
  label: string
  /** 0~100 */
  value: number
}

export interface ClusterEvidence {
  time: string
  channelId: string
  rule: string
  role: EvidenceTrigger["role"]
  note: string
}

export interface ClusteredIncident extends CorrelatedIncident {
  factors: AffinityFactor[]
  evidence: ClusterEvidence[]
}

export interface ClusteredIncidentResponse {
  windowSeconds: number
  evaluatedEvents: number
  incidents: ClusteredIncident[]
  /** Most recent cluster, null when no cross-camera correlation exists. */
  primary: ClusteredIncident | null
  generatedAt: string
}

/* ------------------------------------------------------------------- rules */

export interface RulesListResponse {
  rules: InspectionRule[]
}

export interface CreateRuleRequest {
  name: string
  prompt: string
  /** 0.6~0.95 */
  sensitivity: number
  actions: Record<RuleActionKey, boolean>
}

export interface CreateRuleResponse extends RulesListResponse {
  rule: InspectionRule
}

export interface UpdateRuleRequest {
  enabled?: boolean
  severity?: RuleSeverity
  cooldownSeconds?: number
  schedule?: RuleSchedule
  boundChannels?: string[]
  /** 0.3~0.99 */
  sensitivity?: number
  actions?: Record<RuleActionKey, boolean>
}

export interface UpdateRuleResponse extends RulesListResponse {
  rule: InspectionRule
}
