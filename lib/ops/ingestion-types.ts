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

/** Protocols the browser-side probe can actually pull. */
export type LiveProtocol = "HLS" | "WEBRTC" | "RTSP" | "MP4"
export type LivePhase = "idle" | "connecting" | "live" | "fallback" | "error"

export interface LiveFeed {
  channelId: string
  protocol: LiveProtocol
  url: string
  label: string
  fallbackSrc: string
  pushedAt: number
}

/** Real-time telemetry sampled from the video element once per second. */
export interface StreamQosMetrics {
  bitrateMbps: number
  fps: number
  targetFps: number
  droppedFrames: number
  totalFrames: number
  jitterMs: number
  gopSeconds: number
  gopFrames: number
  bitrateSource: "measured" | "estimated"
}

export interface QosSeries {
  bitrate: number[]
  fps: number[]
  jitter: number[]
}

/** Aggregated window handed to the diagnosis step. */
export interface QosSnapshot {
  protocol: LiveProtocol | null
  usedFallback: boolean
  samples: number
  fpsAvg: number
  targetFps: number
  droppedFrames: number
  totalFrames: number
  jitterAvgMs: number
  firstFrameMs: number
  fragLoadMs: number
  videoCodec?: string
  audioCodec?: string
  resolution: string
  /** Present only when RTP statistics are available (WebRTC). */
  rtpLossPct: number | null
}

export type LatencyGrade = "A" | "B" | "C" | "D"

export interface StreamHealthReport {
  codec: string
  resolution: string
  packetLossPct: number
  packetLossLabel: string
  lossBasis: "rtp" | "decoder"
  latencyMs: number
  latencyGrade: LatencyGrade
  latencyLabel: string
  score: number
  verdict: "excellent" | "good" | "poor"
  generatedAt: string
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
