import type { ChunkStatus, VideoItem } from "@/lib/vigil/types"

export const LOCAL_PREFIX = "local:"

export const localChannelId = (videoId: string) => `${LOCAL_PREFIX}${videoId}`
export const isLocalChannelId = (id: string) => id.startsWith(LOCAL_PREFIX)
export const parseLocalChannelId = (id: string) => id.slice(LOCAL_PREFIX.length)
export const localLabel = (video: Pick<VideoItem, "name">) => `[本地] ${video.name}`

export const CHUNK_STATUS_LABEL: Record<ChunkStatus, string> = {
  pending: "待分析",
  analyzing: "分析中",
  alert: "违规",
  safe: "合规",
  failed: "失败",
}

export const CHUNK_STATUS_CLASS: Record<ChunkStatus, string> = {
  pending: "border-border bg-muted text-muted-foreground",
  analyzing: "border-primary/40 bg-primary/10 text-primary",
  alert: "border-destructive/40 bg-destructive/10 text-destructive",
  safe: "border-success/40 bg-success/10 text-success",
  failed: "border-warning/40 bg-warning/10 text-warning",
}

export function formatDuration(totalSeconds: number) {
  const safe = Math.max(0, Math.round(totalSeconds))
  const m = Math.floor(safe / 60)
  const s = safe % 60
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}
