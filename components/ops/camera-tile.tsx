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
  Radio,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { Camera, CameraStatus } from "@/lib/ops/types"
import { secondsToTime, timeToSeconds } from "@/lib/ops/utils"
import { OverlayBoxes } from "./overlay-boxes"
import { useOps } from "./ops-provider"

const STATUS_STYLE: Record<CameraStatus, string> = {
  normal: "border-success/40 bg-success/15 text-success",
  fence: "border-success/40 bg-success/15 text-success",
  alert: "border-destructive/50 bg-destructive/20 text-destructive",
  gathering: "border-warning/50 bg-warning/20 text-warning",
}

const STATUS_DOT: Record<CameraStatus, string> = {
  normal: "bg-success",
  fence: "bg-success",
  alert: "bg-destructive",
  gathering: "bg-warning",
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

function ReplayBar({ start, end }: { start: string; end: string }) {
  const duration = Math.max(timeToSeconds(end) - timeToSeconds(start), 1)
  const [elapsed, setElapsed] = React.useState(0)

  React.useEffect(() => {
    setElapsed(0)
    const id = window.setInterval(() => {
      setElapsed((prev) => (prev + 0.25 >= duration ? 0 : prev + 0.25))
    }, 250)
    return () => window.clearInterval(id)
  }, [start, duration])

  return (
    <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-gradient-to-t from-black/85 to-transparent px-3 pb-2 pt-6">
      <div className="h-1 overflow-hidden rounded-full bg-white/20">
        <div
          className="h-full rounded-full bg-signal"
          style={{ width: `${(elapsed / duration) * 100}%` }}
        />
      </div>
      <div className="flex justify-between font-mono text-[10px] text-white/80">
        <span>{secondsToTime(timeToSeconds(start) + elapsed)}</span>
        <span>
          {start} - {end}
        </span>
      </div>
    </div>
  )
}

export function CameraTile({ camera, size, className }: CameraTileProps) {
  const { focusId, layout, focusCamera, replay, stopReplay } = useOps()
  const bitrate = useLiveBitrate(camera.bitrate)
  const [ptz, setPtz] = React.useState(false)
  const isLarge = size === "lg"
  const activeReplay = replay && replay.cameraId === camera.id && layout === "single" ? replay : null
  const isFocused = focusId === camera.id

  const select = () => {
    if (layout === "focus" && !isFocused) focusCamera(camera.id)
  }

  const snapshot = () => {
    toast.success(`${camera.code} 抓拍已保存`, {
      description: `${camera.name} · ${new Date().toLocaleTimeString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" })}`,
    })
  }

  return (
    <div
      role="group"
      aria-label={`${camera.code} ${camera.name}`}
      tabIndex={0}
      onClick={select}
      onKeyDown={(event) => {
        if (event.key === "Enter") select()
      }}
      className={cn(
        "group/tile relative isolate overflow-hidden rounded-lg border bg-black outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring",
        camera.status === "alert" ? "border-destructive/60" : "border-border",
        layout === "focus" && !isFocused && "cursor-pointer hover:border-signal/60",
        className
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={camera.image || "/placeholder.svg"}
        alt={`${camera.code} ${camera.name} 实时画面`}
        className="absolute inset-0 size-full object-cover"
        draggable={false}
      />
      {camera.maskTimestamp && (
        <div className="absolute left-0 top-0 h-[9%] w-[27%] bg-black/80 backdrop-blur-md" />
      )}
      <div className="cctv-scanlines pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/55 via-transparent to-black/60" />

      <OverlayBoxes
        boxes={camera.boxes}
        showAllLabels={isLarge}
        labelSize={isLarge ? "sm" : "xs"}
      />

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
            {activeReplay ? "REPLAY" : "REC"}
          </span>
          <span className="rounded bg-black/70 px-1.5 py-0.5">
            {camera.resolution} | {camera.fps} FPS{isLarge || true ? ` | ${bitrate} Mbps` : ""}
          </span>
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-2.5">
        <span
          className={cn(
            "flex max-w-[70%] items-center gap-1.5 truncate rounded-full border px-2 py-0.5 text-[11px] font-medium backdrop-blur",
            STATUS_STYLE[camera.status]
          )}
        >
          <span className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[camera.status])} />
          <span className="truncate">{camera.statusLabel}</span>
        </span>

        <div className="flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/tile:opacity-100 max-lg:opacity-100">
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

      {ptz && (
        <div
          className="absolute bottom-12 left-3 grid grid-cols-3 gap-1 rounded-lg border border-signal/40 bg-black/70 p-1.5 backdrop-blur"
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
        <>
          <div className="absolute inset-x-0 top-12 mx-auto flex w-fit max-w-[90%] items-center gap-2 rounded-full border border-signal/50 bg-black/75 py-1 pl-3 pr-1 text-xs text-white backdrop-blur">
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
          <ReplayBar start={activeReplay.start} end={activeReplay.end} />
        </>
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
