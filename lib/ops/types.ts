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
