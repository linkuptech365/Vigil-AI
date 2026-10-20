"use client"

import { FileVideo, FolderOpen, Play, RotateCw, ScanEye, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Spinner } from "@/components/ui/spinner"
import { formatDuration, formatSize } from "@/lib/vigil/data"
import { RULES } from "@/lib/vigil/rules"
import { VideoStatusBadge } from "../status-badges"
import { useVigil } from "../vigil-provider"

export function QueueTable() {
  const { queue, analyzeOne, removeVideo, setSelectedId, setActiveTab, batchRunning } =
    useVigil()

  if (queue.length === 0) {
    return (
      <Empty className="rounded-xl border border-dashed border-border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileVideo />
          </EmptyMedia>
          <EmptyTitle>检测队列为空</EmptyTitle>
          <EmptyDescription>
            前往「配置」同步视频目录，或点击上方「注入测试样本」快速体验。
          </EmptyDescription>
        </EmptyHeader>
        <Button variant="outline" onClick={() => setActiveTab("config")}>
          <FolderOpen data-icon="inline-start" />
          前往配置
        </Button>
      </Empty>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">视频文件</TableHead>
            <TableHead className="hidden md:table-cell">时长 / 大小</TableHead>
            <TableHead>状态</TableHead>
            <TableHead className="hidden sm:table-cell">置信度</TableHead>
            <TableHead className="pr-4 text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {queue.map((video) => {
            const analyzing = video.status === "analyzing"
            const done = video.status === "safe" || video.status === "alert"
            return (
              <TableRow
                key={video.id}
                data-state={video.status === "alert" ? "selected" : undefined}
              >
                <TableCell className="max-w-0 pl-4 lg:max-w-md">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate font-mono text-sm font-medium" title={video.name}>
                      {video.name}
                    </span>
                    <span
                      className="truncate font-mono text-xs text-muted-foreground"
                      title={video.path}
                    >
                      {video.path}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="hidden font-mono text-sm text-muted-foreground md:table-cell">
                  {formatDuration(video.durationSec)} · {formatSize(video.sizeMB)}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col items-start gap-1">
                    <VideoStatusBadge status={video.status} />
                    {video.status === "alert" && video.ruleId && (
                      <span className="text-xs text-destructive">
                        {RULES[video.ruleId].scenarioLabel}
                      </span>
                    )}
                    {video.status === "safe" && video.suppressedReason && (
                      <span className="max-w-56 text-xs text-warning">已抑制</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="hidden font-mono text-sm sm:table-cell">
                  {video.confidence !== undefined ? `${Math.round(video.confidence * 100)}%` : "—"}
                </TableCell>
                <TableCell className="pr-4">
                  <div className="flex items-center justify-end gap-1">
                    {done ? (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedId(video.id)}
                        >
                          <ScanEye data-icon="inline-start" />
                          <span className="hidden lg:inline">研判详情</span>
                          <span className="lg:hidden">详情</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`重新分析 ${video.name}`}
                          disabled={batchRunning}
                          onClick={() => void analyzeOne(video)}
                        >
                          <RotateCw />
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={analyzing || batchRunning}
                        onClick={() => void analyzeOne(video)}
                      >
                        {analyzing ? (
                          <Spinner data-icon="inline-start" />
                        ) : (
                          <Play data-icon="inline-start" />
                        )}
                        {analyzing ? "分析中" : "开始分析"}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`移除 ${video.name}`}
                      disabled={analyzing}
                      onClick={() => removeVideo(video.id)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
