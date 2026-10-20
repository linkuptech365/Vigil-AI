export type TrackClass = "person" | "vehicle" | "forklift" | "hazard"
export type RoiShape = "polygon" | "tripwire"
export type RoiSeverity = "warning" | "critical"
export type RoiAction = "escalate" | "log" | "siren"

/** All coordinates are percentages of the source frame (0-100). */
export interface TrackedEntity {
  id: string
  trackId: number
  class: TrackClass
  /** [x, y, w, h] in percent of the frame, origin top-left. */
  bbox: [number, number, number, number]
  confidence: number
  /** Previous bbox centres, oldest first (max 10). */
  trail: [number, number][]
  isViolating: boolean
  label?: string
  /** True while the target is inside / has just crossed an enabled ROI. */
  breaching?: boolean
}

export interface RoiZone {
  id: string
  name: string
  type: RoiShape
  /** Polygon vertices, or the two end points of a tripwire. */
  coordinates: [number, number][]
  /** Any CSS colour value, usually a design token such as var(--destructive). */
  color: string
  severity: RoiSeverity
  enabled: boolean
  cameraId: string
  targets: TrackClass[]
  action: RoiAction
  /** 10-100. Higher values shorten the re-trigger cool-down. */
  sensitivity: number
  /** Tripwire only: when true, only the "wrong" direction counts as a breach. */
  directional?: boolean
  custom?: boolean
}

export interface ZoneRuntime {
  breached: boolean
  message: string | null
  count: number
}

export type ClipReason = "roi_breach" | "fall_suspect" | "crowd_anomaly"
export type ClipStatus = "sent" | "queued" | "blocked"

export interface EscalationClip {
  id: string
  cameraId: string
  reason: ClipReason
  confidence: number
  status: ClipStatus
  edgeMs: number
  /** HH:MM:SS, UTC+8. */
  time: string
  queuedAt?: number
}

export interface EntityScript {
  id: string
  trackId: number
  class: TrackClass
  label: string
  /** [w, h] in percent of the frame. */
  size: [number, number]
  /** Ground contact points the target walks along. */
  path: [number, number][]
  speed: number
  confidence: number
  startDist?: number
  isViolating?: boolean
}

export interface PerceptionMetrics {
  ingested: number
  escalatedFrames: number
  clips: number
}

export interface SeriesPoint {
  ingested: number
  escalated: number
}
