import { CAMERAS } from "./data"
import type {
  LatencyGrade,
  LiveProtocol,
  QosSnapshot,
  StreamHealthReport,
} from "./ingestion-types"

export interface ProtocolMeta {
  label: string
  short: string
  hint: string
  placeholder: string
}

export const PROTOCOL_META: Record<LiveProtocol, ProtocolMeta> = {
  HLS: {
    label: "HLS (.m3u8)",
    short: "HLS",
    hint: "低延迟 HTTP Live Streaming，由 hls.js 解复用，Safari 使用原生播放。",
    placeholder: "https://example.com/live/index.m3u8",
  },
  WEBRTC: {
    label: "WebRTC / WHEP",
    short: "WebRTC",
    hint: "亚秒级超低延迟，通过 WHEP 信令（HTTP POST SDP）建立 recvonly 连接。",
    placeholder: "https://media.example.com/whep/cam-05",
  },
  RTSP: {
    label: "RTSP (via Gateway)",
    short: "RTSP",
    hint: "浏览器无法直接解码 rtsp://，需填写网关转码后的 HLS 地址。",
    placeholder: "http://localhost:8554/live/cam01/index.m3u8",
  },
  MP4: {
    label: "MP4 Local Loopback",
    short: "MP4",
    hint: "边缘节点本地回环重放，用于快速验证解码链路。",
    placeholder: "/ops/video/cam-01.mp4",
  },
}

export const LIVE_PROTOCOLS: LiveProtocol[] = ["HLS", "WEBRTC", "RTSP", "MP4"]

export interface LivePreset {
  id: string
  label: string
  description: string
  protocol: LiveProtocol
  url: string
}

export const LIVE_PRESETS: LivePreset[] = [
  {
    id: "bbb-hls",
    label: "公网 HLS 工业测试流 (Big Buck Bunny HLS)",
    description: "公网多码率 HLS，用于验证 hls.js 拉流与自适应码率",
    protocol: "HLS",
    url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
  },
  {
    id: "workshop-rtsp",
    label: "车间本地 RTSP 代理转流",
    description: "http://localhost:8554/live/cam01/index.m3u8，网关不可达时自动回退",
    protocol: "RTSP",
    url: "http://localhost:8554/live/cam01/index.m3u8",
  },
  {
    id: "cleanroom",
    label: "无尘洁净室测试流切片",
    description: "边缘节点本地回环切片，毫秒级起播",
    protocol: "MP4",
    url: "/ops/video/cam-02.mp4",
  },
]

export const DEFAULT_FALLBACK_SRC = CAMERAS[0]?.video ?? "/ops/video/cam-01.mp4"

export function fallbackSourceFor(channelId?: string): string {
  const camera = CAMERAS.find((c) => c.id === channelId)
  return camera?.video || DEFAULT_FALLBACK_SRC
}

export function posterFor(channelId?: string): string | undefined {
  return CAMERAS.find((c) => c.id === channelId)?.poster || undefined
}

/** Gateway convention used by the preset: CAM-01 -> cam01. */
export function gatewayHlsUrl(channelId: string) {
  return `http://localhost:8554/live/${channelId.replace(/\W/g, "").toLowerCase()}/index.m3u8`
}

const STANDARD_FPS = [15, 24, 25, 30, 50, 60]

export function nearestStandardFps(fps: number) {
  if (!Number.isFinite(fps) || fps <= 0) return 25
  return STANDARD_FPS.reduce((best, candidate) =>
    Math.abs(candidate - fps) < Math.abs(best - fps) ? candidate : best,
  )
}

const AVC_PROFILE: Record<string, string> = {
  "42": "Baseline Profile",
  "4d": "Main Profile",
  "58": "Extended Profile",
  "64": "High Profile",
  "6e": "High 10 Profile",
  "7a": "High 4:2:2 Profile",
}

function describeVideoCodec(codec?: string) {
  if (!codec) return "H.264 (推断)"
  const lower = codec.toLowerCase()
  if (lower.startsWith("avc1") || lower.startsWith("avc3")) {
    const profile = AVC_PROFILE[lower.split(".")[1]?.slice(0, 2) ?? ""]
    return profile ? `H.264 (${profile})` : "H.264"
  }
  if (lower.startsWith("hvc1") || lower.startsWith("hev1")) return "H.265 (HEVC)"
  if (lower.startsWith("vp09")) return "VP9"
  if (lower.startsWith("av01")) return "AV1"
  return codec.toUpperCase()
}

function describeAudioCodec(codec?: string) {
  if (!codec) return "无音轨 / 未探测"
  const lower = codec.toLowerCase()
  if (lower.startsWith("mp4a")) return "AAC"
  if (lower.startsWith("opus")) return "Opus"
  if (lower.startsWith("ac-3")) return "AC-3"
  return codec.toUpperCase()
}

export function parseCodec(video?: string, audio?: string) {
  return `${describeVideoCodec(video)} / ${describeAudioCodec(audio)}`
}

export function gradeLatency(ms: number): { grade: LatencyGrade; label: string } {
  if (ms < 500) return { grade: "A", label: "超低延迟" }
  if (ms < 1500) return { grade: "B", label: "低延迟" }
  if (ms < 4000) return { grade: "C", label: "标准延迟" }
  return { grade: "D", label: "高延迟" }
}

export function jitterStatus(jitterMs: number): { label: string; tone: "good" | "warn" | "bad" } {
  if (jitterMs < 15) return { label: "优秀", tone: "good" }
  if (jitterMs < 30) return { label: "良好", tone: "warn" }
  return { label: "较差", tone: "bad" }
}

const LATENCY_PENALTY: Record<LatencyGrade, number> = { A: 0, B: 3, C: 10, D: 20 }

function describeLoss(lossPct: number) {
  if (lossPct <= 0.1) return "符合安防标准"
  if (lossPct <= 1) return "可接受，建议关注"
  return "超出安防标准"
}

export function buildHealthReport(snapshot: QosSnapshot): StreamHealthReport {
  const decoderLoss =
    snapshot.totalFrames > 0 ? (snapshot.droppedFrames / snapshot.totalFrames) * 100 : 0
  const lossBasis = snapshot.rtpLossPct !== null ? "rtp" : "decoder"
  const packetLossPct = Math.round((snapshot.rtpLossPct ?? decoderLoss) * 100) / 100

  const latencyMs = Math.max(0, Math.round(snapshot.firstFrameMs + snapshot.fragLoadMs))
  const { grade, label } = gradeLatency(latencyMs)

  const fpsGap =
    snapshot.targetFps > 0 ? Math.max(0, (snapshot.targetFps - snapshot.fpsAvg) / snapshot.targetFps) : 0
  const penalty =
    Math.min(30, packetLossPct * 20) +
    Math.min(20, Math.max(0, snapshot.jitterAvgMs - 15) * 0.4) +
    Math.min(40, fpsGap * 40) +
    LATENCY_PENALTY[grade]
  const score = Math.round(Math.min(100, Math.max(0, 100 - penalty)) * 10) / 10

  return {
    codec: parseCodec(snapshot.videoCodec, snapshot.audioCodec),
    resolution: snapshot.resolution,
    packetLossPct,
    packetLossLabel: describeLoss(packetLossPct),
    lossBasis,
    latencyMs,
    latencyGrade: grade,
    latencyLabel: `${label} (Grade ${grade} - ${latencyMs}ms)`,
    score,
    verdict: score >= 90 ? "excellent" : score >= 70 ? "good" : "poor",
    generatedAt: new Date().toLocaleTimeString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" }),
  }
}
