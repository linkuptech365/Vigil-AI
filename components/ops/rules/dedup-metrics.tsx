"use client"

import * as React from "react"
import {
  ChevronRight,
  ClipboardCheck,
  Filter,
  Layers,
  Network,
  Radar,
  ShieldCheck,
  Siren,
  Timer,
  Waypoints,
  type LucideIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { useRules } from "./rules-provider"

interface MetricCardProps {
  label: string
  labelEn: string
  value: string
  unit: string
  hint: string
  icon: LucideIcon
  live?: boolean
}

function MetricCard({ label, labelEn, value, unit, hint, icon: Icon, live }: MetricCardProps) {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-xs text-muted-foreground">
            {label} <span className="font-mono text-[10px]">({labelEn})</span>
          </p>
          <p className="flex items-baseline gap-1.5">
            <span className="font-mono text-2xl font-semibold tabular-nums">{value}</span>
            <span className="text-xs text-muted-foreground">{unit}</span>
          </p>
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {live && (
              <span className="relative flex size-1.5" aria-hidden="true">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-75" />
                <span className="relative inline-flex size-1.5 rounded-full bg-success" />
              </span>
            )}
            <span className="truncate font-mono">{hint}</span>
          </p>
        </div>
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
          <Icon className="size-4" aria-hidden="true" />
        </div>
      </CardContent>
    </Card>
  )
}

interface Stage {
  title: string
  detail: string
  icon: LucideIcon
  count: number
  dropped: number
}

export function DedupMetrics() {
  const { metrics } = useRules()
  const { rawTriggersCount, suppressedCount, incidentCount, correlatedCount } = metrics

  const rate = rawTriggersCount > 0 ? (suppressedCount / rawTriggersCount) * 100 : 0

  const stages = React.useMemo<Stage[]>(() => {
    const transient = Math.round(suppressedCount * 0.2)
    const crossCam = correlatedCount
    const windowMerged = Math.max(0, suppressedCount - transient - crossCam)
    const afterFrames = rawTriggersCount - transient
    const afterWindow = afterFrames - windowMerged
    return [
      { title: "原始触发", detail: "规则引擎单帧命中", icon: Radar, count: rawTriggersCount, dropped: 0 },
      { title: "连续 3 帧确认", detail: "滤除单帧瞬时抖动", icon: Layers, count: afterFrames, dropped: transient },
      { title: "60s 时间窗口去重", detail: "同通道同规则合并", icon: Timer, count: afterWindow, dropped: windowMerged },
      { title: "跨机位时空聚类", detail: "相邻机位轨迹归并", icon: Network, count: afterWindow - crossCam, dropped: crossCam },
      { title: "生成正式告警工单", detail: "派发通知与声光联动", icon: Siren, count: incidentCount, dropped: 0 },
    ]
  }, [rawTriggersCount, suppressedCount, incidentCount, correlatedCount])

  return (
    <section aria-label="告警降噪概览" className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="原始规则触发频次"
          labelEn="Raw Triggers"
          value={String(rawTriggersCount)}
          unit="次"
          hint="实时累计 · 近 24 小时"
          icon={Filter}
          live
        />
        <MetricCard
          label="降噪抑制拦截率"
          labelEn="Suppression Rate"
          value={rate.toFixed(1)}
          unit="%"
          hint={`${suppressedCount} 次重复抖动被合并/抑制`}
          icon={ShieldCheck}
        />
        <MetricCard
          label="有效聚类事件数"
          labelEn="Escalated Incidents"
          value={String(incidentCount)}
          unit="个独立工单"
          hint="每个工单携带完整证据链"
          icon={ClipboardCheck}
        />
        <MetricCard
          label="跨机位关联事件"
          labelEn="Correlated Multi-Cam"
          value={String(correlatedCount)}
          unit="起"
          hint="双机位协同确认"
          icon={Waypoints}
        />
      </div>

      <Card className="gap-4 py-4">
        <CardHeader className="px-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-col gap-1">
              <CardTitle className="text-sm">降噪抑制流水线</CardTitle>
              <CardDescription>
                原始触发逐级过滤，最终仅 {incidentCount} 条进入告警工单，噪声削减 {rate.toFixed(1)}%。
              </CardDescription>
            </div>
            <Badge variant="outline" className="border-success/40 font-mono text-success">
              Suppression Pipeline
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="px-4">
          <ol className="flex flex-col gap-2 lg:flex-row lg:items-stretch lg:gap-1">
            {stages.map((stage, index) => {
              const Icon = stage.icon
              const last = index === stages.length - 1
              return (
                <React.Fragment key={stage.title}>
                  <li
                    className={cn(
                      "flex min-w-0 flex-1 flex-col gap-2 rounded-lg border p-3",
                      last ? "border-primary/50 bg-primary/10" : "border-border bg-background"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Icon
                        className={cn("size-4 shrink-0", last ? "text-primary" : "text-muted-foreground")}
                        aria-hidden="true"
                      />
                      <span className="truncate text-xs font-semibold">{stage.title}</span>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-xl font-semibold tabular-nums">{stage.count}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {last ? "张工单" : "次通过"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="truncate text-muted-foreground">{stage.detail}</span>
                      {stage.dropped > 0 && (
                        <span className="shrink-0 font-mono text-warning">-{stage.dropped}</span>
                      )}
                    </div>
                  </li>
                  {!last && (
                    <li
                      aria-hidden="true"
                      className="flex shrink-0 items-center justify-center text-muted-foreground max-lg:rotate-90"
                    >
                      <ChevronRight className="size-4" />
                    </li>
                  )}
                </React.Fragment>
              )
            })}
          </ol>
        </CardContent>
      </Card>
    </section>
  )
}
