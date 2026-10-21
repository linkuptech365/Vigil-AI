import path from "node:path"
import { NextResponse } from "next/server"

import { renderKeyframe, seedFrom } from "@/lib/ops/server/frame-svg"
import { PathGuardError } from "@/lib/ops/server/path-guard"
import { locateVideo } from "@/lib/ops/server/video-locator"
import { readVideoMeta } from "@/lib/ops/server/video-meta"
import {
  DEFAULT_VIDEO_EXTENSIONS,
  type ExtractFramesRequest,
  type ExtractFramesResponse,
  type ExtractedKeyframe,
  type SamplingFps,
  type VideoApiError,
} from "@/lib/ops/video-types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const FRAME_COUNT = 8
const HALF_WINDOW_SEC = 15
const VALID_FPS: readonly SamplingFps[] = [1, 2, 5]

function fail(status: number, message: string) {
  return NextResponse.json<VideoApiError>({ status: "error", message }, { status })
}

const round3 = (value: number) => Math.round(value * 1000) / 1000

function timecode(sec: number) {
  const tenths = Math.round(sec * 10)
  const m = Math.floor(tenths / 600)
  const s = (tenths % 600) / 10
  return `${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`
}

function buildTimestamps(startSec: number, endSec: number, fps: SamplingFps): number[] {
  const raw = Array.from({ length: FRAME_COUNT }, (_, i) =>
    startSec + ((endSec - startSec) * i) / (FRAME_COUNT - 1)
  )
  const snapped = raw.map((t) => Math.min(endSec, Math.max(startSec, Math.round(t * fps) / fps)))
  const strictlyIncreasing = snapped.every((t, i) => i === 0 || t > snapped[i - 1])
  return (strictlyIncreasing ? snapped : raw).map(round3)
}

function motionFor(seed: number, index: number, t: number, trigger: number) {
  const proximity = Math.exp(-(((t - trigger) / 6) ** 2))
  const jitter = (((seed >>> (index * 3)) & 0xff) / 255) * 0.2
  return Math.min(1, Math.max(0, 0.22 + 0.55 * proximity + jitter))
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Partial<ExtractFramesRequest> | null
  if (!body || typeof body !== "object") return fail(400, "请求体必须是 JSON 对象")

  const fps = (body.fps ?? 2) as SamplingFps
  if (!VALID_FPS.includes(fps)) return fail(400, "fps 仅支持 1、2、5")
  if (
    body.triggerTimestampSec !== undefined &&
    (typeof body.triggerTimestampSec !== "number" ||
      !Number.isFinite(body.triggerTimestampSec) ||
      body.triggerTimestampSec < 0)
  ) {
    return fail(400, "triggerTimestampSec 必须是非负数字")
  }

  try {
    const { resolved, stat } = await locateVideo(body.videoPath)
    const ext = path.extname(resolved).toLowerCase()
    if (!(DEFAULT_VIDEO_EXTENSIONS as readonly string[]).includes(ext)) {
      return fail(400, "不支持的视频格式")
    }

    const meta = await readVideoMeta(resolved, ext, stat)
    const duration = meta.durationSeconds
    const trigger = Math.min(duration, Math.max(0, body.triggerTimestampSec ?? duration / 2))
    const startSec = Math.max(0, trigger - HALF_WINDOW_SEC)
    const endSec = Math.min(duration, trigger + HALF_WINDOW_SEC)

    const timestamps = buildTimestamps(startSec, endSec, fps)
    const videoSeed = seedFrom(`${resolved}|${stat.size}`)
    const scores = timestamps.map((t, i) => motionFor(videoSeed, i, t, trigger))
    const peakIndex = scores.indexOf(Math.max(...scores))

    const keyframes: ExtractedKeyframe[] = timestamps.map((t, i) => ({
      index: i,
      timestampSec: t,
      timecode: timecode(t),
      motionScore: round3(scores[i]),
      thumbnailUrl: renderKeyframe({
        videoSeed,
        index: i,
        total: FRAME_COUNT,
        timecode: timecode(t),
        motionScore: scores[i],
        peak: i === peakIndex,
      }),
    }))

    return NextResponse.json<ExtractFramesResponse>({
      status: "success",
      videoPath: resolved,
      samplingFps: fps,
      totalFramesExtracted: FRAME_COUNT,
      durationSeconds: duration,
      triggerTimestampSec: round3(trigger),
      windowRange: { startSec: round3(startSec), endSec: round3(endSec) },
      renderMode: "synthetic-svg",
      keyframes,
    })
  } catch (error) {
    if (error instanceof PathGuardError) return fail(error.httpStatus, error.message)
    return fail(500, "服务端抽帧时发生异常")
  }
}
