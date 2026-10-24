"use client"

import * as React from "react"
import { Camera as CameraIcon, CameraOff, EyeOff, Maximize2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { AnnotatedFeed } from "@/components/vigil/streams/annotated-feed"
import { LiveFeed, useVisible } from "@/components/vigil/streams/live-wall"
import { streamSnapshotUrl } from "@/components/vigil/streams/use-streams"
import { cn } from "@/lib/utils"
import type { StreamView } from "@/lib/vigil/streams"

interface StreamTileProps {
  stream: StreamView
  /** true 使用 MJPEG 长连接，false 使用快照轮询（浏览器同域并发连接有限） */
  live: boolean
  /** 显示视觉服务绘制了检测框的标注画面 */
  annotated: boolean
  size: "lg" | "sm"
  className?: string
  onFocus?: () => void
  onMaximize?: () => void
  onHide?: () => void
}

function IconAction({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="secondary"
          aria-label={label}
          className="bg-black/60 text-white backdrop-blur hover:bg-black/80"
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

async function downloadSnapshot(stream: StreamView) {
  try {
    const response = await fetch(`${streamSnapshotUrl(stream.id)}?t=${Date.now()}`, { cache: "no-store" })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const url = URL.createObjectURL(await response.blob())
    const link = document.createElement("a")
    link.href = url
    link.download = `${stream.id}-${Date.now()}.jpg`
    link.click()
    URL.revokeObjectURL(url)
    toast.success(`${stream.name} 抓拍已保存`)
  } catch {
    toast.error(`${stream.name} 抓拍失败`, { description: "通道当前没有可用画面" })
  }
}

export function StreamTile({ stream, live, annotated, size, className, onFocus, onMaximize, onHide }: StreamTileProps) {
  const [ref, visible] = useVisible<HTMLDivElement>()
  const online = stream.status === "online"
  const alerting = stream.lastAnalysis?.status === "alert"
  const isLarge = size === "lg"
  const statusText = online ? (annotated ? "AI 标注" : live ? "实时" : "快照") : stream.status === "idle" ? "待命" : "离线"

  return (
    <div
      ref={ref}
      role="group"
      aria-label={`${stream.name} ${stream.zone}`}
      tabIndex={0}
      onClick={onFocus}
      onKeyDown={(event) => {
        if (event.key === "Enter") onFocus?.()
      }}
      className={cn(
        "group/tile relative isolate overflow-hidden rounded-lg border bg-black outline-none focus-visible:ring-2 focus-visible:ring-ring",
        alerting ? "border-destructive/60" : "border-border",
        onFocus && "cursor-pointer hover:border-signal/60",
        className
      )}
    >
      <div className="absolute inset-0 bg-muted">
        {stream.status === "offline" ? (
          <div className="flex size-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <CameraOff className="size-6" aria-hidden="true" />
            <span className="text-xs">通道离线</span>
          </div>
        ) : annotated && visible ? (
          <AnnotatedFeed streamId={stream.id} name={stream.name} />
        ) : (
          <LiveFeed stream={stream} live={live && !annotated} active={visible} />
        )}
      </div>

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/55 via-transparent to-black/60" />

      <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2.5">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="w-fit max-w-full truncate rounded bg-black/70 px-1.5 py-0.5 text-xs font-semibold text-signal">
            {stream.name}
          </span>
          {isLarge ? <span className="truncate text-xs font-medium text-white drop-shadow">{stream.zone}</span> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {stream.builtin ? (
            <Badge variant="outline" className="border-warning/50 bg-black/70 text-[10px] text-warning">
              模拟流
            </Badge>
          ) : null}
          <span className="flex items-center gap-1.5 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white">
            <span className="relative flex size-2">
              {online ? (
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive opacity-75" />
              ) : null}
              <span
                className={cn(
                  "relative inline-flex size-2 rounded-full",
                  online ? "bg-destructive" : stream.status === "idle" ? "bg-warning" : "bg-muted-foreground"
                )}
              />
            </span>
            {statusText}
          </span>
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-2.5">
        <span
          className={cn(
            "flex max-w-[60%] items-center gap-1.5 truncate rounded-full border px-2 py-0.5 text-[11px] font-medium backdrop-blur",
            alerting
              ? "border-destructive/50 bg-destructive/20 text-destructive"
              : "border-success/40 bg-success/15 text-success"
          )}
        >
          <span className={cn("size-1.5 shrink-0 rounded-full", alerting ? "bg-destructive" : "bg-success")} />
          <span className="truncate">
            {alerting ? `命中「${stream.lastAnalysis?.ruleName ?? "规则"}」` : stream.zone}
          </span>
        </span>
        <div className="flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/tile:opacity-100 max-lg:opacity-100">
          <IconAction label="抓拍快照" onClick={() => void downloadSnapshot(stream)}>
            <CameraIcon />
          </IconAction>
          {onMaximize ? (
            <IconAction label="全屏放大" onClick={onMaximize}>
              <Maximize2 />
            </IconAction>
          ) : null}
          {onHide ? (
            <IconAction label="从大屏移除该路" onClick={onHide}>
              <EyeOff />
            </IconAction>
          ) : null}
        </div>
      </div>
    </div>
  )
}
