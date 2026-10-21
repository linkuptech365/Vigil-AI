"use client"

import type { VideoItem } from "@/lib/vigil/types"
import { VideoFeedCard } from "./video-feed-card"

export function VideoGrid({ videos }: { videos: VideoItem[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {videos.map((video) => (
        <VideoFeedCard key={video.id} video={video} />
      ))}
    </div>
  )
}
