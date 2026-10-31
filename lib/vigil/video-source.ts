import type { VideoItem } from "./types"
import { toRequestVideoPath } from "./video-path"

/** 本机导入的视频只存在于当前页面的 Blob URL 中，不写入 localStorage。 */
const localVideoUrls = new Map<string, string>()

export function registerLocalVideo(id: string, file: File) {
  const previous = localVideoUrls.get(id)
  if (previous) URL.revokeObjectURL(previous)
  localVideoUrls.set(id, URL.createObjectURL(file))
}

export function releaseLocalVideo(id: string) {
  const url = localVideoUrls.get(id)
  if (!url) return
  URL.revokeObjectURL(url)
  localVideoUrls.delete(id)
}

export function releaseAllLocalVideos() {
  for (const url of localVideoUrls.values()) URL.revokeObjectURL(url)
  localVideoUrls.clear()
}

/** 返回可直接交给 <video src> 的地址；没有可播放来源（如测试样本）时返回 null。 */
export function getVideoSrc(video: VideoItem): string | null {
  if (video.source === "disk") {
    return `/api/v1/videos/stream?path=${encodeURIComponent(toRequestVideoPath(video))}`
  }
  return localVideoUrls.get(video.id) ?? null
}

/** "1920x1080" -> "1080P"，"3840x2160" -> "4K"；无法识别时返回 null。 */
export function formatResolutionLabel(
  resolution: string | null | undefined,
  width?: number,
  height?: number
): string | null {
  let h = height && height > 0 ? height : 0
  if (!h && resolution) {
    const pair = /(\d{3,5})\s*[x×*]\s*(\d{3,5})/i.exec(resolution)
    if (pair) h = Number(pair[2])
    else {
      const p = /(\d{3,4})\s*p/i.exec(resolution)
      if (p) h = Number(p[1])
    }
  }
  if (!h && width && width > 0) h = Math.round((width * 9) / 16)
  if (!h) return null
  return h >= 2160 ? "4K" : `${h}P`
}

/** 从文件名提取机位编号：cam_03 -> CAM-03，case_bio_01_xxx -> BIO-01，否则取文件名前缀。 */
export function cameraTag(fileName: string): string {
  const cam = /cam[-_ ]?(\d{1,3})/i.exec(fileName)
  if (cam) return `CAM-${cam[1].padStart(2, "0")}`
  const bio = /bio[-_ ]?(\d{1,3})/i.exec(fileName)
  if (bio) return `BIO-${bio[1].padStart(2, "0")}`
  const base = fileName.replace(/\.[^.]+$/, "")
  return (base.length > 14 ? `${base.slice(0, 13)}…` : base).toUpperCase()
}

export const QUEUE_VIEW_MODE_KEY = "vigil_queue_view_mode"
export type QueueViewMode = "grid" | "table"

/** 控制台 -> 监控大屏的投屏请求，通过 localStorage 跨页面（及跨标签页）传递。 */
export const CAST_REQUEST_KEY = "vigil_cast_request"

export interface CastRequest {
  channelId: string
  label: string
  url: string
  nonce: number
}

export function writeCastRequest(request: Omit<CastRequest, "nonce">) {
  const payload: CastRequest = { ...request, nonce: Date.now() }
  window.localStorage.setItem(CAST_REQUEST_KEY, JSON.stringify(payload))
}

export function parseCastRequest(raw: string | null): CastRequest | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== "object" || value === null) return null
    const { channelId, label, url, nonce } = value as Partial<CastRequest>
    if (
      typeof channelId !== "string" ||
      typeof label !== "string" ||
      typeof url !== "string" ||
      typeof nonce !== "number"
    ) {
      return null
    }
    return { channelId, label, url, nonce }
  } catch {
    return null
  }
}
