"use client"

import * as React from "react"
import { BellRing, CheckCheck, ChevronRight, Crosshair, ShieldCheck } from "lucide-react"
import { alertClipSec } from "@/lib/ops/video-scenarios"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { CAMERAS } from "@/lib/ops/data"
import { handleImageError, hasMediaSrc, PLACEHOLDER_IMAGE } from "@/lib/ops/media"
import type { AlertEvent } from "@/lib/ops/types"
import { cn } from "@/lib/utils"
import {
  countOpen,
  groupLabel,
  isResolved,
  relativeLabel,
  STATUS_LABEL,
} from "@/lib/ops/utils"
import { LibraryAlerts } from "./library/library-alerts"
import { useOps } from "./ops-provider"
import { OverlayBoxes } from "./overlay-boxes"

export function KeyframeThumb({
  alert,
  className,
}: {
  alert: AlertEvent
  className?: string
}) {
  const camera = CAMERAS.find((c) => c.id === alert.cameraId)
  return (
    <div className={cn("relative aspect-video overflow-hidden rounded-md bg-black", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={alert.frameUrls?.[0] ?? (hasMediaSrc(camera?.image) ? camera.image : PLACEHOLDER_IMAGE)}
        alt={`${alert.cameraLabel ?? alert.cameraId} ${alert.type} 关键帧`}
        onError={handleImageError}
        className="absolute inset-0 size-full object-cover"
      />
      {camera?.maskTimestamp && (
        <div className="absolute left-0 top-0 h-[9%] w-[27%] bg-black/80 backdrop-blur-md" />
      )}
      {alert.box.w > 0 && <OverlayBoxes boxes={[{ ...alert.box, label: undefined }]} />}
    </div>
  )
}

function EventCard({ alert }: { alert: AlertEvent }) {
  const { openAlert, setAlertStatus, locateIncident } = useOps()
  const critical = alert.severity === "CRITICAL"
  const resolved = isResolved(alert.status)

  return (
    <li>
      <article
        className={cn(
          "group relative flex flex-col gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-secondary/60",
          critical && !resolved ? "border-destructive/50" : "border-border",
          resolved && "opacity-70"
        )}
      >
        <button
          type="button"
          onClick={() => openAlert(alert.id)}
          aria-label={`查看 ${alert.cameraId} ${alert.type} 研判详情`}
          className="absolute inset-0 z-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="pointer-events-none relative z-10 flex gap-3">
          <KeyframeThumb alert={alert} className="w-28 shrink-0 self-start sm:w-32" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge
                className={cn(
                  "font-mono text-[10px]",
                  critical
                    ? "bg-destructive text-destructive-foreground"
                    : "bg-warning text-black"
                )}
              >
                {alert.severity}
              </Badge>
              <span className="text-sm font-semibold">{alert.type}</span>
              {resolved && (
                <Badge variant="outline" className="text-[10px]">
                  {STATUS_LABEL[alert.status]}
                </Badge>
              )}
            </div>
            <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {alert.summary}
            </p>
            <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11px] text-muted-foreground">
              <span className="text-signal">{alert.cameraLabel ?? alert.cameraId}</span>
              <span>{alert.time}</span>
              <span>{relativeLabel(alert.minutesAgo)}</span>
              <span>{alert.confidence}%</span>
            </div>
          </div>
        </div>
        <div className="relative z-10 flex items-center justify-between gap-2">
          <Button
            type="button"
            size="xs"
            variant={alert.status === "open" ? "default" : "outline"}
            disabled={alert.status !== "open"}
            onClick={() => {
              setAlertStatus(alert.id, "acked")
              toast.success(`已确认 ${alert.cameraId} · ${alert.type}`)
            }}
          >
            <CheckCheck data-icon="inline-start" />
            {alert.status === "open" ? "确认处置" : STATUS_LABEL[alert.status]}
          </Button>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() =>
                locateIncident({
                  channelId: alert.cameraId,
                  timestampSec: alertClipSec(alert),
                  incidentId: alert.id,
                  title: `${alert.type} · ${alert.summary}`,
                })
              }
            >
              <Crosshair data-icon="inline-start" />
              定位画面
            </Button>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => openAlert(alert.id)}
            >
              研判详情
              <ChevronRight data-icon="inline-end" />
            </Button>
          </div>
        </div>
      </article>
    </li>
  )
}

export function IncidentFeed({ className }: { className?: string }) {
  const { alerts } = useOps()
  const [filter, setFilter] = React.useState<"all" | "open">("all")

  const visible = alerts.filter((a) => (filter === "open" ? a.status === "open" : true))
  const groups = visible.reduce<{ label: string; items: AlertEvent[] }[]>((acc, alert) => {
    const label = groupLabel(alert.minutesAgo)
    const found = acc.find((g) => g.label === label)
    if (found) found.items.push(alert)
    else acc.push({ label, items: [alert] })
    return acc
  }, [])

  const critical = countOpen(alerts, "CRITICAL")
  const warning = countOpen(alerts, "WARNING")

  return (
    <aside
      aria-labelledby="feed-title"
      className={cn("flex min-h-0 flex-col rounded-xl border border-border bg-card/50", className)}
    >
      <div className="flex flex-col gap-3 border-b border-border p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 id="feed-title" className="flex items-center gap-2 text-sm font-semibold">
            <BellRing className="size-4 text-signal" aria-hidden="true" />
            AI 研判告警流
          </h2>
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={filter}
            onValueChange={(v) => v && setFilter(v as "all" | "open")}
            aria-label="告警筛选"
          >
            <ToggleGroupItem value="all">全部</ToggleGroupItem>
            <ToggleGroupItem value="open">待处置</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="flex flex-wrap items-center gap-2" role="status" aria-live="polite">
          <Badge className="gap-1.5 bg-destructive/15 font-mono text-destructive">
            CRITICAL {critical}
          </Badge>
          <Badge className="gap-1.5 bg-warning/15 font-mono text-warning">WARNING {warning}</Badge>
          <span className="text-xs text-muted-foreground">待处置告警</span>
        </div>
      </div>

      <div className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-3 max-lg:max-h-[640px]">
        <LibraryAlerts />
        {groups.length === 0 ? (
          <Empty className="py-12">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ShieldCheck />
              </EmptyMedia>
              <EmptyTitle>所有告警已处置</EmptyTitle>
              <EmptyDescription>当前没有待处置的 AI 研判事件，系统持续监控中。</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col gap-5">
            {groups.map((group) => (
              <section key={group.label} aria-label={group.label} className="flex flex-col gap-2">
                <h3 className="flex items-center gap-2 px-1 text-xs font-medium text-muted-foreground">
                  <span className="size-1.5 rounded-full bg-signal" aria-hidden="true" />
                  {group.label}
                  <span className="h-px flex-1 bg-border" aria-hidden="true" />
                </h3>
                <ul className="flex flex-col gap-2">
                  {group.items.map((alert) => (
                    <EventCard key={alert.id} alert={alert} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}
