import { spawn } from "node:child_process"

import { resolveFfmpegPath } from "@/lib/ops/server/frame-extractor"
import { loadStreams } from "@/lib/storage/streams-store"
import { loadVisionConfig } from "@/lib/storage/vision-store"
import { EMPTY_VISION_STATS, type VisionStats, type VisionStreamHealth } from "@/lib/vigil/vision"

/**
 * Node 端 Tier-0 帧差预筛：Python 视觉环境未就绪时接管，避免漏斗处于"未运行"死锁。
 * 取帧走 go2rtc 的 frame.jpeg，解码与缩放交给 ffmpeg（项目已内置），不依赖任何 Python 包。
 * 它只负责回答"这一路最近有没有画面变化"，供定时巡检跳过静止画面，从而节省大模型调用。
 */

const GO2RTC_URL = "http://127.0.0.1:1984"
const FRAME_W = 160
const FRAME_H = 90
const DIFF_THRESHOLD = 25
const TICK_MS = 250
const DECODE_TIMEOUT_MS = 8_000

interface FallbackState {
  active: boolean
  timer: NodeJS.Timeout | null
  busy: boolean
  prev: Map<string, Buffer>
  nextAt: Map<string, number>
  lastMotionAt: Map<string, number>
  streams: Record<string, VisionStreamHealth>
  stats: VisionStats
}

const globalStore = globalThis as typeof globalThis & { __vigilMotionFallback?: FallbackState }

function state(): FallbackState {
  if (!globalStore.__vigilMotionFallback) {
    globalStore.__vigilMotionFallback = {
      active: false,
      timer: null,
      busy: false,
      prev: new Map(),
      nextAt: new Map(),
      lastMotionAt: new Map(),
      streams: {},
      stats: { ...EMPTY_VISION_STATS },
    }
  }
  return globalStore.__vigilMotionFallback
}

function decodeGray(jpeg: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      resolveFfmpegPath(),
      ["-v", "error", "-f", "image2pipe", "-i", "pipe:0", "-vf", `scale=${FRAME_W}:${FRAME_H},format=gray,boxblur=2:1`, "-frames:v", "1", "-f", "rawvideo", "pipe:1"],
      { stdio: ["pipe", "pipe", "ignore"], windowsHide: true }
    )
    const chunks: Buffer[] = []
    const timer = setTimeout(() => child.kill(), DECODE_TIMEOUT_MS)
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk))
    child.stdin.on("error", () => undefined)
    child.once("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once("close", () => {
      clearTimeout(timer)
      const data = Buffer.concat(chunks)
      if (data.length === FRAME_W * FRAME_H) resolve(data)
      else reject(new Error("ffmpeg 未能解码画面"))
    })
    child.stdin.end(jpeg)
  })
}

function changedPercent(prev: Buffer, current: Buffer) {
  let changed = 0
  for (let index = 0; index < current.length; index += 1) {
    if (Math.abs(current[index] - prev[index]) > DIFF_THRESHOLD) changed += 1
  }
  return (changed / current.length) * 100
}

async function scanStream(streamId: string, thresholdPct: number) {
  const fb = state()
  const response = await fetch(`${GO2RTC_URL}/api/frame.jpeg?src=${encodeURIComponent(streamId)}&width=320`, {
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  })
  if (!response.ok) throw new Error(`流媒体引擎返回 HTTP ${response.status}`)
  const gray = await decodeGray(Buffer.from(await response.arrayBuffer()))

  const previous = fb.prev.get(streamId)
  fb.prev.set(streamId, gray)
  const motionPct = previous ? changedPercent(previous, gray) : null
  const moving = motionPct === null || motionPct >= thresholdPct

  fb.stats.totalFrames += 1
  if (moving) {
    fb.stats.motionOnlyFrames += 1
    fb.lastMotionAt.set(streamId, Date.now())
  } else {
    fb.stats.tier0Filtered += 1
  }
  const frames = (fb.streams[streamId]?.frames ?? 0) + 1
  fb.streams[streamId] = { online: true, monitored: true, frames, motionPct, error: "" }
}

async function tick() {
  const fb = state()
  if (fb.busy || !fb.active) return
  fb.busy = true
  try {
    const config = loadVisionConfig()
    if (!config.enabled) return
    const intervalMs = 1000 / Math.max(0.2, config.sampleFps)
    const ids = loadStreams()
      .filter((stream) => stream.autoPatrol)
      .map((stream) => stream.id)
    for (const key of Object.keys(fb.streams)) if (!ids.includes(key)) delete fb.streams[key]
    for (const id of ids) {
      if (!fb.active) return
      const now = Date.now()
      if (now < (fb.nextAt.get(id) ?? 0)) continue
      fb.nextAt.set(id, now + intervalMs)
      try {
        await scanStream(id, config.motionThresholdPct)
      } catch (error) {
        fb.nextAt.set(id, Date.now() + 3_000)
        const message = (error instanceof Error ? error.message : "取帧失败").slice(0, 160)
        fb.streams[id] = { online: false, monitored: true, frames: fb.streams[id]?.frames ?? 0, motionPct: null, error: message }
      }
    }
  } finally {
    fb.busy = false
  }
}

/** 幂等：启停 Node 端帧差预筛 */
export function setMotionFallbackActive(active: boolean) {
  const fb = state()
  if (active === fb.active) return
  fb.active = active
  if (active) {
    fb.timer = setInterval(() => void tick(), TICK_MS)
    fb.timer.unref?.()
  } else {
    if (fb.timer) clearInterval(fb.timer)
    fb.timer = null
    fb.prev.clear()
    fb.nextAt.clear()
  }
}

export const motionFallbackActive = () => state().active

export function motionFallbackSnapshot() {
  const fb = state()
  return { stats: { ...fb.stats }, streams: { ...fb.streams } }
}

export function resetMotionFallbackStats() {
  state().stats = { ...EMPTY_VISION_STATS }
}

/**
 * 定时巡检用：自 sinceMs 以来这一路是否出现过画面变化。
 * 预筛未运行、或该通道还没有采到帧时一律放行，保持原有的整段研判行为。
 */
export function motionSince(streamId: string, sinceMs: number) {
  const fb = state()
  if (!fb.active) return true
  const health = fb.streams[streamId]
  if (!health || !health.online || health.frames < 2) return true
  return (fb.lastMotionAt.get(streamId) ?? 0) > sinceMs
}
