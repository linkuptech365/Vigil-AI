"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  Cast,
  CircleCheck,
  Cog,
  Film,
  Maximize2,
  Pause,
  Play,
  RotateCw,
  ScanEye,
  Siren,
  Trash2,
  VideoOff,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { CAMERAS } from "@/lib/ops/data"
import { hasMediaSrc, PLACEHOLDER_IMAGE, safePlay, suppressMediaError } from "@/lib/ops/media"
import { formatDuration, formatSize } from "@/lib/vigil/data"
import type { VideoItem, VideoStatus } from "@/lib/vigil/types"
import {
  cameraTag,
  formatResolutionLabel,
  getVideoSrc,
  writeCastRequest,
} from "@/lib/vigil/video-source"
import { useVigil } from "../vigil-provider"

const STATUS_CHIP: Record<VideoStatus, string> = {
  pending: "border-border bg-black/70 text-muted-foreground",
  analyzing: "border-warning/50 bg-warning/20 text-warning",
  safe: "border-success/50 bg-success/20 text-success",
  alert: "border-destructive/60 bg-destructive/25 text-destructive-foreground",
}

const STATUS_DOT: Record<VideoStatus, string> = {
  pending: "bg-muted-foreground",
  analyzing: "bg-warning animate-pulse",
  safe: "bg-success",
  alert: "bg-destructive animate-pulse",
}

function statusText(video: VideoItem) {
  switch (video.status) {
    case "pending":
      return "待分析"
    case "analyzing":
      return "推理中"
    case "safe":
      return video.confidence !== undefined
        ? `正常安全 ${Math.round(video.confidence * 100)}%`
        : "正常安全"
    case "alert":
      return "触发预警"
  }
}

function useOnScreen(ref: React.RefObject<HTMLElement | null>) {
  const [visible, setVisible] = React.useState(false)
  React.useEffect(() => {
    const node = ref.current
    if (!node) return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      threshold: 0.15,
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [ref])
  return visible
}

export function VideoFeedCard({ video }: { video: VideoItem }) {
  const router = useRouter()
  const { analyzeOne, removeVideo, setSelectedId, openFrameTest, batchRunning } = useVigil()

  const frameRef = React.useRef<HTMLDivElement>(null)
  const videoRef = React.useRef<HTMLVideoElement>(null)
  const onScreen = useOnScreen(frameRef)

  const src = getVideoSrc(video)
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null)
  const [userPaused, setUserPaused] = React.useState(false)
  const [playing, setPlaying] = React.useState(false)
  const [time, setTime] = React.useState(0)
  const [mediaDuration, setMediaDuration] = React.useState(0)
  const [dimensions, setDimensions] = React.useState<{ w: number; h: number } | null>(null)

  const playable = hasMediaSrc(src) && failedSrc !== src
  const analyzing = video.status === "analyzing"
  const done = video.status === "safe" || video.status === "alert"
  const alerting = video.status === "alert" && video.ruleId !== undefined

  React.useEffect(() => {
    const el = videoRef.current
    if (!el || !playable) return
    if (onScreen && !userPaused) safePlay(el)
    else el.pause()
  }, [onScreen, userPaused, playable])

  const togglePlay = () => {
    const el = videoRef.current
    if (!el) return
    if (el.paused) {
      setUserPaused(false)
      safePlay(el)
    } else {
      setUserPaused(true)
      el.pause()
    }
  }

  const seek = (seconds: number) => {
    const el = videoRef.current
    if (!el) return
    el.currentTime = seconds
    setTime(seconds)
  }

  const toggleFullscreen = () => {
    const frame = frameRef.current
    if (!frame) return
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {})
    } else {
      void frame.requestFullscreen?.().catch(() => {})
    }
  }

  const castTo = (channelId: string) => {
    if (!hasMediaSrc(src)) return
    const camera = CAMERAS.find((c) => c.id === channelId)
    writeCastRequest({
      channelId,
      label: video.name,
      url: new URL(src, window.location.origin).toString(),
    })
    toast.success(`已投屏到 ${channelId}`, {
      description: camera ? `${camera.name} · ${video.name}` : video.name,
      action: { label: "前往大屏", onClick: () => router.push("/") },
    })
  }

  const resolutionLabel = formatResolutionLabel(
    video.resolution,
    dimensions?.w,
    dimensions?.h
  )
  const duration = mediaDuration > 0 ? mediaDuration : video.durationSec
  const metaLine = [resolutionLabel, `${video.fps} FPS`].filter(Boolean).join(" | ")

  return (
    <article
      aria-label={`${cameraTag(video.name)} ${video.name}`}
      className={cn(
        "group/feed relative flex flex-col overflow-hidden rounded-lg border bg-card transition-shadow",
        alerting
          ? "border-destructive/80 shadow-[0_0_24px_-6px] shadow-destructive/50 ring-1 ring-destructive/50"
          : video.status === "safe"
            ? "border-success/40"
            : "border-border"
      )}
    >
      {alerting && (
        <span
          className="pointer-events-none absolute inset-0 z-30 animate-pulse rounded-lg border-2 border-destructive/70"
          aria-hidden="true"
        />
      )}

      <div ref={frameRef} className="relative aspect-video overflow-hidden bg-black">
        {playable ? (
          <video
            ref={videoRef}
            src={src ?? undefined}
            muted
            loop
            playsInline
            preload="metadata"
            aria-label={`${video.name} 监控画面`}
            className="absolute inset-0 size-full object-cover"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
            onLoadedMetadata={(event) => {
              const el = event.currentTarget
              if (Number.isFinite(el.duration)) setMediaDuration(el.duration)
              if (el.videoWidth > 0) setDimensions({ w: el.videoWidth, h: el.videoHeight })
            }}
            onError={(event) => {
              suppressMediaError(event)
              setFailedSrc(src)
              setPlaying(false)
            }}
          />
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={PLACEHOLDER_IMAGE}
              alt=""
              className="absolute inset-0 size-full object-cover"
              draggable={false}
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-muted-foreground">
              <VideoOff className="size-6" aria-hidden="true" />
              <span className="text-xs">
                {hasMediaSrc(src) ? "视频无法解码播放" : "无可播放画面（仅元数据）"}
              </span>
            </div>
          </>
        )}

        <div className="cctv-scanlines pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/65" />

        <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-2.5">
          <div className="flex min-w-0 flex-col items-start gap-1">
            <span className="rounded bg-black/70 px-1.5 py-0.5 font-mono text-xs font-semibold text-signal">
              {cameraTag(video.name)}
            </span>
            <span
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium backdrop-blur",
                STATUS_CHIP[video.status]
              )}
            >
              <span className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[video.status])} />
              {statusText(video)}
            </span>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1 font-mono text-[10px] text-white">
            <span className="rounded bg-black/70 px-1.5 py-0.5">
              {formatDuration(duration)} · {formatSize(video.sizeMB)}
            </span>
            <span className="rounded bg-black/70 px-1.5 py-0.5">{metaLine}</span>
          </div>
        </div>

        {analyzing && (
          <div
            className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/55 backdrop-blur-[1px]"
            role="status"
          >
            <Cog className="size-9 animate-spin text-signal [animation-duration:2.4s]" aria-hidden="true" />
            <span className="rounded bg-black/70 px-2 py-0.5 font-mono text-xs text-white">
              VLM 推理中...
            </span>
          </div>
        )}

        {alerting && video.ruleId && (
          <div
            className="absolute inset-x-2 bottom-12 z-20 mx-auto flex w-fit max-w-full items-center gap-1.5 rounded bg-destructive px-2.5 py-1 text-xs font-semibold text-destructive-foreground shadow-lg"
            role="status"
          >
            <Siren className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">
              {video.ruleName ?? video.ruleId}
              {video.confidence !== undefined && ` ${Math.round(video.confidence * 100)}%`}
            </span>
          </div>
        )}

        {video.status === "safe" && (
          <span
            className="absolute bottom-12 left-2.5 z-20 flex items-center gap-1 rounded bg-success/20 px-1.5 py-0.5 text-[10px] font-medium text-success backdrop-blur"
            title={video.suppressedReason}
          >
            <CircleCheck className="size-3" aria-hidden="true" />
            {video.suppressedReason ? "已抑制" : "合规"}
          </span>
        )}

        {playable && (
          <div className="absolute inset-x-0 bottom-0 z-20 flex items-center gap-2 bg-gradient-to-t from-black/80 to-transparent px-2.5 pb-2 pt-6 opacity-0 transition-opacity focus-within:opacity-100 group-hover/feed:opacity-100 max-lg:opacity-100">
            <Button
              type="button"
              size="icon-sm"
              variant="secondary"
              aria-label={playing ? "暂停" : "播放"}
              className="bg-black/60 text-white backdrop-blur hover:bg-black/80"
              onClick={togglePlay}
            >
              {playing ? <Pause /> : <Play />}
            </Button>
            <input
              type="range"
              min={0}
              max={duration > 0 ? duration : 1}
              step={0.1}
              value={Math.min(time, duration > 0 ? duration : 1)}
              onChange={(event) => seek(Number(event.target.value))}
              aria-label={`${video.name} 播放进度`}
              aria-valuetext={formatDuration(time)}
              className="h-1.5 min-w-0 flex-1 cursor-pointer accent-signal"
            />
            <span className="font-mono text-[10px] text-white">{formatDuration(time)}</span>
            <Button
              type="button"
              size="icon-sm"
              variant="secondary"
              aria-label="全屏放大"
              className="bg-black/60 text-white backdrop-blur hover:bg-black/80"
              onClick={toggleFullscreen}
            >
              <Maximize2 />
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 p-2.5">
        <div className="min-w-0">
          <p className="truncate font-mono text-sm font-medium" title={video.name}>
            {video.name}
          </p>
          <p className="truncate font-mono text-xs text-muted-foreground" title={video.path}>
            {video.path}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {done ? (
            <>
              <Button
                variant="secondary"
                size="sm"
                disabled={batchRunning}
                onClick={() => void analyzeOne(video)}
              >
                <RotateCw data-icon="inline-start" />
                重新分析
              </Button>
              <Button variant="outline" size="sm" onClick={() => setSelectedId(video.id)}>
                <ScanEye data-icon="inline-start" />
                研判详情
              </Button>
            </>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              disabled={analyzing || batchRunning}
              onClick={() => void analyzeOne(video)}
            >
              {analyzing ? <Spinner data-icon="inline-start" /> : <Play data-icon="inline-start" />}
              {analyzing ? "分析中" : "开始分析"}
            </Button>
          )}

          <div className="ml-auto flex items-center gap-1">
            {video.source === "disk" && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`抽取关键帧 ${video.name}`}
                title="抽取关键帧"
                disabled={analyzing}
                onClick={() => openFrameTest(video)}
              >
                <Film />
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`投屏到监控大屏 ${video.name}`}
                  title={hasMediaSrc(src) ? "投屏到监控大屏" : "该视频没有可播放来源，无法投屏"}
                  disabled={!hasMediaSrc(src)}
                >
                  <Cast />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel>投屏到监控大屏通道</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {CAMERAS.map((camera) => (
                  <DropdownMenuItem key={camera.id} onSelect={() => castTo(camera.id)}>
                    <span className="font-mono text-xs font-semibold text-signal">{camera.code}</span>
                    <span className="truncate">{camera.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`移除 ${video.name}`}
              title="移出队列"
              disabled={analyzing}
              onClick={() => removeVideo(video.id)}
            >
              <Trash2 />
            </Button>
          </div>
        </div>
      </div>
    </article>
  )
}
