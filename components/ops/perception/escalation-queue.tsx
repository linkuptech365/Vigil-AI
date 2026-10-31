"use client"

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { REASON_LABEL, STATUS_LABEL } from "@/lib/ops/perception-data"
import type { ClipStatus } from "@/lib/ops/perception-types"
import { cn } from "@/lib/utils"
import { usePerception } from "./perception-provider"

const STATUS_STYLE: Record<ClipStatus, string> = {
  sent: "border-success/40 bg-success/10 text-success",
  queued: "border-warning/40 bg-warning/10 text-warning animate-pulse",
  blocked: "border-border bg-muted text-muted-foreground",
}

export function EscalationQueue() {
  const { clips } = usePerception()

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="gap-1 border-b px-4 py-3">
        <CardTitle className="text-sm">候选切片送检队列 (Escalation Queue)</CardTitle>
        <CardDescription className="text-xs">
          一级初筛命中的片段会在此排队，经边缘打包后送往二级大模型深度研判；低置信度片段被直接拦截。
        </CardDescription>
      </CardHeader>
      <div className="scrollbar-thin max-h-80 overflow-y-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead className="pl-4">事件 ID</TableHead>
              <TableHead>触发通道</TableHead>
              <TableHead>初筛原因</TableHead>
              <TableHead className="text-right">初筛置信度</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="pr-4 text-right">边缘耗时</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clips.map((clip) => (
              <TableRow key={clip.id}>
                <TableCell className="pl-4">
                  <div className="flex flex-col">
                    <span className="font-mono text-xs font-medium">{clip.id}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{clip.time}</span>
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs">{clip.cameraId}</TableCell>
                <TableCell>
                  <Badge variant={clip.reason === "roi_breach" ? "destructive" : "secondary"}>
                    {REASON_LABEL[clip.reason]}
                  </Badge>
                </TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">{clip.confidence}%</TableCell>
                <TableCell>
                  <Badge variant="outline" className={cn(STATUS_STYLE[clip.status])}>
                    {STATUS_LABEL[clip.status]}
                  </Badge>
                </TableCell>
                <TableCell className="pr-4 text-right font-mono text-xs tabular-nums text-muted-foreground">
                  {clip.edgeMs}ms
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  )
}
