"use client"

import * as React from "react"
import { Radio, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { LiveFeed } from "@/lib/ops/ingestion-types"
import { PROTOCOL_META } from "@/lib/ops/live-stream"
import { cn } from "@/lib/utils"
import { useLiveStream } from "./ingestion/use-live-stream"

interface LiveFeedPlayerProps {
  feed: LiveFeed
  poster?: string
  onExit: () => void
}

export function LiveFeedPlayer({ feed, poster, onExit }: LiveFeedPlayerProps) {
  const { videoRef, phase, message, connect } = useLiveStream({
    fallbackSrc: feed.fallbackSrc,
    collectQos: false,
  })

  React.useEffect(() => {
    void connect({ protocol: feed.protocol, url: feed.url })
  }, [connect, feed.protocol, feed.url, feed.pushedAt])

  const fallback = phase === "fallback"

  return (
    <>
      <video
        ref={videoRef}
        poster={poster}
        muted
        loop
        playsInline
        aria-label={`${feed.channelId} 推送实时流`}
        className="absolute inset-0 size-full object-cover"
      />
      <div className="absolute inset-x-0 top-12 z-10 mx-auto flex w-fit max-w-[92%] items-center gap-2 rounded-full border border-signal/50 bg-black/75 py-1 pl-3 pr-1 text-xs text-white backdrop-blur">
        <Radio className={cn("size-3.5", fallback ? "text-warning" : "text-success")} aria-hidden="true" />
        <span className="truncate" title={message}>
          {phase === "connecting" ? "连接中" : fallback ? "回退回环" : "LIVE"} ·{" "}
          {PROTOCOL_META[feed.protocol].short} · {feed.label}
        </span>
        <Button
          type="button"
          size="xs"
          variant="secondary"
          className="rounded-full"
          onClick={(event) => {
            event.stopPropagation()
            onExit()
          }}
        >
          <X data-icon="inline-start" />
          返回回放
        </Button>
      </div>
    </>
  )
}
