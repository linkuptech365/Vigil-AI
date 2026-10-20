export type RuleId = "violence" | "ppe" | "fire" | "intrusion"

export type Severity = "critical" | "high"

export type VideoStatus = "pending" | "analyzing" | "safe" | "alert"

export interface Truth {
  /** 模拟 VLM 实际会识别出的违规类型；null 表示画面正常 */
  ruleId: RuleId | null
  confidence: number
}

export interface VideoItem {
  id: string
  name: string
  path: string
  durationSec: number
  sizeMB: number
  fps: number
  recordedAt: string
  truth: Truth
  status: VideoStatus
  ruleId?: RuleId
  confidence?: number
  analyzedAt?: string
  samplingFps?: number
  frames?: number
  suppressedReason?: string
}

export type LogLevel = "sys" | "info" | "sample" | "req" | "res" | "ok" | "warn" | "alert"

export interface LogLine {
  id: number
  ts: string
  level: LogLevel
  text: string
}

export interface Settings {
  apiUrl: string
  presetId: string
  samplingFps: 1 | 2 | 5
  threshold: number
  rules: Record<RuleId, boolean>
  folderPath: string
  recursive: boolean
  formats: string[]
}

export type PingState =
  | { state: "idle" }
  | { state: "testing" }
  | { state: "ok"; latency: number; model: string; message: string }
  | { state: "error"; message: string }
