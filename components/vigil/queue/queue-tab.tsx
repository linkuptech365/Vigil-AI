"use client"

import * as React from "react"
import { FlaskConical, ListX, Play, SearchX } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { GMP_SUITE_LABEL } from "@/lib/ops/gmp-suite"
import { useVigil } from "../vigil-provider"
import { QueueTable } from "./queue-table"
import { QueueToolbar } from "./queue-toolbar"
import { TerminalConsole } from "./terminal-console"
import { useQueueViewMode } from "./use-queue-view-mode"
import { VideoGrid } from "./video-grid"

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-card px-4 py-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`font-mono text-2xl font-semibold ${tone ?? ""}`}>{value}</span>
    </div>
  )
}

export function QueueTab() {
  const { queue, loadGmpSuite, loadingGmp, scanning, clearQueue, analyzeAll, batchRunning } = useVigil()

  const [viewMode, setViewMode] = useQueueViewMode()
  const [query, setQuery] = React.useState("")

  const visible = React.useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return queue
    return queue.filter(
      (v) => v.name.toLowerCase().includes(keyword) || v.path.toLowerCase().includes(keyword)
    )
  }, [queue, query])

  const pending = queue.filter((v) => v.status === "pending").length
  const alerts = queue.filter((v) => v.status === "alert").length
  const safe = queue.filter((v) => v.status === "safe").length

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:flex-1 lg:max-w-xl">
          <Stat label="队列总数" value={queue.length} />
          <Stat label="待分析" value={pending} />
          <Stat label="触发预警" value={alerts} tone="text-destructive" />
          <Stat label="正常安全" value={safe} tone="text-success" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => void loadGmpSuite()}
            disabled={batchRunning || loadingGmp || scanning}
          >
            {loadingGmp || scanning ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <FlaskConical data-icon="inline-start" />
            )}
            {GMP_SUITE_LABEL}
          </Button>
          <Button
            variant="outline"
            onClick={clearQueue}
            disabled={batchRunning || queue.length === 0}
          >
            <ListX data-icon="inline-start" />
            清空队列
          </Button>
          <Button onClick={() => void analyzeAll()} disabled={batchRunning || pending === 0}>
            {batchRunning ? <Spinner data-icon="inline-start" /> : <Play data-icon="inline-start" />}
            {batchRunning ? "批量分析中..." : `全量分析 (${pending})`}
          </Button>
        </div>
      </div>

      {queue.length > 0 && (
        <QueueToolbar
          query={query}
          onQueryChange={setQuery}
          mode={viewMode}
          onModeChange={setViewMode}
          total={queue.length}
          shown={visible.length}
        />
      )}

      {queue.length === 0 ? (
        <QueueTable />
      ) : visible.length === 0 ? (
        <Empty className="rounded-xl border border-dashed border-border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchX />
            </EmptyMedia>
            <EmptyTitle>没有匹配的视频</EmptyTitle>
            <EmptyDescription>换一个关键词，或清除搜索框中的内容。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : viewMode === "grid" ? (
        <VideoGrid videos={visible} />
      ) : (
        <QueueTable videos={visible} />
      )}
      <TerminalConsole />
    </div>
  )
}
