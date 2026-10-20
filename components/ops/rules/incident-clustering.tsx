"use client"

import * as React from "react"
import { ArrowRightLeft, Layers, LocateFixed, PackageOpen, TriangleAlert } from "lucide-react"
import useSWR from "swr"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { CAMERAS } from "@/lib/ops/data"
import type { ClusteredIncidentResponse } from "@/lib/ops/rules-api-types"
import { CLUSTER_ENDPOINT, getJson } from "@/lib/ops/rules-client"
import type { EvidenceTrigger } from "@/lib/ops/rules-types"
import type { OverlayBox } from "@/lib/ops/types"
import { OverlayBoxes } from "../overlay-boxes"

const CLUSTER_REFRESH_MS = 8000

const KEYFRAME_BOX: Record<string, OverlayBox> = {
  "CAM-01": { x: 66, y: 42, w: 8, h: 43, tone: "warn", label: "#1187 ENTER" },
  "CAM-02": { x: 70.5, y: 53, w: 10.5, h: 36, tone: "critical", pulse: true, label: "#1187 REDLINE" },
}

const ROLE_META: Record<EvidenceTrigger["role"], { label: string; className: string }> = {
  primary: { label: "主事件", className: "border-destructive/50 text-destructive" },
  correlated: { label: "关联机位", className: "border-signal/50 text-signal" },
  folded: { label: "已折叠", className: "text-muted-foreground" },
}

function cameraOf(id: string) {
  return CAMERAS.find((camera) => camera.id === id)
}

function ClusteringPlaceholder({ loading, failed }: { loading: boolean; failed: boolean }) {
  return (
    <Card className="gap-4 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">多机位时空关联 (Spatial-Temporal Correlation)</CardTitle>
        <CardDescription>
          {failed ? "聚类引擎暂时不可用，将自动重试。" : "服务端尚未检测到跨机位关联事件。"}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4">
        {loading ? (
          <div className="flex flex-col gap-3" aria-busy="true" aria-label="正在加载聚类结果">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-dashed border-border p-4 text-xs text-muted-foreground">
            <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
            {failed ? "请检查 /api/v1/rules/cluster 服务状态。" : "相邻机位在时间窗内同时命中同类事件后，会在此处自动合并为一张工单。"}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

interface IncidentClusteringProps {
  onLocate: (channelId: string) => void
}

export function IncidentClustering({ onLocate }: IncidentClusteringProps) {
  const [evidenceOpen, setEvidenceOpen] = React.useState(false)
  const { data, error, isLoading } = useSWR<ClusteredIncidentResponse>(CLUSTER_ENDPOINT, getJson, {
    refreshInterval: CLUSTER_REFRESH_MS,
  })
  const incident = data?.primary

  if (!incident) {
    return <ClusteringPlaceholder loading={isLoading} failed={Boolean(error) && !data} />
  }

  const windowSeconds = data.windowSeconds
  const clustered = [incident.primaryChannelId, ...incident.relatedChannelIds]
    .map((id) => cameraOf(id)?.code ?? id)
    .sort()
  const firstTs = incident.dualKeyframes[0]?.timestamp
  const lastTs = incident.dualKeyframes[incident.dualKeyframes.length - 1]?.timestamp

  return (
    <Card className="gap-4 py-4">
      <CardHeader className="px-4">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="font-mono">
              {incident.incidentId}
            </Badge>
            <Badge variant="outline" className="border-signal/40 text-signal">
              <Layers aria-hidden="true" />
              跨机位聚合
            </Badge>
          </div>
          <CardTitle className="text-sm">多机位时空关联 (Spatial-Temporal Correlation)</CardTitle>
          <CardDescription>
            {incident.title}。{clustered.join(" + ")} 在 {windowSeconds} 秒窗口内命中同一目标轨迹，
            合并为一张工单。
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 px-4">
        <dl className="grid grid-cols-3 gap-2 text-xs">
          <div className="flex flex-col gap-0.5 rounded-md border border-border bg-background p-2">
            <dt className="text-muted-foreground">起始时间</dt>
            <dd className="font-mono tabular-nums">{incident.startTime}</dd>
          </div>
          <div className="flex flex-col gap-0.5 rounded-md border border-border bg-background p-2">
            <dt className="text-muted-foreground">事件时长</dt>
            <dd className="font-mono tabular-nums">{incident.durationSeconds}s</dd>
          </div>
          <div className="flex flex-col gap-0.5 rounded-md border border-border bg-background p-2">
            <dt className="text-muted-foreground">折叠原始触发</dt>
            <dd className="font-mono tabular-nums">{incident.rawTriggersFolded} 次</dd>
          </div>
        </dl>

        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
            {incident.dualKeyframes.map((frame, index) => {
              const camera = cameraOf(frame.channelId)
              return (
                <React.Fragment key={frame.channelId}>
                  {index === 1 && (
                    <div
                      className="flex items-center justify-center gap-1.5 text-muted-foreground sm:flex-col"
                      aria-label={`目标由 ${incident.dualKeyframes[0].channelId} 移交至 ${frame.channelId}`}
                    >
                      <ArrowRightLeft className="size-4" aria-hidden="true" />
                      <span className="font-mono text-[10px]">
                        {firstTs} - {lastTs}
                      </span>
                    </div>
                  )}
                  <figure className="flex min-w-0 flex-col gap-1.5">
                    <div className="relative aspect-video overflow-hidden rounded-md border border-border bg-black">
                      <img
                        src={frame.thumbnail}
                        alt={`${frame.channelId} ${camera?.name ?? ""} 同步关键帧`}
                        className="size-full object-cover"
                      />
                      {KEYFRAME_BOX[frame.channelId] && (
                        <OverlayBoxes boxes={[KEYFRAME_BOX[frame.channelId]]} labelSize="xs" />
                      )}
                      <span className="absolute left-1.5 top-1.5 rounded-sm bg-background/80 px-1.5 py-0.5 font-mono text-[10px]">
                        {frame.channelId}
                      </span>
                    </div>
                    <figcaption className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="truncate text-muted-foreground">{camera?.name}</span>
                      <span className="shrink-0 font-mono tabular-nums">{frame.timestamp}</span>
                    </figcaption>
                  </figure>
                </React.Fragment>
              )
            })}
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-lg border border-border bg-background p-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-xs text-muted-foreground">时空轨迹吻合度 (Spatial Affinity Score)</p>
            <p className="font-mono text-lg font-semibold tabular-nums text-success">
              {incident.spatialAffinity.toFixed(1)}%
            </p>
          </div>
          <Progress value={incident.spatialAffinity} aria-label="时空轨迹吻合度" />
          <ul className="flex flex-col gap-1.5">
            {incident.factors.map((factor) => (
              <li key={factor.key} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="text-muted-foreground">{factor.label}</span>
                <span className="font-mono tabular-nums">{factor.value.toFixed(1)}%</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" onClick={() => setEvidenceOpen(true)}>
            <PackageOpen data-icon="inline-start" />
            查看完整聚合证据包 (Open Clustered Evidence)
          </Button>
          <Button type="button" variant="outline" onClick={() => onLocate(incident.primaryChannelId)}>
            <LocateFixed data-icon="inline-start" />
            定位主机位
          </Button>
        </div>
      </CardContent>

      <Dialog open={evidenceOpen} onOpenChange={setEvidenceOpen}>
        <DialogContent className="flex max-h-[88svh] flex-col gap-4 sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>聚合证据包 {incident.incidentId}</DialogTitle>
            <DialogDescription>
              {incident.title}。共 {incident.evidence.length} 段触发证据，其中 {incident.rawTriggersFolded} 次原始触发已折叠，仅生成 1 张工单。
            </DialogDescription>
          </DialogHeader>
          <div className="scrollbar-thin min-h-0 flex-1 overflow-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead>通道</TableHead>
                  <TableHead>规则</TableHead>
                  <TableHead>角色</TableHead>
                  <TableHead>说明</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {incident.evidence.map((row) => {
                  const role = ROLE_META[row.role]
                  return (
                    <TableRow key={`${row.time}-${row.channelId}-${row.note}`}>
                      <TableCell className="font-mono text-xs tabular-nums">{row.time}</TableCell>
                      <TableCell className="font-mono text-xs">{row.channelId}</TableCell>
                      <TableCell className="font-mono text-xs">{row.rule}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={role.className}>
                          {role.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-normal text-xs leading-relaxed">{row.note}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
