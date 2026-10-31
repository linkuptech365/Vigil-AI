"use client"

import * as React from "react"
import { Crosshair, FolderSearch, ScanEye } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useVigil } from "@/components/vigil/vigil-provider"
import { triggerSecOf } from "@/lib/vigil/library-overlay"
import type { VideoItem } from "@/lib/vigil/types"
import { cameraTag } from "@/lib/vigil/video-source"
import { cn } from "@/lib/utils"
import { useOps } from "../ops-provider"

const FRESH_MS = 6000

function useFreshAlerts(alerts: VideoItem[]) {
  const seen = React.useRef<Set<string> | null>(null)
  const [fresh, setFresh] = React.useState<Set<string>>(new Set())

  React.useEffect(() => {
    const ids = alerts.map((video) => video.id)
    if (seen.current === null) {
      seen.current = new Set(ids)
      return
    }
    const added = ids.filter((id) => !seen.current?.has(id))
    seen.current = new Set(ids)
    if (added.length === 0) return

    setFresh((prev) => new Set([...prev, ...added]))
    const timer = window.setTimeout(() => {
      setFresh((prev) => {
        const next = new Set(prev)
        added.forEach((id) => next.delete(id))
        return next
      })
    }, FRESH_MS)
    return () => window.clearTimeout(timer)
  }, [alerts])

  return fresh
}

export function LibraryAlerts() {
  const { queue, setSelectedId } = useVigil()
  const { locateVideo, videoTarget } = useOps()

  const alerts = React.useMemo(
    () => queue.filter((video) => video.status === "alert" && video.ruleId),
    [queue]
  )
  const fresh = useFreshAlerts(alerts)

  if (alerts.length === 0) return null

  return (
    <section aria-label="目录视频研判预警" className="flex flex-col gap-2">
      <h3 className="flex items-center gap-2 px-1 text-xs font-medium text-muted-foreground">
        <FolderSearch className="size-3.5 text-signal" aria-hidden="true" />
        目录视频研判
        <Badge className="bg-destructive/15 font-mono text-destructive">{alerts.length}</Badge>
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
      </h3>
      <ul className="flex flex-col gap-2">
        {alerts.map((video) => {
          const isFresh = fresh.has(video.id)
          const isLocated = videoTarget?.videoId === video.id
          return (
            <li key={video.id}>
              <article
                className={cn(
                  "flex flex-col gap-2 rounded-lg border bg-card p-3 transition-shadow",
                  "border-destructive/50",
                  (isFresh || isLocated) && "ring-2 ring-signal shadow-[0_0_20px_-4px] shadow-signal/50",
                  isFresh && "animate-pulse"
                )}
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge className="bg-destructive font-mono text-[10px] text-destructive-foreground">
                    ALERT
                  </Badge>
                  <span className="text-sm font-semibold">{video.ruleName ?? video.ruleId}</span>
                  {isFresh && (
                    <Badge variant="outline" className="border-signal text-[10px] text-signal">
                      新预警
                    </Badge>
                  )}
                </div>
                <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                  {video.vlmReport?.result.summary ?? video.suppressedReason ?? "已触发规则预警"}
                </p>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11px] text-muted-foreground">
                  <span className="text-signal">{cameraTag(video.name)}</span>
                  <span className="truncate" title={video.name}>
                    {video.name}
                  </span>
                  {video.confidence !== undefined && <span>{Math.round(video.confidence * 100)}%</span>}
                </div>
                <div className="flex items-center justify-end gap-1">
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    className="text-muted-foreground"
                    onClick={() => locateVideo(video.id, triggerSecOf(video))}
                  >
                    <Crosshair data-icon="inline-start" />
                    定位画面
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    className="text-muted-foreground"
                    onClick={() => setSelectedId(video.id)}
                  >
                    <ScanEye data-icon="inline-start" />
                    研判详情
                  </Button>
                </div>
              </article>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
