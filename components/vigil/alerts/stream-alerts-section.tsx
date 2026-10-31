"use client"

import * as React from "react"
import { Radio, ScanLine } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { normalizeSeverity } from "@/lib/vigil/rules"
import { ALERT_SOURCE_LABEL, type StreamAlert } from "@/lib/vigil/streams"
import { SeverityBadge } from "../status-badges"
import { alertFrameUrl } from "../streams/use-streams"

function StreamAlertCard({ alert, onOpen }: { alert: StreamAlert; onOpen: (alert: StreamAlert) => void }) {
  const cover = alert.evidenceKeyframes[0] ?? alert.frames[0]?.index ?? 1
  return (
    <li>
      <Card className="h-full border-destructive/30">
        <CardContent className="flex h-full flex-col gap-3">
          <button
            type="button"
            onClick={() => onOpen(alert)}
            aria-label={`查看「${alert.ruleName}」的证据帧`}
            className="relative block overflow-hidden rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {/* 证据帧由服务端按需读取，不走 next/image 优化 */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={alertFrameUrl(alert.id, cover)}
              alt={`${alert.streamName}触发「${alert.ruleName}」的证据帧`}
              className="aspect-video w-full object-cover"
              loading="lazy"
            />
          </button>
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <SeverityBadge severity={normalizeSeverity(alert.severity)} />
                <h3 className="text-sm font-semibold">{alert.ruleName}</h3>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="gap-1 border-primary/40 bg-primary/10 text-xs text-primary">
                  {alert.source === "edge" ? <ScanLine aria-hidden="true" /> : <Radio aria-hidden="true" />}
                  {ALERT_SOURCE_LABEL[alert.source]}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {alert.streamName} · {alert.zone}
                </span>
              </div>
            </div>
            <span className="font-mono text-lg font-semibold text-destructive">{Math.round(alert.confidence * 100)}%</span>
          </div>
          <p className="flex-1 text-sm leading-relaxed text-muted-foreground">{alert.summary}</p>
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-xs text-muted-foreground">
              {new Date(alert.triggeredAt).toLocaleString("zh-CN", { hour12: false })}
            </span>
            <Button variant="outline" size="sm" onClick={() => onOpen(alert)}>
              研判详情
            </Button>
          </div>
        </CardContent>
      </Card>
    </li>
  )
}

function AlertDetailDialog({ alert, onClose }: { alert: StreamAlert | null; onClose: () => void }) {
  const [frameIndex, setFrameIndex] = React.useState<number | null>(null)
  React.useEffect(() => setFrameIndex(null), [alert?.id])
  const current = frameIndex ?? alert?.evidenceKeyframes[0] ?? alert?.frames[0]?.index ?? 1

  return (
    <Dialog open={alert !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
        {alert ? (
          <>
            <DialogHeader>
              <DialogTitle>{alert.ruleName}</DialogTitle>
              <DialogDescription>
                {ALERT_SOURCE_LABEL[alert.source]} · {alert.streamName} · {alert.zone}
              </DialogDescription>
            </DialogHeader>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={alertFrameUrl(alert.id, current)}
              alt={`第 ${current} 帧证据`}
              className="aspect-video w-full rounded-lg border border-border object-contain"
            />
            <div className="flex flex-wrap gap-2">
              {alert.frames.map((frame) => (
                <Button
                  key={frame.index}
                  size="sm"
                  variant={frame.index === current ? "default" : "outline"}
                  onClick={() => setFrameIndex(frame.index)}
                  className="font-mono"
                >
                  {frame.timecode}
                  {alert.evidenceKeyframes.includes(frame.index) ? " · 证据" : ""}
                </Button>
              ))}
            </div>
            <div className="flex flex-col gap-3 text-sm leading-relaxed">
              <p>{alert.summary}</p>
              <div>
                <h4 className="mb-1 text-xs font-medium text-muted-foreground">推理过程</h4>
                <p className="text-muted-foreground">{alert.reasoning}</p>
              </div>
              <div>
                <h4 className="mb-1 text-xs font-medium text-muted-foreground">处置建议</h4>
                <p className="text-muted-foreground">{alert.advice}</p>
              </div>
              {alert.edge ? (
                <p className="font-mono text-xs text-muted-foreground">
                  边缘端轨迹 {alert.edge.trackId} · 边缘置信度 {Math.round(alert.edge.edgeConfidence * 100)}%
                  {alert.edge.label ? ` · ${alert.edge.label}` : ""}
                </p>
              ) : null}
              <p className="font-mono text-xs text-muted-foreground">
                模型 {alert.model}（{alert.engineSource === "remote" ? "远端研判" : "离线兜底"}）
              </p>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

export function StreamAlertsSection({ alerts }: { alerts: StreamAlert[] }) {
  const [open, setOpen] = React.useState<StreamAlert | null>(null)
  if (alerts.length === 0) return null
  return (
    <section className="flex flex-col gap-4" aria-label="实时通道预警">
      <p className="text-sm text-muted-foreground">
        实时通道与边缘触发共 <span className="font-mono text-destructive">{alerts.length}</span> 起预警。
      </p>
      <ul className="grid gap-4 lg:grid-cols-2">
        {alerts.map((alert) => (
          <StreamAlertCard key={alert.id} alert={alert} onOpen={setOpen} />
        ))}
      </ul>
      <AlertDetailDialog alert={open} onClose={() => setOpen(null)} />
    </section>
  )
}
