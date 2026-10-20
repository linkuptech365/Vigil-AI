"use client"

import * as React from "react"

import type { GmpDeviationRecord } from "@/lib/ops/audit-types"
import { CAMERAS } from "@/lib/ops/data"
import { formatClock, isChannelId, resolveScenario } from "@/lib/ops/video-scenarios"
import { cn } from "@/lib/utils"

const FRAME_COUNT = 8
const FRAME_W = 192
const FRAME_H = 108

const frameCache = new Map<string, string[]>()

const LEVEL_RING = {
  normal: "ring-success/60",
  warn: "ring-warning/70",
  critical: "ring-destructive/80",
} as const

function useFilmstrip(videoSrc: string | undefined, times: number[], cacheKey: string) {
  const [frames, setFrames] = React.useState<string[] | null>(() => frameCache.get(cacheKey) ?? null)
  const timesKey = times.join(",")

  React.useEffect(() => {
    const cached = frameCache.get(cacheKey)
    if (cached) {
      setFrames(cached)
      return
    }
    if (!videoSrc) {
      setFrames([])
      return
    }

    let cancelled = false
    const video = document.createElement("video")
    video.muted = true
    video.preload = "auto"
    video.playsInline = true
    const canvas = document.createElement("canvas")
    canvas.width = FRAME_W
    canvas.height = FRAME_H
    const ctx = canvas.getContext("2d")

    const seekTo = (t: number) =>
      new Promise<void>((resolve, reject) => {
        if (Math.abs(video.currentTime - t) < 0.01) {
          resolve()
          return
        }
        const timer = window.setTimeout(() => reject(new Error("seek timeout")), 4000)
        video.onseeked = () => {
          window.clearTimeout(timer)
          resolve()
        }
        video.currentTime = t
      })

    const run = async () => {
      try {
        await new Promise<void>((resolve, reject) => {
          video.onloadeddata = () => resolve()
          video.onerror = () => reject(new Error("video load failed"))
          video.src = videoSrc
        })
        if (!ctx) throw new Error("canvas unavailable")
        const out: string[] = []
        for (const t of timesKey.split(",").map(Number)) {
          if (cancelled) return
          await seekTo(t)
          ctx.drawImage(video, 0, 0, FRAME_W, FRAME_H)
          out.push(canvas.toDataURL("image/jpeg", 0.6))
        }
        frameCache.set(cacheKey, out)
        if (!cancelled) setFrames(out)
      } catch {
        if (!cancelled) setFrames([])
      }
    }
    void run()

    return () => {
      cancelled = true
      video.onloadeddata = null
      video.onerror = null
      video.onseeked = null
      video.removeAttribute("src")
      video.load()
    }
  }, [cacheKey, videoSrc, timesKey])

  return frames
}

export function EvidenceMedia({ record, className }: { record: GmpDeviationRecord; className?: string }) {
  const camera = CAMERAS.find((c) => c.id === record.channelId)
  const channelId = isChannelId(record.channelId) ? record.channelId : null
  const videoRef = React.useRef<HTMLVideoElement>(null)
  const [activeIndex, setActiveIndex] = React.useState<number | null>(null)

  const { clipStartSec: start, clipEndSec: end } = record
  const times = React.useMemo(
    () =>
      Array.from({ length: FRAME_COUNT }, (_, i) => {
        const t = start + ((end - start) * i) / (FRAME_COUNT - 1)
        return Math.round(t * 10) / 10
      }),
    [start, end]
  )
  const frames = useFilmstrip(camera?.video, times, `${record.channelId}:${start}:${end}`)

  const seekFrame = (index: number) => {
    const video = videoRef.current
    setActiveIndex(index)
    if (!video) return
    video.currentTime = times[index]
    video.play().catch(() => {})
  }

  const handleLoadedMetadata = () => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = start
    video.play().catch(() => {})
  }

  const handleTimeUpdate = () => {
    const video = videoRef.current
    if (video && video.currentTime >= end) video.currentTime = start
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative overflow-hidden rounded-lg border border-border bg-black">
        {camera ? (
          <video
            ref={videoRef}
            src={camera.video}
            poster={camera.poster}
            muted
            playsInline
            controls
            controlsList="nodownload noplaybackrate"
            aria-label={`${record.channelId} 事件片段 ${formatClock(start)} 至 ${formatClock(end)}`}
            className="aspect-video w-full bg-black object-cover"
            onLoadedMetadata={handleLoadedMetadata}
            onTimeUpdate={handleTimeUpdate}
          />
        ) : (
          <div className="flex aspect-video items-center justify-center text-sm text-muted-foreground">
            未找到机位 {record.channelId} 的视频
          </div>
        )}
        <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-2 rounded-md bg-black/70 px-2 py-1 font-mono text-[11px] text-white">
          <span>{record.channelId}</span>
          <span aria-hidden="true">|</span>
          <span>
            {formatClock(start)} - {formatClock(end)}
          </span>
        </div>
      </div>

      <ol className="grid grid-cols-4 gap-1.5 sm:grid-cols-8" aria-label="事件关键帧">
        {times.map((t, index) => {
          const level = channelId ? resolveScenario(channelId, t).level : "normal"
          const image = frames && frames.length > 0 ? frames[index] : camera?.poster
          return (
            <li key={`${t}-${index}`}>
              <button
                type="button"
                onClick={() => seekFrame(index)}
                aria-label={`跳转到 ${formatClock(t)}`}
                aria-pressed={activeIndex === index}
                className={cn(
                  "group relative block w-full overflow-hidden rounded-md bg-secondary ring-1 transition focus-visible:outline-none focus-visible:ring-2",
                  LEVEL_RING[level],
                  activeIndex === index && "ring-2 ring-signal"
                )}
              >
                {image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={image} alt="" className="aspect-video w-full object-cover" />
                ) : (
                  <span className="block aspect-video w-full animate-pulse bg-secondary" />
                )}
                <span className="absolute inset-x-0 bottom-0 bg-black/70 py-0.5 text-center font-mono text-[10px] text-white">
                  {formatClock(t)}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
