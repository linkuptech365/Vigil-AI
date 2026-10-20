"use client"

import { Activity, Gauge, MemoryStick, RadioTower, type LucideIcon } from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { useIngestion } from "./ingestion-provider"

interface ScoreCardProps {
  label: string
  value: string
  unit: string
  hint: string
  icon: LucideIcon
}

function ScoreCard({ label, value, unit, hint, icon: Icon }: ScoreCardProps) {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="flex items-baseline gap-1.5">
            <span className="font-mono text-2xl font-semibold tabular-nums">{value}</span>
            <span className="text-xs text-muted-foreground">{unit}</span>
          </p>
          <p className="truncate font-mono text-[11px] text-muted-foreground">{hint}</p>
        </div>
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
          <Icon className="size-4" aria-hidden="true" />
        </div>
      </CardContent>
    </Card>
  )
}

export function IngestionScorecards() {
  const { totals, streams } = useIngestion()
  const dropping = streams.filter((s) => s.status === "frame_drop").length

  return (
    <section aria-label="接入管道概览" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <ScoreCard
        label="当前在线流路数"
        value={`${totals.online} / ${totals.total}`}
        unit="在线"
        hint={dropping > 0 ? `${dropping} 路出现丢帧` : "全部通道健康"}
        icon={RadioTower}
      />
      <ScoreCard
        label="全局进流带宽"
        value={totals.bandwidth.toFixed(1)}
        unit="Mbps"
        hint="Ingress, 实时汇总"
        icon={Gauge}
      />
      <ScoreCard
        label="动态抽帧吞吐量"
        value={String(totals.aggregateFps)}
        unit="FPS Aggregate"
        hint="1 FPS 待机 / 5~10 FPS 活跃"
        icon={Activity}
      />
      <ScoreCard
        label="环形缓存占用"
        value={String(totals.memoryMB)}
        unit="MB RAM"
        hint={`${totals.total} 个通道 x 30s HD Ring Buffer`}
        icon={MemoryStick}
      />
    </section>
  )
}
