"use client"

import * as React from "react"
import { Maximize2, Pause, Play, RotateCw, ScanEye, Siren, VideoOff } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { hasMediaSrc, PLACEHOLDER_IMAGE, safePlay, suppressMediaError } from "@/lib/ops/media"
import { buildTimeMarkers, deriveOverlayBoxes } from "@/lib/vigil/library-overlay"
import { formatDuration } from "@/lib/vigil/data"
import { RULES } from "@/lib/vigil/rules"
import type { VideoItem, VideoStatus } from "@/lib/vigil/types"
import { cameraTag, getVideoSrc } from "@/lib/vigil/video-source"
import { cn } from "@/lib/utils"
import { useVigil } from "@/components/vigil/vigil-provider"
import { useOps } from "../ops-provider"
import { OverlayBoxes } from "../overlay-boxes"

const STATUS_DOT: Record<VideoStatus, string> = {
  pending: "bg-muted-foreground",
  analyzing: "bg-warning animate-pulse",
  safe: "bg-success",
  alert: "bg-destructive animate-pulse",
}

const STATUS_TEXT: Record<VideoStatus, string> = {
  pending: "待分析",
  analyzing: "推理中",
  safe: "正常安全",
  alert: "触发预警",
}

export function LibraryCard({ video }: { video: VideoItem }) {
  const { analyzeOne, setSelectedId, batchRunning } = useVigil()
  const { showOverlays, videoTarget } = useOps()

  const cardRef = React.useRef<HTMLElement>(null)
  const frameRef = React.useRef<HTMLDivElement>(null)
  const videoRef = React.useRef<HTMLVideoElement>(null)

  const src = getVideoSrc(video)
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null)
  const [visible, setVisible] = React.useState(false)
  const [userPaused, setUserPaused] = React.useState(false)
  const [playing, setPlaying] = React.useState(false)
  const [time, setTime] = React.useState(0)
  const [mediaDuration, setMediaDuration] = React.useState(0)
  const [flashNonce, setFlashNonce] = React.useState(0)
  const handledNonce = React.useRef(0)

  const playable = hasMediaSrc(src) && failedSrc !== src
  const duration = mediaDuration > 0 ? mediaDuration : video.durationSec
  const analyzing = video.status === "analyzing"
  const alerting = video.status === "alert" && video.ruleId !== undefined
  const boxes = React.useMemo(() => deriveOverlayBoxes(video), [video])
  const markers = React.useMemo(() => buildTimeMarkers(video), [video])

  React.useEffect(() => {
    const node = frameRef.current
    if (!node) return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      threshold: 0.15,
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  React.useEffect(() => {
    const el = videoRef.current
    if (!el || !playable) return
    if (visible && !userPaused) safePlay(el)
    else el.pause()
  }, [visible, userPaused, playable])

  const seek = React.useCallback((seconds: number) => {
    const el = videoRef.current
    if (!el) return
    el.currentTime = seconds
    setTime(seconds)
  }, [])

  React.useEffect(() => {
    if (!videoTarget || videoTarget.videoId !== video.id) return
    if (handledNonce.current === videoTarget.nonce) return
    handledNonce.current = videoTarget.nonce
    cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
    if (videoTarget.timestampSec !== undefined) seek(videoTarget.timestampSec)
    setFlashNonce(videoTarget.nonce)
  }, [videoTarget, video.id, seek])

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

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    else void frameRef.current?.requestFullscreen?.().catch(() => {})
  }

  const done = video.status === "safe" || video.status === "alert"

  return (
    <article
      ref={cardRef}
      aria-label={`${cameraTag(video.name)} ${video.name}`}
      className={cn(
        "group/lib relative flex flex-col overflow-hidden rounded-lg border bg-card",
        alerting ? "border-destructive/70" : video.status === "safe" ? "border-success/40" : "border-border"
      )}
    >
      <div ref={frameRef} className="relative aspect-video overflow-hidden bg-black">
        {playable ? (
          <video
            ref={videoRef}
            src={visible ? (src ?? undefined) : undefined}
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
              if (Number.isFinite(event.currentTarget.duration)) {
                setMediaDuration(event.currentTarget.duration)
              }
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
              <VideoOff className="size-5" aria-hidden="true" />
              <span className="text-xs">
                {hasMediaSrc(src) ? "视频无法解码播放" : "无可播放画面（仅元数据）"}
              </span>
            </div>
          </>
        )}

        <div className="cctv-scanlines pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/55 via-transparent to-black/60" />

        {showOverlays && boxes.length > 0 && <OverlayBoxes boxes={boxes} labelSize="xs" />}

        <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-2">
          <span className="rounded bg-black/70 px-1.5 py-0.5 font-mono text-xs font-semibold text-signal">
            {cameraTag(video.name)}
          </span>
          <span className="flex items-center gap-1.5 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-medium text-white">
            <span className={cn("size-1.5 rounded-full", STATUS_DOT[video.status])} />
            {STATUS_TEXT[video.status]}
            {video.confidence !== undefined && done && ` ${Math.round(video.confidence * 100)}%`}
          </span>
        </div>

        {alerting && video.ruleId && (
          <div
            className="absolute bottom-10 left-2 z-20 flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded bg-destructive px-2 py-0.5 text-[11px] font-semibold text-destructive-foreground"
            role="status"
          >
            <Siren className="size-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{RULES[video.ruleId]?.scenarioLabel ?? "异常预警"}</span>
          </div>
        )}

        {analyzing && (
          <div
            className="absolute inset-0 z-20 flex items-center justify-center gap-2 bg-black/55"
            role="status"
          >
            <Spinner className="text-signal" />
            <span className="font-mono text-xs text-white">VLM 推理中...</span>
          </div>
        )}

        {flashNonce > 0 && (
          <span
            key={flashNonce}
            className="pointer-events-none absolute inset-0 z-30"
            style={{ animation: "tile-flash 1.4s ease-out forwards" }}
            aria-hidden="true"
          />
        )}

        {playable && (
          <div className="absolute inset-x-0 bottom-0 z-20 flex items-center gap-2 bg-gradient-to-t from-black/85 to-transparent px-2 pb-1.5 pt-5">
            <Button
              type="button"
              size="icon-xs"
              variant="secondary"
              aria-label={playing ? "暂停" : "播放"}
              className="bg-black/60 text-white hover:bg-black/80"
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
              className="h-1 min-w-0 flex-1 cursor-pointer accent-signal"
            />
            <span className="font-mono text-[10px] text-white">
              {formatDuration(time)} / {formatDuration(duration)}
            </span>
            <Button
              type="button"
              size="icon-xs"
              variant="secondary"
              aria-label="全屏放大"
              className="bg-black/60 text-white hover:bg-black/80"
              onClick={toggleFullscreen}
            >
              <Maximize2 />
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 p-2.5">
        <p className="truncate font-mono text-xs font-medium" title={video.path}>
          {video.name}
        </p>

        {markers.length > 0 && (
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="时间戳定位">
            {markers.map((marker) => (
              <button
                key={`${marker.tone}-${marker.sec}`}
                type="button"
                disabled={!playable}
                onClick={() => {
                  setUserPaused(false)
                  seek(marker.sec)
                  safePlay(videoRef.current)
                }}
                className={cn(
                  "rounded border px-1.5 py-0.5 font-mono text-[10px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                  marker.tone === "alert"
                    ? "border-destructive/60 bg-destructive/10 text-destructive hover:bg-destructive/20"
                    : "border-border text-muted-foreground hover:border-signal/60 hover:text-foreground"
                )}
              >
                {marker.label} · {formatDuration(marker.sec)}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-1.5">
          <Button
            variant="secondary"
            size="xs"
            disabled={analyzing || batchRunning}
            onClick={() => void analyzeOne(video)}
          >
            {analyzing ? (
              <Spinner data-icon="inline-start" />
            ) : done ? (
              <RotateCw data-icon="inline-start" />
            ) : (
              <Play data-icon="inline-start" />
            )}
            {analyzing ? "分析中" : done ? "重新分析" : "开始分析"}
          </Button>
          <Button
            variant="outline"
            size="xs"
            disabled={!done}
            onClick={() => setSelectedId(video.id)}
          >
            <ScanEye data-icon="inline-start" />
            研判详情
          </Button>
        </div>
      </div>
    </article>
  )
}
