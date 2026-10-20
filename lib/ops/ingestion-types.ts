export type StreamProtocol = "RTSP" | "RTMP" | "GB28181" | "WebRTC" | "FILE"
export type StreamStatus = "connected" | "frame_drop" | "offline"
export type SamplingMode = "auto" | "fixed"

export interface StreamSource {
  id: string
  name: string
  protocol: StreamProtocol
  url: string
  status: StreamStatus
  /** Frames per second currently pulled out of the stream for inference. */
  currentFps: number
  /** Scene motion delta in percent (0-100). Below 5 is considered idle. */
  motionLevel: number
  resolution: string
  /** Mbps */
  bitrate: number
  /** Milliseconds */
  latency: number
  samplingMode: SamplingMode
  /** Used while samplingMode === "fixed". */
  fixedFps: number
  image?: string
}

export interface CircularBuffer {
  channelId: string
  capacitySeconds: 30
  currentFramesCount: number
  memoryUsageMB: number
  isLocked: boolean
}

export interface BufferedClip {
  clipId: string
  channelId: string
  /** HH:MM:SS (UTC+8) */
  startTime: string
  endTime: string
  frameCount: number
  keyframeThumbnails: string[]
}

/** One second of the ring buffer. */
export interface BufferSample {
  fps: number
  motion: number
  trigger: boolean
}

export type SegmentKind = "low" | "high" | "trigger"

export interface ExtractionState {
  channelId: string
  /** 0-3, index into EXTRACTION_STEPS */
  step: number
}

export interface NewStreamInput {
  name: string
  protocol: StreamProtocol
  url: string
  resolution: string
  bitrate: number
}

export const PROTOCOL_LABEL: Record<StreamProtocol, string> = {
  RTSP: "RTSP",
  RTMP: "RTMP",
  GB28181: "GB28181",
  WebRTC: "WebRTC",
  FILE: "本地文件",
}

export const EXTRACTION_STEPS = [
  "冻结环形缓存，防止覆写",
  "截取 T-15s ~ T+15s 切片",
  "抽取 8 张关键帧",
  "封装证据包，等待 Tier-2 推理",
] as const

export const IDLE_FPS = 1
export const MOTION_THRESHOLD = 5
export const MAX_FPS = 10
export const BUFFER_SECONDS = 30
