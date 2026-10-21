import { formatTimecode } from "@/lib/ops/vlm-client"
import type { VlmKeyframeInput } from "@/lib/ops/vlm-api-types"

export interface CapturedFrame {
  timestamp: string
  /** 完整的 data:image/jpeg;base64,... */
  base64: string
}

export const DEFAULT_SAMPLE_RATIOS = [0.1, 0.35, 0.65, 0.9]

const FRAME_WIDTH = 640
const JPEG_QUALITY = 0.85
const METADATA_TIMEOUT_MS = 15_000
const SEEK_TIMEOUT_MS = 8_000

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

/** 在已就绪的 <video> 上按时长比例定位并用 Canvas 截取 JPEG 帧；结束后恢复原播放位置。 */
export async function captureVideoFramesFromElement(
  videoElement: HTMLVideoElement,
  sampleRatios: number[] = DEFAULT_SAMPLE_RATIOS
): Promise<CapturedFrame[]> {
  const duration = Number.isFinite(videoElement.duration) && videoElement.duration > 0 ? videoElement.duration : 3
  const sourceWidth = videoElement.videoWidth || FRAME_WIDTH
  const sourceHeight = videoElement.videoHeight || 360

  const canvas = document.createElement("canvas")
  canvas.width = FRAME_WIDTH
  canvas.height = Math.max(1, Math.round((sourceHeight * FRAME_WIDTH) / sourceWidth))
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("浏览器不支持 Canvas 2D")

  const originalTime = videoElement.currentTime
  const wasPaused = videoElement.paused
  videoElement.pause()

  const frames: CapturedFrame[] = []
  try {
    for (const ratio of sampleRatios) {
      const targetTime = Math.min(duration * ratio, Math.max(0, duration - 0.05))
      await seekTo(videoElement, targetTime)
      ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height)
      frames.push({
        timestamp: `${targetTime.toFixed(1)}s`,
        base64: canvas.toDataURL("image/jpeg", JPEG_QUALITY),
      })
    }
  } finally {
    try {
      videoElement.currentTime = originalTime
      if (!wasPaused) void videoElement.play().catch(() => undefined)
    } catch {
      // 恢复播放位置失败不影响抽帧结果
    }
  }
  return frames
}

/** 用离屏 <video> 加载任意可播放地址（Blob URL / 同源取流接口）后抽帧。 */
export async function captureVideoFramesFromSrc(
  src: string,
  sampleRatios: number[] = DEFAULT_SAMPLE_RATIOS
): Promise<CapturedFrame[]> {
  const video = document.createElement("video")
  video.muted = true
  video.playsInline = true
  video.preload = "auto"
  video.src = src

  try {
    if (video.readyState < 1) await waitForEvent(video, "loadedmetadata", METADATA_TIMEOUT_MS, "加载视频元数据")
    if (video.readyState < 2) await waitForEvent(video, "loadeddata", METADATA_TIMEOUT_MS, "加载首帧画面")
    return await captureVideoFramesFromElement(video, sampleRatios)
  } finally {
    video.removeAttribute("src")
    video.load()
  }
}

/** 转为 /api/v1/vlm/analyze 的 keyframes 形态，图片放在 imageUrl。 */
export function toKeyframeInputs(frames: CapturedFrame[]): VlmKeyframeInput[] {
  return frames.map((frame, index) => {
    const timestampSec = Number.parseFloat(frame.timestamp) || 0
    return { index, timestampSec, timecode: formatTimecode(timestampSec), imageUrl: frame.base64 }
  })
}
