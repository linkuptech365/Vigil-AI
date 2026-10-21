import type { OverlayBox } from "@/lib/ops/types"
import type { VideoItem } from "@/lib/vigil/types"

export interface TimeMarker {
  sec: number
  label: string
  tone: "alert" | "frame"
}

function hash(input: string) {
  let value = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    value ^= input.charCodeAt(i)
    value = Math.imul(value, 16777619)
  }
  return value >>> 0
}

/**
 * VLM 研判只返回结论而不返回像素坐标，所以标注框的位置由视频 id 稳定派生，
 * 框的内容（场景、置信度、是否预警）全部来自真实研判结果。
 */
export function deriveOverlayBoxes(video: VideoItem): OverlayBox[] {
  if (video.status !== "alert" && video.status !== "safe") return []

  const seed = hash(video.id)
  const w = 26 + (seed % 10)
  const h = 34 + ((seed >> 4) % 12)
  const x = 12 + ((seed >> 8) % Math.max(100 - w - 24, 1))
  const y = 20 + ((seed >> 12) % Math.max(100 - h - 36, 1))
  const percent = video.confidence !== undefined ? ` ${Math.round(video.confidence * 100)}%` : ""

  if (video.status === "alert" && video.ruleId) {
    return [
      {
        x,
        y,
        w,
        h,
        tone: "critical",
        pulse: true,
        label: `${video.ruleName ?? video.ruleId ?? "异常预警"}${percent}`,
      },
    ]
  }

  return [{ x, y, w, h, tone: "ok", label: `合规${percent}` }]
}

/** 触发预警的时间点：优先取 VLM 引用的第一张证据关键帧，其次是抽帧窗口起点。 */
export function triggerSecOf(video: VideoItem): number {
  const evidence = video.vlmReport?.result.evidenceKeyframes[0]
  const evidenceFrame =
    evidence !== undefined ? video.keyframes?.find((frame) => frame.index === evidence) : undefined
  return evidenceFrame?.timestampSec ?? video.keyframeWindow?.startSec ?? video.keyframes?.[0]?.timestampSec ?? 0
}

export function buildTimeMarkers(video: VideoItem, limit = 4): TimeMarker[] {
  const markers: TimeMarker[] = []

  if (video.status === "alert") {
    markers.push({ sec: triggerSecOf(video), label: "触发点", tone: "alert" })
  }

  const evidence = new Set(video.vlmReport?.result.evidenceKeyframes ?? [])
  for (const frame of video.keyframes ?? []) {
    if (markers.length >= limit) break
    if (evidence.size > 0 && !evidence.has(frame.index)) continue
    if (markers.some((marker) => Math.abs(marker.sec - frame.timestampSec) < 0.5)) continue
    markers.push({ sec: frame.timestampSec, label: frame.timecode, tone: "frame" })
  }

  return markers.sort((a, b) => a.sec - b.sec)
}
