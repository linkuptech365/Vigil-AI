export const DEFAULT_VIDEO_EXTENSIONS = [".mp4", ".avi", ".mkv", ".mov", ".webm", ".flv"] as const

export type SamplingFps = 1 | 2 | 5

export interface ScanFolderRequest {
  folderPath: string
  recursive?: boolean
  /** 默认 DEFAULT_VIDEO_EXTENSIONS */
  filterExtensions?: string[]
}

export interface ScannedVideoItem {
  id: string
  name: string
  /** 服务端解析后的真实绝对路径 */
  path: string
  sizeBytes: number
  sizeFormatted: string
  duration: string
  durationSeconds: number
  /** header: 由容器头解析；estimated: 按文件大小与标准码率估算 */
  durationSource: "header" | "estimated"
  format: string
  /** 仅在容器头可解析时给出，例如 1080P */
  resolution: string | null
  status: "pending"
  lastModified: string
}

export interface ScanFolderResponse {
  status: "success"
  folderPath: string
  totalFound: number
  /** 命中 100 个文件上限时为 true */
  truncated: boolean
  scannedAt: string
  videos: ScannedVideoItem[]
}

export interface ExtractFramesRequest {
  videoPath: string
  fps?: SamplingFps
  triggerTimestampSec?: number
}

export interface ExtractedKeyframe {
  index: number
  timestampSec: number
  timecode: string
  /** SVG data URI */
  thumbnailUrl: string
  motionScore: number
}

export interface ExtractFramesResponse {
  status: "success"
  videoPath: string
  samplingFps: SamplingFps
  totalFramesExtracted: 8
  durationSeconds: number
  triggerTimestampSec: number
  windowRange: { startSec: number; endSec: number }
  /** 缩略图由服务端合成（未调用 ffmpeg），时间轴与元数据来自真实文件 */
  renderMode: "synthetic-svg"
  keyframes: ExtractedKeyframe[]
}

export interface VideoApiError {
  status: "error"
  message: string
}
