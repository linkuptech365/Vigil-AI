"use client"

import * as React from "react"
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Camera as CameraIcon,
  History,
  Maximize2,
  Move,
  Pause,
  Play,
  Radio,
  Volume2,
  VolumeX,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { Camera } from "@/lib/ops/types"
import {
  CLIP_DURATION,
  formatClock,
  type PhaseLevel,
  phaseBoxes,
  resolveScenario,
  rippleOrigin,
  SCENARIOS,
} from "@/lib/ops/video-scenarios"
import { useOps } from "./ops-provider"
import { OverlayBoxes } from "./overlay-boxes"
import { useCameraPlayback } from "./use-camera-playback"

const LEVEL_STYLE: Record<PhaseLevel, string> = {
  normal: "border-success/40 bg-success/15 text-success",
  warn: "border-warning/50 bg-warning/20 text-warning",
  critical: "border-destructive/50 bg-destructive/20 text-destructive",
}

const LEVEL_DOT: Record<PhaseLevel, string> = {
  normal: "bg-success",
  warn: "bg-warning",
  critical: "bg-destructive",
}

const LEVEL_MARK: Record<PhaseLevel, string> = {
  normal: "bg-success/70",
  warn: "bg-warning",
  critical: "bg-destructive",
}

interface CameraTileProps {
  camera: Camera
  size: "lg" | "sm"
  className?: string
}

function useLiveBitrate(base: number) {
  const [bitrate, setBitrate] = React.useState(base)
  React.useEffect(() => {
    const id = window.setInterval(() => {
      setBitrate(Number((base + (Math.random() - 0.5) * 0.9).toFixed(1)))
    }, 1800)
    return () => window.clearInterval(id)
  }, [base])
  return bitrate
}

function useOnScreen(ref: React.RefObject<HTMLElement | null>) {
  const [visible, setVisible] = React.useState(true)
  React.useEffect(() => {
    const node = ref.current
    if (!node) return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      threshold: 0.05,
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [ref])
  return visible
}

function IconAction({
  label,
  onClick,
  pressed,
  children,
}: {
  label: string
  onClick: () => void
  pressed?: boolean
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="secondary"
          aria-label={label}
          aria-pressed={pressed}
          className={cn(
            "bg-black/60 text-white backdrop-blur hover:bg-black/80",
            pressed && "bg-signal text-black hover:bg-signal/90"
          )}
          onClick={(event) => {
            event.stopPropagation()
            onClick()
          }}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}

function Scrubber({
  camera,
  time,
  onSeek,
}: {
  camera: Camera
  time: number
  onSeek: (seconds: number) => void
}) {
  return (
    <div className="relative flex h-4 items-center" onClick={(event) => event.stopPropagation()}>
      <div className="pointer-events-none absolute inset-x-0 h-1.5 overflow-hidden rounded-full bg-white/20">
        {SCENARIOS[camera.id].map((phase) => (
          <span
            key={`${phase.from}-${phase.level}`}
            className={cn("absolute inset-y-0", LEVEL_MARK[phase.level])}
            style={{
              left: `${(phase.from / CLIP_DURATION) * 100}%`,
              width: `${((phase.to - phase.from) / CLIP_DURATION) * 100}%`,
              opacity: phase.level === "normal" ? 0.35 : 0.95,
            }}
          />
        ))}
      </div>
      <div
        className="pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-black bg-white"
        style={{ left: `${(time / CLIP_DURATION) * 100}%` }}
      />
      <input
        type="range"
        min={0}
        max={CLIP_DURATION}
        step={0.1}
        value={time}
        onChange={(event) => onSeek(Number(event.target.value))}
        aria-label={`${camera.code} 播放进度`}
        aria-valuetext={formatClock(time)}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
      />
    </div>
  )
}

export function CameraTile({ camera, size, className }: CameraTileProps) {
  const { focusId, layout, focusCamera, replay, stopReplay, seekTarget, showOverlays } = useOps()
  const bitrate = useLiveBitrate(camera.bitrate)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const onScreen = useOnScreen(rootRef)
  const [ptz, setPtz] = React.useState(false)
  const [flashKey, setFlashKey] = React.useState(0)
  const [ripple, setRipple] = React.useState<{ key: number; x: number; y: number } | null>(null)

  const playback = useCameraPlayback({
    cameraId: camera.id,
    duration: CLIP_DURATION,
    suspended: !onScreen,
  })
  const { time, seek } = playback

  const isLarge = size === "lg"
  const activeReplay = replay && replay.cameraId === camera.id && layout === "single" ? replay : null
  const isFocused = focusId === camera.id

  const phase = resolveScenario(camera.id, time)
  const boxes = phaseBoxes(phase, time)
  const showControls = isLarge || layout !== "grid" || playback.status === "fallback"

  const handledNonce = React.useRef(0)
  React.useEffect(() => {
    if (!seekTarget || seekTarget.channelId !== camera.id) return
    if (handledNonce.current === seekTarget.nonce) return
    handledNonce.current = seekTarget.nonce
    seek(seekTarget.timestampSec)
    setFlashKey(seekTarget.nonce)
  }, [seekTarget, camera.id, seek])

  const lastLevel = React.useRef<PhaseLevel>(phase.level)
  React.useEffect(() => {
    if (lastLevel.current === "normal" && phase.level !== "normal") {
      const origin = rippleOrigin(camera.id, time)
      setRipple({ key: Date.now(), ...origin })
    }
    lastLevel.current = phase.level
  }, [phase.level, camera.id, time])

  React.useEffect(() => {
    if (!ripple) return
    const id = window.setTimeout(() => setRipple(null), 1700)
    return () => window.clearTimeout(id)
  }, [ripple])

  const select = () => {
    if (layout === "focus" && !isFocused) focusCamera(camera.id)
  }

  const snapshot = () => {
    toast.success(`${camera.code} 抓拍已保存`, {
      description: `${camera.name} · 画面 ${formatClock(time)} · ${new Date().toLocaleTimeString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" })}`,
    })
  }

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label={`${camera.code} ${camera.name}`}
      tabIndex={0}
      onClick={select}
      onKeyDown={(event) => {
        if (event.key === "Enter") select()
      }}
      className={cn(
        "group/tile relative isolate overflow-hidden rounded-lg border bg-black outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring",
        phase.level === "critical" ? "border-destructive/60" : "border-border",
        layout === "focus" && !isFocused && "cursor-pointer hover:border-signal/60",
        className
      )}
    >
      {playback.status === "fallback" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={camera.image || "/placeholder.svg"}
          alt={`${camera.code} ${camera.name} 静态画面`}
          className="absolute inset-0 size-full object-cover"
          draggable={false}
        />
      ) : (
        <video
          ref={playback.videoRef}
          src={camera.video}
          poster={camera.poster}
          muted
          loop
          playsInline
          preload="auto"
          aria-label={`${camera.code} ${camera.name} 实时画面`}
          onLoadedData={playback.onLoadedData}
          onError={playback.onError}
          className="absolute inset-0 size-full object-cover"
        />
      )}
      {camera.maskTimestamp && (
        <div className="absolute left-0 top-0 h-[9%] w-[27%] bg-black/80 backdrop-blur-md" />
      )}
      <div className="cctv-scanlines pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/55 via-transparent to-black/60" />

      {showOverlays && (
        <OverlayBoxes boxes={boxes} showAllLabels={isLarge} labelSize={isLarge ? "sm" : "xs"} />
      )}

      {flashKey > 0 && (
        <div
          key={flashKey}
          className="pointer-events-none absolute inset-0 z-10 rounded-lg"
          style={{ animation: "tile-flash 1.4s ease-out forwards" }}
          aria-hidden="true"
        />
      )}

      {ripple && (
        <span
          key={ripple.key}
          className="pointer-events-none absolute z-10 size-24 rounded-full border-2 border-destructive"
          style={{
            left: `${ripple.x}%`,
            top: `${ripple.y}%`,
            animation: "ripple-ring 1.6s ease-out forwards",
          }}
          aria-hidden="true"
        />
      )}

      {phase.banner && phase.level !== "normal" && showOverlays && (
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 top-12 z-10 mx-auto w-fit max-w-[88%] truncate rounded px-2 py-0.5 text-center font-mono text-[10px] font-semibold",
            phase.level === "critical" ? "bg-destructive text-white" : "bg-warning text-black"
          )}
          role="status"
        >
          {phase.banner}
        </div>
      )}

      <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2.5">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="w-fit rounded bg-black/70 px-1.5 py-0.5 font-mono text-xs font-semibold text-signal">
            {camera.code}
          </span>
          {isLarge && (
            <span className="truncate text-xs font-medium text-white drop-shadow">
              {camera.name}
            </span>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 font-mono text-[10px] text-white">
          <span className="flex items-center gap-1.5 rounded bg-black/70 px-1.5 py-0.5">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-destructive" />
            </span>
            {activeReplay ? "REPLAY" : "REC"} {formatClock(time)}
          </span>
          <span className="rounded bg-black/70 px-1.5 py-0.5">
            {camera.resolution} | {camera.fps} FPS | {bitrate} Mbps
          </span>
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1.5 p-2.5">
        {showControls && <Scrubber camera={camera} time={time} onSeek={seek} />}
        <div className="flex items-end justify-between gap-2">
          <span
            className={cn(
              "flex max-w-[60%] items-center gap-1.5 truncate rounded-full border px-2 py-0.5 text-[11px] font-medium backdrop-blur",
              LEVEL_STYLE[phase.level]
            )}
          >
            <span className={cn("size-1.5 shrink-0 rounded-full", LEVEL_DOT[phase.level])} />
            <span className="truncate">{phase.status}</span>
          </span>

          <div className="flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/tile:opacity-100 max-lg:opacity-100">
            <IconAction
              label={playback.playing ? "暂停" : "播放"}
              onClick={playback.toggle}
            >
              {playback.playing ? <Pause /> : <Play />}
            </IconAction>
            {isLarge && playback.status === "ready" && (
              <IconAction
                label={playback.muted ? "取消静音" : "静音"}
                onClick={playback.toggleMute}
              >
                {playback.muted ? <VolumeX /> : <Volume2 />}
              </IconAction>
            )}
            <IconAction label="抓拍快照" onClick={snapshot}>
              <CameraIcon />
            </IconAction>
            <IconAction label="云台控制" pressed={ptz} onClick={() => setPtz((v) => !v)}>
              <Move />
            </IconAction>
            {layout !== "single" && (
              <IconAction label="全屏放大" onClick={() => focusCamera(camera.id, { single: true })}>
                <Maximize2 />
              </IconAction>
            )}
          </div>
        </div>
      </div>

      {ptz && (
        <div
          className="absolute bottom-16 left-3 z-20 grid grid-cols-3 gap-1 rounded-lg border border-signal/40 bg-black/70 p-1.5 backdrop-blur"
          onClick={(event) => event.stopPropagation()}
        >
          <span />
          <PtzButton label="向上" onClick={() => toast.info(`${camera.code} 云台上转`)}>
            <ArrowUp />
          </PtzButton>
          <span />
          <PtzButton label="向左" onClick={() => toast.info(`${camera.code} 云台左转`)}>
            <ArrowLeft />
          </PtzButton>
          <span className="flex items-center justify-center text-signal">
            <Radio className="size-3.5" aria-hidden="true" />
          </span>
          <PtzButton label="向右" onClick={() => toast.info(`${camera.code} 云台右转`)}>
            <ArrowRight />
          </PtzButton>
          <span />
          <PtzButton label="向下" onClick={() => toast.info(`${camera.code} 云台下转`)}>
            <ArrowDown />
          </PtzButton>
          <span />
        </div>
      )}

      {activeReplay && (
        <div className="absolute inset-x-0 top-20 z-10 mx-auto flex w-fit max-w-[90%] items-center gap-2 rounded-full border border-signal/50 bg-black/75 py-1 pl-3 pr-1 text-xs text-white backdrop-blur">
          <History className="size-3.5 text-signal" aria-hidden="true" />
          <span className="truncate">检索回放 · {activeReplay.title}</span>
          <Button
            type="button"
            size="xs"
            variant="secondary"
            className="rounded-full"
            onClick={(event) => {
              event.stopPropagation()
              stopReplay()
            }}
          >
            返回实时
          </Button>
        </div>
      )}
    </div>
  )
}

function PtzButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      size="icon-xs"
      variant="ghost"
      aria-label={label}
      className="text-white hover:bg-signal hover:text-black"
      onClick={onClick}
    >
      {children}
    </Button>
  )
}
