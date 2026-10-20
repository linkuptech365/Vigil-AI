import type { VlmAnalysisReport } from "@/lib/ops/vlm-api-types"
import type { ExtractedKeyframe, SamplingFps } from "@/lib/ops/video-types"

export type RuleId =
  | "violence"
  | "ppe"
  | "fire"
  | "intrusion"
  | "gmpEsd"
  | "gmpTransfer"
  | "gmpClassA"

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
  /** disk: 由服务端真实扫描得到，可调用抽帧接口 */
  source?: "disk"
  scanRoot?: string
  format?: string
  resolution?: string | null
  durationEstimated?: boolean
  keyframes?: ExtractedKeyframe[]
  keyframeWindow?: { startSec: number; endSec: number }
  /** 由 /api/v1/vlm/analyze 返回的真实（或离线兜底）研判报告 */
  vlmReport?: VlmAnalysisReport
}

export interface FrameTestState {
  videoId: string
  fps: SamplingFps
  triggerSec: number | null
  status: "loading" | "ok" | "error"
  keyframes?: ExtractedKeyframe[]
  windowRange?: { startSec: number; endSec: number }
  triggerTimestampSec?: number
  error?: string
}

export interface ScanInfo {
  count: number
  folder: string
  truncated: boolean
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
