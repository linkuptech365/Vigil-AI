import { CAMERAS } from "./data"
import {
  BUFFER_SECONDS,
  type BufferSample,
  type SegmentKind,
  type StreamSource,
} from "./ingestion-types"

const SEED: Array<
  Pick<StreamSource, "protocol" | "url" | "resolution" | "bitrate" | "latency">
> = [
  {
    protocol: "RTSP",
    url: "rtsp://admin:Vigil2024@192.168.1.101:554/live/ch0",
    resolution: "1080P",
    bitrate: 4.2,
    latency: 68,
  },
  {
    protocol: "GB28181",
    url: "gb28181://34020000001320000002@192.168.1.102:5060",
    resolution: "1080P",
    bitrate: 5.1,
    latency: 74,
  },
  {
    protocol: "RTSP",
    url: "rtsp://admin:pass@192.168.1.104:554/live/ch0",
    resolution: "2K",
    bitrate: 4.8,
    latency: 71,
  },
  {
    protocol: "RTMP",
    url: "rtmp://192.168.1.110:1935/live/warehouse",
    resolution: "1080P",
    bitrate: 4.3,
    latency: 92,
  },
]

export const INITIAL_STREAMS: StreamSource[] = CAMERAS.map((camera, index) => ({
  id: camera.id,
  name: camera.name,
  status: "connected",
  currentFps: 1,
  motionLevel: 2,
  samplingMode: "auto",
  fixedFps: 5,
  image: camera.image,
  ...SEED[index],
}))

/** Deterministic seed so server and client render the same first frame. */
export function seedHistory(channelIndex: number): BufferSample[] {
  return Array.from({ length: BUFFER_SECONDS }, (_, i) => {
    const active = (i + channelIndex * 7) % 13 >= 9
    return {
      fps: active ? 6 + ((i + channelIndex) % 3) : 1,
      motion: active ? 24 + ((i * 5) % 30) : 1.5 + ((i + channelIndex) % 3),
      trigger: false,
    }
  })
}

export function segmentKind(sample: BufferSample): SegmentKind {
  if (sample.trigger) return "trigger"
  return sample.fps >= 4 ? "high" : "low"
}

const RESOLUTION_FACTOR: Record<string, number> = {
  "720P": 0.6,
  "1080P": 1,
  "2K": 1.5,
  "4K": 2.8,
}

export function estimateMemoryMB(resolution: string, frames: number) {
  const factor = RESOLUTION_FACTOR[resolution] ?? 1
  return Math.round((85 + frames * 0.8) * (0.5 + factor * 0.5))
}

export function maskUrl(url: string) {
  return url.replace(/(\/\/[^:/@]+):([^@]+)@/, "$1:••••@")
}

export function composeUrl(url: string, username: string, password: string) {
  const trimmed = url.trim()
  if (!username || /\/\/[^/]*@/.test(trimmed)) return trimmed
  const credential = password ? `${username}:${password}` : username
  return trimmed.replace(/^([a-z0-9]+:\/\/)/i, `$1${credential}@`)
}

export const URL_PLACEHOLDER = {
  RTSP: "rtsp://192.168.1.104:554/live/ch0",
  RTMP: "rtmp://192.168.1.110:1935/live/stream",
  GB28181: "gb28181://34020000001320000005@192.168.1.105:5060",
  WebRTC: "https://media.example.com/whep/cam-05",
  FILE: "/data/videos/factory-demo.mp4",
} as const

export const KEYFRAME_OFFSETS = [-15, -10, -5, 0, 4, 8, 12, 15] as const
