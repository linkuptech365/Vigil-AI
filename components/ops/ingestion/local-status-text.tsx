import type { VideoItem } from "@/lib/vigil/types"

export function VideoStatusBadgeText({ video }: { video: VideoItem }) {
  if (video.status === "analyzing") {
    const p = video.chunkProgress
    return <>{p ? `${p.index}/${p.total}` : "分析中"}</>
  }
  if (video.chunks?.length) return <>{video.chunks.length} 切片</>
  return <>待分析</>
}
