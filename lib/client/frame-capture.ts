import type { VlmKeyframeInput } from "@/lib/ops/vlm-api-types"

export type FrameReason = "baseline" | "motion" | "patrol"

export interface AdaptiveFrame {
  /** mm:ss（超过 1 小时为 h:mm:ss） */
  timestamp: string
  seconds: number
  /** 完整的 data:image/jpeg;base64,... */
  base64: string
  reason: FrameReason
  /** 所属切片编号（从 1 起） */
  chunkIndex?: number
}

export interface MotionSegment {
  start: string
  end: string
  startSeconds: number
  endSeconds: number
  /** 区间内像素变化最剧烈的时间点 */
  peakSeconds?: number
  /** 峰值变化率（0-1），用于给区间排优先级 */
  peakRate?: number
}

export interface MotionScan {
  motionSegments: MotionSegment[]
  /** 静止时长占全片的百分比 */
  staticRatioPercent: number
  /** 初筛的实际采样间隔（秒）。时长不超过 MAX_SCAN_SAMPLES 秒时为 1，即严格 1 FPS。 */
  scanStepSeconds: number
}

export interface VideoChunk {
  /** 从 1 起 */
  index: number
  total: number
  startTime: number
  endTime: number
  startStr: string
  endStr: string
}

/** 一次打开、全程复用的视频句柄。用完必须 dispose()，否则解码器和 ObjectURL 会一直占着内存。 */
export interface CaptureSession {
  readonly video: HTMLVideoElement
  readonly duration: number
  dispose: () => void
}

const FRAME_WIDTH = 640
const JPEG_QUALITY = 0.85

const SCAN_WIDTH = 160
const SCAN_HEIGHT = 90
const PIXEL_DIFF_THRESHOLD = 24
const MOTION_RATE_THRESHOLD = 0.03
const MAX_SCAN_SAMPLES = 600
const SEGMENT_MERGE_GAP_SEC = 2

const BASELINE_SECOND = 1
const PATROL_RATIOS = [0.2, 0.5, 0.8]
const MAX_TOTAL_FRAMES = 8
const MIN_FRAME_GAP_SEC = 0.8
const LONG_SEGMENT_SEC = 6
const END_GUARD_SEC = 0.05

export const CHUNK_WINDOW_SECONDS = 90
const MIN_TAIL_CHUNK_SECONDS = 10
const MAX_CHUNK_MOTION_FRAMES = 5
const MIN_CHUNK_MOTION_FRAMES = 3
const CHUNK_PATROL_RATIOS = [0.25, 0.75]
const CHUNK_FILL_RATIOS = [0.5, 0.25, 0.75]

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

function makeChunk(index: number, total: number, startTime: number, endTime: number): VideoChunk {
  return { index, total, startTime, endTime, startStr: formatClock(startTime), endStr: formatClock(endTime) }
}

/**
 * 按 90 秒窗口切片。不超过 90 秒的视频是单切片；末尾不足 10 秒的零头并入上一片，避免为几秒画面单独发一次大模型请求。
 */
export function planVideoChunks(duration: number): VideoChunk[] {
  const safe = Math.max(0, duration)
  if (!(safe > CHUNK_WINDOW_SECONDS)) return [makeChunk(1, 1, 0, safe)]

  const ranges: Array<[number, number]> = []
  for (let start = 0; start < safe; start += CHUNK_WINDOW_SECONDS) {
    ranges.push([start, Math.min(start + CHUNK_WINDOW_SECONDS, safe)])
  }
  const last = ranges[ranges.length - 1]
  if (ranges.length > 1 && last[1] - last[0] < MIN_TAIL_CHUNK_SECONDS) {
    ranges.pop()
    ranges[ranges.length - 1][1] = safe
  }
  return ranges.map(([start, end], i) => makeChunk(i + 1, ranges.length, start, end))
}

/** 打开视频并读出时长。传入 Blob 时由会话创建并在 dispose() 时释放 ObjectURL；字符串地址不改动其生命周期。 */
export async function openCaptureSession(source: string | Blob): Promise<CaptureSession> {
  const objectUrl = typeof source === "string" ? null : URL.createObjectURL(source)
  const video = document.createElement("video")
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    video.pause()
    video.removeAttribute("src")
    video.load()
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  }

  try {
    await loadVideo(video, objectUrl ?? (source as string))
    const duration = video.duration
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("无法读取视频时长，浏览器不支持该流的时间定位")
    return { video, duration, dispose }
  } catch (error) {
    dispose()
    throw error
  }
}

/** Level-1：对整段视频做一次运动初筛，结果供各切片挑帧时复用。 */
export async function scanVideoMotion(session: CaptureSession): Promise<MotionScan> {
  const { segments, step } = await scanMotionSegments(session.video, session.duration)
  const motionDuration = segments.reduce((sum, segment) => sum + (segment.end - segment.start), 0)
  return {
    motionSegments: segments.map((segment) => ({
      start: formatClock(segment.start),
      end: formatClock(segment.end),
      startSeconds: segment.start,
      endSeconds: segment.end,
      peakSeconds: segment.peakAt,
      peakRate: segment.peakRate,
    })),
    staticRatioPercent: Math.round(
      Math.min(100, Math.max(0, 100 - (motionDuration / session.duration) * 100))
    ),
    scanStepSeconds: step,
  }
}

function toRawSegment(segment: MotionSegment): RawSegment {
  return {
    start: segment.startSeconds,
    end: segment.endSeconds,
    peakRate: segment.peakRate ?? 0.1,
    peakAt: segment.peakSeconds ?? (segment.startSeconds + segment.endSeconds) / 2,
  }
}

/** 把落在切片窗口内的动作区间裁剪到窗口边界；峰值落在窗口外时退回区间中点。 */
function clipSegmentsToChunk(segments: MotionSegment[], start: number, end: number) {
  return segments.flatMap((segment) => {
    if (segment.endSeconds <= start || segment.startSeconds >= end) return []
    const raw = toRawSegment(segment)
    const clippedStart = Math.max(raw.start, start)
    const clippedEnd = Math.min(raw.end, end)
    const peakInside = raw.peakAt >= clippedStart && raw.peakAt <= clippedEnd
    return [
      {
        start: clippedStart,
        end: clippedEnd,
        peakRate: raw.peakRate,
        peakAt: peakInside ? raw.peakAt : (clippedStart + clippedEnd) / 2,
      },
    ]
  })
}

/**
 * 多切片场景的挑帧：有动作区间时取各区间的峰值，再补起点和终点，总数 3-5 帧；
 * 区间完全静止时只在 25% / 75% 各取一帧巡检，尽快放行以省 Token。
 */
function selectChunkFrameTimes(start: number, end: number, segments: RawSegment[], limit: (t: number) => number) {
  const length = end - start
  const patrol = (ratio: number): Candidate => ({
    seconds: limit(start + length * ratio),
    weight: 1,
    reason: "patrol",
  })

  if (segments.length === 0) return CHUNK_PATROL_RATIOS.map(patrol)

  const selected: Candidate[] = []
  const accept = (candidate: Candidate, max: number) => {
    if (selected.length >= max) return
    if (selected.some((item) => Math.abs(item.seconds - candidate.seconds) < MIN_FRAME_GAP_SEC)) return
    selected.push(candidate)
  }

  const ranked = [...segments].sort((a, b) => b.peakRate - a.peakRate)
  const motion = (seconds: number, segment: RawSegment, factor: number): Candidate => ({
    seconds: limit(seconds),
    weight: (1 + Math.min(segment.peakRate, 1) * 10) * factor,
    reason: "motion",
  })
  for (const segment of ranked) accept(motion(segment.peakAt, segment, 1.1), MAX_CHUNK_MOTION_FRAMES)
  for (const segment of ranked) {
    const inset = Math.min(0.5, (segment.end - segment.start) / 4)
    accept(motion(segment.start + inset, segment, 0.9), MAX_CHUNK_MOTION_FRAMES)
    accept(motion(segment.end, segment, 0.8), MAX_CHUNK_MOTION_FRAMES)
  }
  for (const ratio of CHUNK_FILL_RATIOS) accept(patrol(ratio), MIN_CHUNK_MOTION_FRAMES)

  return selected.sort((a, b) => a.seconds - b.seconds)
}

function isSession(source: CaptureSession | string | Blob): source is CaptureSession {
  return typeof source === "object" && "video" in source && "dispose" in source
}

/**
 * 在 [startTime, endTime] 内按切片抽帧，每张帧带准确时间戳和切片编号。
 * 传入 CaptureSession 时复用其视频元素（不会释放）；传入地址或 Blob 时临时打开并在结束后释放。
 * totalChunks 为 1 时沿用整片的原有挑帧策略（首帧基线 + 动作区间 / 20-50-80% 巡检，最多 8 帧）。
 */
export async function captureChunkFrames(
  videoSource: CaptureSession | string | Blob,
  startTime: number,
  endTime: number,
  chunkIndex: number,
  options: { motionSegments?: MotionSegment[]; totalChunks?: number } = {}
): Promise<AdaptiveFrame[]> {
  const owned = isSession(videoSource) ? null : await openCaptureSession(videoSource)
  const session = owned ?? (videoSource as CaptureSession)
  const canvas = document.createElement("canvas")

  try {
    const { video, duration } = session
    const start = Math.max(0, startTime)
    const end = Math.min(endTime, duration)
    if (!(end > start)) throw new Error(`切片 ${chunkIndex} 的时间区间无效 [${startTime}, ${endTime}]`)

    const withinChunk = (seconds: number) => Math.min(clampTime(Math.max(seconds, start), duration), end - END_GUARD_SEC)
    const segments = clipSegmentsToChunk(options.motionSegments ?? [], start, end)
    const targets =
      (options.totalChunks ?? 1) <= 1
        ? selectFrameTimes(duration, segments)
        : selectChunkFrameTimes(start, end, segments, withinChunk)

    const sourceWidth = video.videoWidth || FRAME_WIDTH
    const sourceHeight = video.videoHeight || 360
    canvas.width = FRAME_WIDTH
    canvas.height = Math.max(1, Math.round((sourceHeight * FRAME_WIDTH) / sourceWidth))
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("浏览器不支持 Canvas 2D")

    const frames: AdaptiveFrame[] = []
    for (const target of targets) {
      await seekTo(video, target.seconds)
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      frames.push({
        timestamp: formatClock(target.seconds),
        seconds: Number(target.seconds.toFixed(2)),
        base64: canvas.toDataURL("image/jpeg", JPEG_QUALITY),
        reason: target.reason,
        chunkIndex,
      })
    }
    return frames
  } finally {
    // 归零画布尺寸，让浏览器立刻回收位图缓冲，长视频多切片时不会累积
    canvas.width = 0
    canvas.height = 0
    owned?.dispose()
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
