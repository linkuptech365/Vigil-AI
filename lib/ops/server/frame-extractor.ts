import { spawn } from "node:child_process"
import path from "node:path"

import type { VlmKeyframeInput } from "../vlm-api-types"
import { locateVideo } from "./video-locator"
import { readVideoMeta } from "./video-meta"

/** 单帧 Base64 低于该长度视为无效（一张 640px 的 JPEG 至少有数 KB） */
export const MIN_VALID_BASE64_CHARS = 500
/** 低于该长度的帧大概率是纯色/空白帧，保留但打印告警 */
const SUSPICIOUS_BASE64_CHARS = 10_000
const MAX_VISION_FRAMES = 6
const FRAME_WIDTH = 640
const FRAME_TIMEOUT_MS = 15_000
const MAX_FRAME_BYTES = 4_000_000
const JPEG_MAGIC = [0xff, 0xd8, 0xff]

export interface RealFrame {
  index: number
  timestamp: string
  base64: string
  bytes: number
}

export class FrameExtractionError extends Error {}

let cachedFfmpegPath: string | undefined

function resolveFfmpegPath(): string {
  if (cachedFfmpegPath) return cachedFfmpegPath
  const fromEnv = process.env.FFMPEG_PATH?.trim()
  if (fromEnv) {
    cachedFfmpegPath = fromEnv
    return fromEnv
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bundled = require("ffmpeg-static") as string | null
    if (bundled) {
      cachedFfmpegPath = bundled
      return bundled
    }
  } catch {
    // 未安装 ffmpeg-static 时退回 PATH 上的 ffmpeg
  }
  cachedFfmpegPath = "ffmpeg"
  return cachedFfmpegPath
}

function grabJpeg(ffmpeg: string, file: string, atSec: number, signal: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const args = [
      "-hide_banner",
      "-loglevel", "error",
      "-ss", atSec.toFixed(3),
      "-i", file,
      "-frames:v", "1",
      "-vf", `scale='min(${FRAME_WIDTH},iw)':-2`,
      "-q:v", "4",
      "-f", "image2pipe",
      "-vcodec", "mjpeg",
      "pipe:1",
    ]
    const child = spawn(ffmpeg, args, { stdio: ["ignore", "pipe", "pipe"], signal })
    const chunks: Buffer[] = []
    let size = 0
    let stderr = ""
    const timer = setTimeout(() => child.kill("SIGKILL"), FRAME_TIMEOUT_MS)

    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_FRAME_BYTES) {
        child.kill("SIGKILL")
        return
      }
      chunks.push(chunk)
    })
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 400) stderr += chunk.toString()
    })
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      reject(
        new FrameExtractionError(
          error.code === "ENOENT"
            ? `找不到 ffmpeg 可执行文件（${ffmpeg}），请安装 ffmpeg 或设置环境变量 FFMPEG_PATH`
            : `ffmpeg 启动失败：${error.message}`
        )
      )
    })
    child.on("close", (code, killSignal) => {
      clearTimeout(timer)
      if (killSignal) return reject(new FrameExtractionError(`ffmpeg 在 ${atSec.toFixed(1)}s 处超时或被终止`))
      if (code !== 0) return reject(new FrameExtractionError(`ffmpeg 退出码 ${code}：${stderr.trim().slice(0, 200)}`))
      resolve(Buffer.concat(chunks))
    })
  })
}

function isJpeg(buffer: Buffer) {
  return JPEG_MAGIC.every((byte, i) => buffer[i] === byte)
}

/** 从已采样的关键帧里均匀挑出至多 MAX_VISION_FRAMES 个送给视觉模型 */
function pickFrames(frames: VlmKeyframeInput[]): VlmKeyframeInput[] {
  if (frames.length <= MAX_VISION_FRAMES) return frames
  return Array.from({ length: MAX_VISION_FRAMES }, (_, i) =>
    frames[Math.round((i * (frames.length - 1)) / (MAX_VISION_FRAMES - 1))]
  )
}

function formatTimecode(totalSec: number) {
  const minutes = Math.floor(totalSec / 60)
  const seconds = totalSec - minutes * 60
  return `${String(minutes).padStart(2, "0")}:${seconds.toFixed(1).padStart(4, "0")}`
}

/** 客户端没传关键帧时，按视频时长在 10%~90% 之间均匀取 4 个时间点 */
export async function defaultKeyframes(videoPath: string): Promise<VlmKeyframeInput[]> {
  const located = await locateVideo(videoPath)
  const meta = await readVideoMeta(located.resolved, path.extname(located.resolved).slice(1).toLowerCase(), located.stat)
  const duration = Math.max(1, meta.durationSeconds)
  return [0.1, 0.35, 0.65, 0.9].map((ratio, index) => {
    const timestampSec = Math.round(duration * ratio * 10) / 10
    return { index, timestampSec, timecode: formatTimecode(timestampSec) }
  })
}

/**
 * 对视频文件在各关键帧时间点真实解码，返回 Base64 编码的 JPEG。
 * 单帧失败只跳过该帧；全部失败时由调用方熔断。
 */
export async function extractRealFrames(
  videoPath: string,
  keyframes: VlmKeyframeInput[],
  signal: AbortSignal
): Promise<{ frames: RealFrame[]; errors: string[] }> {
  const located = await locateVideo(videoPath)
  const ffmpeg = resolveFfmpegPath()
  const frames: RealFrame[] = []
  const errors: string[] = []

  for (const keyframe of pickFrames(keyframes)) {
    if (signal.aborted) break
    try {
      const buffer = await grabJpeg(ffmpeg, located.resolved, Math.max(0, keyframe.timestampSec), signal)
      if (!buffer.length || !isJpeg(buffer)) {
        errors.push(`${keyframe.timecode} 未解码出有效 JPEG（输出 ${buffer.length} 字节）`)
        continue
      }
      const base64 = buffer.toString("base64")
      if (base64.length < SUSPICIOUS_BASE64_CHARS) {
        console.warn(`[VLM_FRAME] 帧 ${keyframe.timecode} 仅 ${base64.length} 字符，可能为纯色或空白帧`)
      }
      frames.push({ index: keyframe.index, timestamp: keyframe.timecode, base64, bytes: buffer.length })
    } catch (error) {
      errors.push(`${keyframe.timecode} ${error instanceof Error ? error.message : "抽帧失败"}`)
      if (error instanceof FrameExtractionError && error.message.includes("找不到 ffmpeg")) break
    }
  }
  return { frames, errors }
}
