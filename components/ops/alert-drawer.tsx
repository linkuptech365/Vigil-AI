"use client"

import * as React from "react"
import {
  Archive,
  Crosshair,
  FastForward,
  Pause,
  Play,
  ThumbsDown,
  UserPlus,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"
import { CAMERAS } from "@/lib/ops/data"
import { handleImageError, hasMediaSrc, PLACEHOLDER_IMAGE } from "@/lib/ops/media"
import type { AlertEvent } from "@/lib/ops/types"
import { cn } from "@/lib/utils"
import {
  isResolved,
  secondsToTime,
  STATUS_LABEL,
  timeToSeconds,
  toPixelBox,
} from "@/lib/ops/utils"
import { useOps } from "./ops-provider"
import { OverlayBoxes } from "./overlay-boxes"

const CLIP_SPAN = 15
const SPEEDS = [0.5, 1, 2] as const

function ClipPlayer({ alert }: { alert: AlertEvent }) {
  const camera = CAMERAS.find((c) => c.id === alert.cameraId)
  const [t, setT] = React.useState(CLIP_SPAN)
  const [playing, setPlaying] = React.useState(true)
  const [speed, setSpeed] = React.useState<(typeof SPEEDS)[number]>(1)

  React.useEffect(() => {
    setT(CLIP_SPAN)
    setPlaying(true)
  }, [alert.id])

  React.useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => {
      setT((prev) => (prev + 0.1 * speed >= CLIP_SPAN * 2 ? 0 : prev + 0.1 * speed))
    }, 100)
    return () => window.clearInterval(id)
  }, [playing, speed])

  const offset = t - CLIP_SPAN
  const absolute = secondsToTime(timeToSeconds(alert.time) + offset)
  const boxVisible = offset > -6

  return (
    <div className="flex flex-col gap-2">
      <div className="relative aspect-video overflow-hidden rounded-lg border border-border bg-black">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={hasMediaSrc(camera?.image) ? camera.image : PLACEHOLDER_IMAGE}
          alt={`${alert.cameraId} 事件回放画面`}
          className="absolute inset-0 size-full object-cover"
          onError={handleImageError}
        />
        {camera?.maskTimestamp && (
          <div className="absolute left-0 top-0 h-[9%] w-[27%] bg-black/80 backdrop-blur-md" />
        )}
        <div className="cctv-scanlines pointer-events-none absolute inset-0" aria-hidden="true" />
        {boxVisible && <OverlayBoxes boxes={[alert.box]} />}
        <div className="absolute left-2 top-2 flex items-center gap-2 font-mono text-xs">
          <span className="rounded bg-black/70 px-1.5 py-0.5 text-signal">{alert.cameraId}</span>
          <span className="rounded bg-black/70 px-1.5 py-0.5 text-white">{absolute}</span>
        </div>
        <span className="absolute right-2 top-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white">
          事件前后 ±{CLIP_SPAN}s
        </span>
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          aria-label={playing ? "暂停回放" : "播放回放"}
          onClick={() => setPlaying((p) => !p)}
        >
          {playing ? <Pause /> : <Play />}
        </Button>
        <Slider
          value={[t]}
          min={0}
          max={CLIP_SPAN * 2}
          step={0.1}
          onValueChange={([v]) => {
            setPlaying(false)
            setT(v)
          }}
          aria-label="回放进度"
          className="flex-1"
        />
        <Button
          type="button"
          size="xs"
          variant="outline"
          className="w-14 font-mono"
          aria-label={`倍速 ${speed}x，点击切换`}
          onClick={() => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length])}
        >
          <FastForward data-icon="inline-start" />
          {speed}x
        </Button>
      </div>
      <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
        <span>{secondsToTime(timeToSeconds(alert.time) - CLIP_SPAN)}</span>
        <span className="text-destructive">触发 {alert.time}</span>
        <span>{secondsToTime(timeToSeconds(alert.time) + CLIP_SPAN)}</span>
      </div>

      <ReasoningTree alert={alert} offset={offset} onSeek={(o) => { setPlaying(false); setT(o + CLIP_SPAN) }} />
    </div>
  )
}

function ReasoningTree({
  alert,
  offset,
  onSeek,
}: {
  alert: AlertEvent
  offset: number
  onSeek: (offset: number) => void
}) {
  const activeIndex = alert.steps.reduce((acc, step, i) => (offset >= step.offset ? i : acc), -1)

  return (
    <section aria-labelledby="reasoning-title" className="mt-2 flex flex-col gap-3">
      <h3 id="reasoning-title" className="text-sm font-semibold">
        AI 推理链路
      </h3>
      <ol className="flex flex-col">
        {alert.steps.map((step, index) => {
          const reached = index <= activeIndex
          const last = index === alert.steps.length - 1
          return (
            <li key={step.title} className="relative flex gap-3 pb-4 last:pb-0">
              {!last && (
                <span
                  className={cn(
                    "absolute left-[7px] top-4 h-[calc(100%-1rem)] w-px",
                    reached ? "bg-signal/60" : "bg-border"
                  )}
                  aria-hidden="true"
                />
              )}
              <span
                className={cn(
                  "relative z-10 mt-1 size-3.5 shrink-0 rounded-full border-2 bg-background",
                  reached ? "border-signal" : "border-border",
                  index === activeIndex && "ring-4 ring-signal/20"
                )}
                aria-hidden="true"
              />
              <button
                type="button"
                onClick={() => onSeek(step.offset)}
                className="flex flex-1 flex-col items-start gap-0.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex items-center gap-2">
                  <span
                    className={cn(
                      "text-sm font-medium",
                      reached ? "text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {step.title}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {secondsToTime(timeToSeconds(alert.time) + step.offset)}
                  </span>
                </span>
                <span className="text-xs leading-relaxed text-muted-foreground">{step.detail}</span>
              </button>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function Workflow({ alert }: { alert: AlertEvent }) {
  const { setAlertStatus, closeAlert } = useOps()
  const [note, setNote] = React.useState(alert.note ?? "")

  React.useEffect(() => {
    setNote(alert.note ?? "")
  }, [alert.id, alert.note])

  const apply = (status: AlertEvent["status"], message: string, assignee?: string) => {
    setAlertStatus(alert.id, status, note, assignee)
    toast.success(message, { description: `${alert.cameraId} · ${alert.type}` })
    if (status === "false_positive" || status === "archived") closeAlert()
  }

  return (
    <section aria-labelledby="workflow-title" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 id="workflow-title" className="text-sm font-semibold">
          处置工作流
        </h3>
        <Badge variant={isResolved(alert.status) ? "secondary" : "default"}>
          {STATUS_LABEL[alert.status]}
          {alert.assignee ? ` · ${alert.assignee}` : ""}
        </Badge>
      </div>
      <Textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        aria-label="处置备注"
        placeholder="记录现场处置情况、指派说明或误报原因..."
        className="min-h-20 resize-none text-sm"
      />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Button
          type="button"
          onClick={() => apply("assigned", "已指派给值班安全员", "值班安全员")}
        >
          <UserPlus data-icon="inline-start" />
          指派给安全员
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => apply("false_positive", "已标记为误报，将用于模型优化")}
        >
          <ThumbsDown data-icon="inline-start" />
          标记为误报
        </Button>
        <Button type="button" variant="secondary" onClick={() => apply("archived", "事件已确认并归档")}>
          <Archive data-icon="inline-start" />
          确认并归档
        </Button>
      </div>
    </section>
  )
}

export function AlertDrawer() {
  const { selectedAlert, closeAlert } = useOps()
  const alert = selectedAlert

  return (
    <Sheet open={!!alert} onOpenChange={(open) => !open && closeAlert()}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-hidden p-0 data-[side=right]:sm:max-w-xl"
      >
        {alert && (
          <>
            <SheetHeader className="gap-1.5 border-b border-border p-4 pr-12">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  className={cn(
                    "font-mono",
                    alert.severity === "CRITICAL"
                      ? "bg-destructive text-destructive-foreground"
                      : "bg-warning text-black"
                  )}
                >
                  {alert.severity}
                </Badge>
                <SheetTitle className="text-base">
                  {alert.type} · {alert.cameraId}
                </SheetTitle>
              </div>
              <SheetDescription className="text-sm leading-relaxed">{alert.summary}</SheetDescription>
            </SheetHeader>

            <div className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
              <ClipPlayer alert={alert} />

              <section aria-labelledby="meta-title" className="flex flex-col gap-3">
                <h3 id="meta-title" className="text-sm font-semibold">
                  检测明细
                </h3>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-border bg-secondary/40 p-3 text-xs">
                  <Meta label="事件编号" value={alert.id} mono />
                  <Meta label="命中规则" value={alert.rule} />
                  <Meta label="置信度" value={`${alert.confidence}%`} mono />
                  <Meta label="触发时间" value={alert.time} mono />
                  <div className="col-span-2 flex flex-col gap-1">
                    <dt className="flex items-center gap-1 text-muted-foreground">
                      <Crosshair className="size-3" aria-hidden="true" />
                      检测框坐标 [x1, y1, x2, y2]
                    </dt>
                    <dd className="font-mono text-signal">[{toPixelBox(alert.box).join(", ")}]</dd>
                  </div>
                  <div className="col-span-2 flex flex-col gap-1.5">
                    <dt className="text-muted-foreground">关联目标</dt>
                    <dd className="flex flex-wrap gap-1.5">
                      {alert.related.map((item) => (
                        <Badge key={item} variant="outline" className="font-mono">
                          {item}
                        </Badge>
                      ))}
                    </dd>
                  </div>
                </dl>
              </section>

              <Workflow alert={alert} />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("font-medium", mono && "font-mono")}>{value}</dd>
    </div>
  )
}
