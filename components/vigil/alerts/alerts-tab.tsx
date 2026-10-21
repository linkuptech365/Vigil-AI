"use client"

import { Play, ScanEye, ShieldCheck } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { normalizeSeverity } from "@/lib/vigil/rules"
import { EvidenceFrame, TimestampBadge } from "../evidence-frame"
import { SeverityBadge } from "../status-badges"
import { useVigil } from "../vigil-provider"

export function AlertsTab() {
  const { queue, setSelectedId, setActiveTab } = useVigil()
  const alerts = queue.filter((v) => v.status === "alert" && v.ruleId)

  if (alerts.length === 0) {
    return (
      <Empty className="rounded-xl border border-dashed border-border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ShieldCheck />
          </EmptyMedia>
          <EmptyTitle>暂无预警事件</EmptyTitle>
          <EmptyDescription>
            视频分析命中规则且置信度达到阈值后，预警将汇总显示在这里。
          </EmptyDescription>
        </EmptyHeader>
        <Button onClick={() => setActiveTab("queue")}>
          <Play data-icon="inline-start" />
          前往检测队列
        </Button>
      </Empty>
    )
  }

  const critical = alerts.filter((v) => normalizeSeverity(v.ruleSeverity) === "CRITICAL").length

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        共 <span className="font-mono text-destructive">{alerts.length}</span> 起预警，其中严重{" "}
        <span className="font-mono text-destructive">{critical}</span> 起。
      </p>
      <ul className="grid gap-4 lg:grid-cols-2">
        {alerts.map((video) => {
          const severity = normalizeSeverity(video.ruleSeverity)
          const ruleName = video.ruleName ?? video.ruleId
          const brief = video.vlmReport?.result.summary ?? ""
          return (
            <li key={video.id}>
              <Card className="h-full border-destructive/30">
                <CardContent className="flex h-full flex-col gap-3">
                  <button
                    type="button"
                    onClick={() => setSelectedId(video.id)}
                    aria-label={`查看「${ruleName}」的证据大图与处置链`}
                    className="group relative block rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <EvidenceFrame
                      variant="thumb"
                      src={video.evidenceFrameBase64}
                      alt={`${ruleName}在 ${video.timestamp ?? "未知时间"} 的违规抓拍`}
                    />
                    <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/70 text-xs font-medium text-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                      查看大图与处置链
                    </span>
                  </button>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <SeverityBadge severity={severity} />
                        <h3 className="text-sm font-semibold">{ruleName}</h3>
                        {video.timestamp ? <TimestampBadge timestamp={video.timestamp} /> : null}
                      </div>
                      <p className="truncate font-mono text-xs text-muted-foreground" title={video.name}>
                        {video.name}
                      </p>
                    </div>
                    <span className="font-mono text-lg font-semibold text-destructive">
                      {Math.round((video.confidence ?? 0) * 100)}%
                    </span>
                  </div>
                  <p className="flex-1 text-sm leading-relaxed text-muted-foreground">{brief}</p>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-muted-foreground">
                      {video.analyzedAt}
                    </span>
                    <Button variant="outline" size="sm" onClick={() => setSelectedId(video.id)}>
                      <ScanEye data-icon="inline-start" />
                      研判详情
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
