export type ChannelId = "CAM-01" | "CAM-02" | "CAM-03" | "CAM-04"
export type CameraStatus = "normal" | "alert" | "fence" | "gathering"
export type BoxTone = "ok" | "critical" | "warn" | "zone"

/** All coordinates are percentages of the source frame (0-100). */
export interface OverlayBox {
  x: number
  y: number
  w: number
  h: number
  tone: BoxTone
  label?: string
  pulse?: boolean
}

export interface Camera {
  id: ChannelId
  code: string
  name: string
  nameEn: string
  image: string
  /** Looping 30s clip; the AI overlay timeline is keyed to its playback time. */
  video: string
  poster: string
  status: CameraStatus
  statusLabel: string
  fps: number
  bitrate: number
  resolution: string
  boxes: OverlayBox[]
  /** Covers a burned-in timestamp that ships with the generated footage. */
  maskTimestamp?: boolean
}

export type Severity = "CRITICAL" | "WARNING"
export type AlertStatus = "open" | "acked" | "assigned" | "false_positive" | "archived"

export interface ReasoningStep {
  /** Seconds relative to the trigger moment, -15 .. +15. */
  offset: number
  title: string
  detail: string
}

export interface AlertEvent {
  id: string
  cameraId: string
  severity: Severity
  type: string
  summary: string
  rule: string
  confidence: number
  minutesAgo: number
  /** HH:MM:SS of the trigger moment (UTC+8). */
  time: string
  status: AlertStatus
  box: OverlayBox
  related: string[]
  steps: ReasoningStep[]
  note?: string
  assignee?: string
  /** 真实告警：通道名称，用于界面展示（cameraId 为通道 ID，用于定位） */
  cameraLabel?: string
  /** 真实告警：取证关键帧 URL，按时间顺序排列 */
  frameUrls?: string[]
}

export interface SearchMoment {
  id: string
  cameraId: string
  start: string
  end: string
  score: number
  title: string
  rationale: string
  keywords: string[]
  box: OverlayBox
  /** 真实检索结果：关键帧 URL 与通道名称 */
  imageUrl?: string
  cameraLabel?: string
}

export interface RuleActions {
  notify: boolean
  siren: boolean
  record: boolean
}

export interface Rule {
  id: string
  name: string
  description: string
  enabled: boolean
  sensitivity: number
  actions: RuleActions
  custom?: boolean
  prompt?: string
  channels?: string[]
}

export interface ReplayState {
  momentId: string
  cameraId: string
  start: string
  end: string
  title: string
}

export interface SeekTarget {
  channelId: ChannelId
  timestampSec: number
  /** Bumped on every request so repeated jumps to the same spot still fire. */
  nonce: number
  incidentId?: string
  title?: string
}

export interface LocateOptions {
  timestampSec?: number
  label?: string
}

/** 二级 VLM 反哺一级初筛的触发策略：DUAL_INTERACTION 仍需双目标重叠；ANCHOR_PROXIMITY 主体进入记忆锚点即触发。 */
export type Tier1TriggerPolicy = "DUAL_INTERACTION" | "ANCHOR_PROXIMITY"

/** 二级 VLM 判定成立后，回写给一级初筛的补充词、静态锚点与触发策略建议。 */
export interface Tier1Feedback {
  recommended_tags?: Array<{
    /** 补充的高辨识度英文词（如 "white plastic pet dispenser"） */
    tag: string
    /** 中文名称 */
    zh_name: string
    role: "subject_target" | "context_object"
    /** 建议置信度阈值 0.2 ~ 0.6 */
    confidence_threshold: number
  }>
  spatial_hotspot?: {
    /** 归一化坐标 [0~1000, 0~1000] */
    center: [number, number]
    /** 影响半径 0 ~ 1000 */
    radius: number
    /** 例如「喂食器进食点」 */
    description: string
  }
  trigger_policy?: Tier1TriggerPolicy
  /** 带语义标签的微锚点：target 表示规则关联的目标点位，exclusion 表示易混淆的相邻点位（如饮水点） */
  micro_hotspots?: Array<{
    /** 形如 hotspot_food_tray */
    id: string
    kind: "target" | "exclusion"
    center: [number, number]
    radius: number
    description: string
  }>
}

/** 二级研判的四要素解耦判决：动作、交互介质、排他性反例、置信度分别独立断言。 */
export interface FineGrainedVerdict {
  is_alarm: boolean
  /** 识别出的具体动作，如 eating_kibble / drinking_water / gowning_touch */
  primary_action: string
  interaction_target: {
    /** 交互介质与物体，如 dry_food_tray / water_dispenser / cleanroom_zone_a */
    category: string
    confidence: number
  }
  /** 是否命中了规则的排他性反例 */
  exclusion_matched: boolean
  exclusion_reason?: string
  confidence: number
  /** 置信度处于边缘区间（0.5~0.75）或存在遮挡时的存疑审计标记，不产生正式告警 */
  shadow_review?: boolean
}
