"use client"

import * as React from "react"
import useSWR from "swr"
import { Radio } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { getJson } from "@/lib/ops/rules-client"
import {
  VISION_ENDPOINTS,
  visionRoleLabel,
  type VisionHitEntry,
  type VisionHitGate,
  type VisionHitsResponse,
} from "@/lib/vigil/vision"
import { cn } from "@/lib/utils"
import { usePerception } from "./perception-provider"

const GATE: Record<VisionHitGate, { label: string; className: string }> = {
  escalated: { label: "已投递二级研判", className: "border-destructive/40 bg-destructive/10 text-destructive" },
  pending: { label: "累积确认中", className: "border-warning/40 bg-warning/10 text-warning" },
  cooldown: { label: "冷却中", className: "border-border bg-muted text-muted-foreground" },
  passed: { label: "已检出 · 未触发", className: "border-success/40 bg-success/10 text-success" },
  nodet: { label: "Gate 0 · 无检出", className: "border-border bg-muted text-muted-foreground" },
}

function timeOf(at: string) {
  const date = new Date(at)
  return Number.isNaN(date.getTime()) ? at : date.toLocaleTimeString("zh-CN", { hour12: false })
}

function HitRow({ entry }: { entry: VisionHitEntry }) {
  const gate = GATE[entry.gate] ?? GATE.passed
  return (
    <li className="flex flex-col gap-1.5 px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] text-muted-foreground">{timeOf(entry.at)}</span>
        <Badge variant="outline" className={cn("text-[10px]", gate.className)}>
          {gate.label}
          {entry.gate === "pending" && entry.progress ? ` ${entry.progress.hits}/${entry.progress.need}` : ""}
        </Badge>
        {entry.anchor ? (
          <Badge variant="outline" className="border-primary/40 bg-primary/10 text-[10px] text-primary">
            记忆锚点
          </Badge>
        ) : null}
        {entry.repeat > 1 ? <span className="font-mono text-[10px] text-muted-foreground">×{entry.repeat}</span> : null}
        {entry.eventId ? <span className="font-mono text-[10px] text-muted-foreground">{entry.eventId}</span> : null}
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {entry.hits.map((tag, index) => (
          <li
            key={`${tag.prompt}-${index}`}
            title={`${tag.prompt} · ${visionRoleLabel(tag.role)}`}
            className="flex items-center gap-1 rounded-md border border-border bg-secondary px-1.5 py-0.5 text-xs"
          >
            <span>{tag.label}</span>
            <span className="font-mono text-[10px] text-muted-foreground">{Math.round(tag.confidence * 100)}%</span>
          </li>
        ))}
      </ul>
      {entry.reasons.length > 0 ? <p className="text-xs leading-relaxed text-muted-foreground">{entry.reasons.join("；")}</p> : null}
    </li>
  )
}

export function HitLog() {
  const { cameraId } = usePerception()
  const [onlyCurrent, setOnlyCurrent] = React.useState(true)
  const { data, error } = useSWR<VisionHitsResponse>(VISION_ENDPOINTS.hits, getJson, { refreshInterval: 2000, keepPreviousData: true })

  const entries = (data?.hitLog ?? []).filter((entry) => !onlyCurrent || entry.streamId === cameraId)
  const stream = data?.streams.find((item) => item.id === cameraId)

  const health = !data
    ? error
      ? "初筛日志加载失败"
      : "加载中…"
    : !data.online
      ? data.message || "视觉服务未运行"
      : !stream
        ? "该通道尚未被视觉服务接入"
        : !stream.online
          ? `通道离线${stream.error ? `：${stream.error}` : ""}`
          : `帧缓冲 ${stream.ringFrames} 帧 · ${stream.zones > 0 ? `${stream.zones} 个围栏` : "全局检测模式（未配置围栏）"} · 人员 ${stream.persons} · 词表目标 ${stream.subjects}${stream.rawTop && !stream.rawTop.vocabSynced ? " · 词表未同步到模型" : ""}`

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="gap-1 border-b px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Radio className="size-4 text-primary" aria-hidden="true" />
            初筛命中日志
          </CardTitle>
          <div className="flex items-center gap-2">
            <Switch id="hitlog-current" size="sm" checked={onlyCurrent} onCheckedChange={setOnlyCurrent} />
            <Label htmlFor="hitlog-current" className="text-xs font-normal">
              仅当前通道
            </Label>
          </div>
        </div>
        <CardDescription className="text-xs">{health}</CardDescription>
      </CardHeader>
      <div className="scrollbar-thin max-h-64 overflow-y-auto" aria-live="polite">
        {entries.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">暂无记录。视觉服务每次推理后都会在这里写入检出或「Gate 0 无检出」原因。</p>
        ) : (
          <ul className="divide-y divide-border">
            {entries.map((entry) => (
              <HitRow key={entry.id} entry={entry} />
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}
