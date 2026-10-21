import type { VlmKeyframeInput } from "@/lib/ops/vlm-api-types"

export type FrameReason = "baseline" | "motion" | "patrol"

export interface AdaptiveFrame {
  /** mm:ss（超过 1 小时为 h:mm:ss） */
  timestamp: string
  seconds: number
  /** 完整的 data:image/jpeg;base64,... */
  base64: string
  reason: FrameReason
}

export interface MotionSegment {
  start: string
  end: string
  startSeconds: number
  endSeconds: number
}

export interface AdaptiveCaptureResult {
  frames: AdaptiveFrame[]
  totalVideoDuration: number
  motionSegments: MotionSegment[]
  /** 静止时长占全片的百分比 */
  staticRatioPercent: number
  /** 初筛的实际采样间隔（秒）。时长不超过 MAX_SCAN_SAMPLES 秒时为 1，即严格 1 FPS。 */
  scanStepSeconds: number
}

const FRAME_WIDTH = 640
const JPEG_QUALITY = 0.85

const SCAN_WIDTH = 160
const SCAN_HEIGHT = 90
const PIXEL_DIFF_THRESHOLD = 24
const MOTION_RATE_THRESHOLD = 0.03
const MAX_SCAN_SAMPLES = 240
const SEGMENT_MERGE_GAP_SEC = 2

const BASELINE_SECOND = 1
const PATROL_RATIOS = [0.2, 0.5, 0.8]
const MAX_TOTAL_FRAMES = 8
const MIN_FRAME_GAP_SEC = 0.8
const LONG_SEGMENT_SEC = 6
const END_GUARD_SEC = 0.05

const METADATA_TIMEOUT_MS = 15_000
const SEEK_TIMEOUT_MS = 8_000

interface RawSegment {
  start: number
  end: number
  peakRate: number
  peakAt: number
}

interface Candidate {
  seconds: number
  weight: number
  reason: FrameReason
}

export function formatClock(totalSeconds: number) {
  const safe = Math.max(0, Math.round(totalSeconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const seconds = safe % 60
  const mm = String(minutes).padStart(2, "0")
  const ss = String(seconds).padStart(2, "0")
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`
}

function waitForEvent(video: HTMLVideoElement, event: string, timeoutMs: number, label: string) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timer)
      video.removeEventListener(event, onDone)
      video.removeEventListener("error", onError)
    }
    const onDone = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error(`${label}失败：浏览器无法解码该视频`))
    }
    const timer = window.setTimeout(() => {
      cleanup()
      reject(new Error(`${label}超时`))
    }, timeoutMs)
    video.addEventListener(event, onDone)
    video.addEventListener("error", onError)
  })
}

async function seekTo(video: HTMLVideoElement, time: number) {
  const pending = waitForEvent(video, "seeked", SEEK_TIMEOUT_MS, "视频定位")
  video.currentTime = time
  await pending
  // seeked 触发后当前帧数据可能还没就绪，drawImage 会画出空白帧
  if (video.readyState < 2) await waitForEvent(video, "loadeddata", SEEK_TIMEOUT_MS, "等待画面数据")
}

function clampTime(seconds: number, duration: number) {
  return Math.min(Math.max(0, seconds), Math.max(0, duration - END_GUARD_SEC))
}

/** Level-1：按 1 FPS 在 160x90 灰度缩略图上做相邻帧差分，返回合并后的活跃时间段。 */
async function scanMotionSegments(video: HTMLVideoElement, duration: number) {
  const canvas = document.createElement("canvas")
  canvas.width = SCAN_WIDTH
  canvas.height = SCAN_HEIGHT
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) throw new Error("浏览器不支持 Canvas 2D")

  const step = Math.max(1, Math.ceil(duration / MAX_SCAN_SAMPLES))
  const pixelCount = SCAN_WIDTH * SCAN_HEIGHT
  let previous: Uint8Array | null = null
  let previousTime = 0
  const motionIntervals: RawSegment[] = []

  for (let t = 0; t < duration; t += step) {
    const time = clampTime(t, duration)
    await seekTo(video, time)
    ctx.drawImage(video, 0, 0, SCAN_WIDTH, SCAN_HEIGHT)
    const { data } = ctx.getImageData(0, 0, SCAN_WIDTH, SCAN_HEIGHT)
    const gray = new Uint8Array(pixelCount)
    for (let i = 0, p = 0; i < pixelCount; i++, p += 4) {
      gray[i] = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000
    }

    if (previous) {
      let changed = 0
      for (let i = 0; i < pixelCount; i++) {
        if (Math.abs(gray[i] - previous[i]) > PIXEL_DIFF_THRESHOLD) changed++
      }
      const rate = changed / pixelCount
      if (rate > MOTION_RATE_THRESHOLD) {
        motionIntervals.push({ start: previousTime, end: time, peakRate: rate, peakAt: time })
      }
    }
    previous = gray
    previousTime = time
  }

  const merged: RawSegment[] = []
  const mergeGap = Math.max(SEGMENT_MERGE_GAP_SEC, step)
  for (const interval of motionIntervals) {
    const last = merged[merged.length - 1]
    if (last && interval.start <= last.end + mergeGap) {
      last.end = Math.max(last.end, interval.end)
      if (interval.peakRate > last.peakRate) {
        last.peakRate = interval.peakRate
        last.peakAt = interval.peakAt
      }
    } else {
      merged.push({ ...interval })
    }
  }
  return { segments: merged, step }
}

function buildSegmentCandidates(segment: RawSegment, duration: number) {
  const length = segment.end - segment.start
  const base = 1 + Math.min(segment.peakRate, 1) * 10
  const inset = Math.min(0.5, length / 4)
  const make = (seconds: number, factor: number): Candidate => ({
    seconds: clampTime(seconds, duration),
    weight: base * factor,
    reason: "motion",
  })
  const candidates = [
    make((segment.start + segment.end) / 2, 1),
    make(segment.start + inset, 0.9),
    make(segment.end, 0.8),
  ]
  if (length >= LONG_SEGMENT_SEC) candidates.push(make(segment.peakAt, 1.1))
  return { mid: candidates[0], all: candidates, score: base }
}

/** 基线帧必留；每个活跃段先保证一个中点帧，余量再按权重补起点/终点/峰值帧。 */
function selectFrameTimes(duration: number, segments: RawSegment[]) {
  const selected: Candidate[] = [
    {
      seconds: clampTime(Math.min(BASELINE_SECOND, duration * 0.5), duration),
      weight: Number.POSITIVE_INFINITY,
      reason: "baseline",
    },
  ]
  const accept = (candidate: Candidate) => {
    if (selected.length >= MAX_TOTAL_FRAMES) return
    if (selected.some((item) => Math.abs(item.seconds - candidate.seconds) < MIN_FRAME_GAP_SEC)) return
    selected.push(candidate)
  }

  if (segments.length === 0) {
    for (const ratio of PATROL_RATIOS) {
      accept({ seconds: clampTime(duration * ratio, duration), weight: 1, reason: "patrol" })
    }
  } else {
    const built = segments.map((segment) => buildSegmentCandidates(segment, duration))
    for (const item of [...built].sort((a, b) => b.score - a.score)) accept(item.mid)
    const rest = built.flatMap((item) => item.all.slice(1)).sort((a, b) => b.weight - a.weight)
    for (const candidate of rest) accept(candidate)
  }
  return selected.sort((a, b) => a.seconds - b.seconds)
}

async function loadVideo(video: HTMLVideoElement, src: string) {
  video.muted = true
  video.playsInline = true
  video.preload = "auto"
  video.src = src
  if (video.readyState < 1) await waitForEvent(video, "loadedmetadata", METADATA_TIMEOUT_MS, "加载视频元数据")
  if (video.readyState < 2) await waitForEvent(video, "loadeddata", METADATA_TIMEOUT_MS, "加载首帧画面")
}

/**
 * 自适应抽帧：Level-1 像素运动初筛 → 首帧基线 + 动作区间密集采样（静止则均匀巡检）→ 640px JPEG。
 * 传入 Blob 时由本函数创建并释放 ObjectURL；传入字符串地址则不改动其生命周期。
 */
export async function captureAdaptiveFrames(source: string | Blob): Promise<AdaptiveCaptureResult> {
  const objectUrl = typeof source === "string" ? null : URL.createObjectURL(source)
  const video = document.createElement("video")

  try {
    await loadVideo(video, objectUrl ?? (source as string))
    const duration = video.duration
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("无法读取视频时长，浏览器不支持该流的时间定位")

    const { segments, step } = await scanMotionSegments(video, duration)
    const motionDuration = segments.reduce((sum, segment) => sum + (segment.end - segment.start), 0)
    const staticRatioPercent = Math.round(Math.min(100, Math.max(0, 100 - (motionDuration / duration) * 100)))

    const sourceWidth = video.videoWidth || FRAME_WIDTH
    const sourceHeight = video.videoHeight || 360
    const canvas = document.createElement("canvas")
    canvas.width = FRAME_WIDTH
    canvas.height = Math.max(1, Math.round((sourceHeight * FRAME_WIDTH) / sourceWidth))
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("浏览器不支持 Canvas 2D")

    const frames: AdaptiveFrame[] = []
    for (const target of selectFrameTimes(duration, segments)) {
      await seekTo(video, target.seconds)
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      frames.push({
        timestamp: formatClock(target.seconds),
        seconds: Number(target.seconds.toFixed(2)),
        base64: canvas.toDataURL("image/jpeg", JPEG_QUALITY),
        reason: target.reason,
      })
    }

    return {
      frames,
      totalVideoDuration: duration,
      motionSegments: segments.map((segment) => ({
        start: formatClock(segment.start),
        end: formatClock(segment.end),
        startSeconds: segment.start,
        endSeconds: segment.end,
      })),
      staticRatioPercent,
      scanStepSeconds: step,
    }
  } finally {
    video.pause()
    video.removeAttribute("src")
    video.load()
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  }
}

/** 转为 /api/v1/vlm/analyze 的 keyframes 形态，图片放在 imageUrl。 */
export function toKeyframeInputs(frames: AdaptiveFrame[]): VlmKeyframeInput[] {
  return frames.map((frame, index) => ({
    index,
    timestampSec: frame.seconds,
    timecode: frame.timestamp,
    imageUrl: frame.base64,
  }))
}
