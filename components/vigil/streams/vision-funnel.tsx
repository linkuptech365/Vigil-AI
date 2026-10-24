"use client"

import * as React from "react"
import { Filter, RotateCcw } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { funnelView, type VisionEvent, type VisionInfo } from "@/lib/vigil/vision"

const EVENT_STATUS: Record<VisionEvent["status"], { label: string; className: string }> = {
  pending: { label: "复核中", className: "border-warning/40 bg-warning/10 text-warning" },
  confirmed: { label: "已确认", className: "border-destructive/40 bg-destructive/10 text-destructive" },
  rejected: { label: "已排除", className: "border-success/40 bg-success/10 text-success" },
  error: { label: "复核失败", className: "border-border bg-muted text-muted-foreground" },
}

function Stage({ label, value, total, tone }: { label: string; value: number; total: number; tone: string }) {
  const pct = total > 0 ? Math.max(value > 0 ? 2 : 0, Math.round((value / total) * 100)) : 0
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono text-foreground">{value.toLocaleString("zh-CN")}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="presentation">
        <div className={cn("h-full rounded-full transition-[width]", tone)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

/** 三级漏斗的实时统计与最近的疑似事件；视觉服务未运行时不占位。 */
export function VisionFunnel({ vision, onReset }: { vision: VisionInfo; onReset: () => void }) {
  if (vision.status === "disabled" || vision.status === "offline") return null
  const funnel = funnelView(vision.stats)
  const events = vision.recentEvents.slice(0, 4)

  return (
    <section aria-label="视觉漏斗统计" className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Filter className="size-4 text-primary" aria-hidden="true" />
          视觉漏斗
          <Badge variant="outline" className="font-mono text-xs">
            {vision.status === "degraded" ? "仅帧差" : `${vision.mode} · ${vision.device}`}
          </Badge>
        </h2>
        <div className="flex items-center gap-3">
          <p className="text-xs text-muted-foreground">
            已拦截 <span className="font-mono text-base font-semibold text-success">{funnel.interceptPct}%</span> 的采样帧，未送入大模型
          </p>
          <Button size="icon-sm" variant="ghost" aria-label="重置统计" onClick={onReset}>
            <RotateCcw />
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2.5">
          <Stage label="采样帧总数" value={funnel.total} total={funnel.total} tone="bg-muted-foreground/40" />
          <Stage label="Tier-0 帧差拦截（静止）" value={funnel.tier0} total={funnel.total} tone="bg-success" />
          <Stage label="Tier-1 检测放行（合规）" value={funnel.tier1Passed} total={funnel.total} tone="bg-success" />
          <Stage label="Tier-2 送大模型复核" value={funnel.tier2} total={funnel.total} tone="bg-primary" />
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">最近疑似事件</p>
          {events.length === 0 ? (
            <p className="text-xs text-muted-foreground">暂无事件，画面中尚未出现疑似违规。</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {events.map((event) => {
                const status = EVENT_STATUS[event.status]
                return (
                  <li key={event.id} className="flex items-start gap-2 text-xs">
                    <Badge variant="outline" className={cn("shrink-0", status.className)}>
                      {status.label}
                    </Badge>
                    <span className="min-w-0 leading-relaxed">
                      <span className="font-mono text-muted-foreground">
                        {new Date(event.at).toLocaleTimeString("zh-CN", { hour12: false })}
                      </span>{" "}
                      {event.label}
                      {event.summary ? <span className="text-muted-foreground"> · {event.summary}</span> : null}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}
