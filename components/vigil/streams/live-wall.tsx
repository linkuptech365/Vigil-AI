"use client"

import * as React from "react"
import { CameraOff, RefreshCw, ScanEye, Settings2, ShieldCheck, Siren, Video } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import type { StreamView } from "@/lib/vigil/streams"
import { useVigil } from "../vigil-provider"
import { AnnotationOverlay } from "./annotation-overlay"
import { EngineBanner } from "./engine-banner"
import { useVision } from "./use-vision"
import { VisionFunnel } from "./vision-funnel"
import { streamMjpegUrl, streamSnapshotUrl, useStreams, type StreamAnalysisOutcome } from "./use-streams"

/** 浏览器对同一主机的 HTTP/1.1 并发连接有限，同屏最多保持 4 路 MJPEG 长连接，其余路用快照轮询。 */
const MAX_LIVE_TILES = 4
const SNAPSHOT_REFRESH_MS = 3000
const RETRY_MS = 6000

export function useVisible<T extends Element>() {
  const ref = React.useRef<T>(null)
  const [visible, setVisible] = React.useState(false)
  React.useEffect(() => {
    const node = ref.current
    if (!node) return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.05 })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return [ref, visible] as const
}

export function LiveFeed({ stream, live, active }: { stream: StreamView; live: boolean; active: boolean }) {
  const [failed, setFailed] = React.useState(false)
  const [nonce, setNonce] = React.useState(() => Date.now())

  React.useEffect(() => {
    if (!active) return
    if (failed) {
      const timer = setTimeout(() => {
        setFailed(false)
        setNonce(Date.now())
      }, RETRY_MS)
      return () => clearTimeout(timer)
    }
    if (!live) {
      const timer = setInterval(() => setNonce(Date.now()), SNAPSHOT_REFRESH_MS)
      return () => clearInterval(timer)
    }
  }, [active, failed, live])

  if (!active) return <div className="size-full bg-muted" />

  if (failed) {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-2 bg-muted text-muted-foreground">
        <CameraOff className="size-6" aria-hidden="true" />
        <span className="text-xs">画面中断，正在自动重连…</span>
      </div>
    )
  }

  const src = live ? `${streamMjpegUrl(stream.id)}?t=${nonce}` : `${streamSnapshotUrl(stream.id)}?t=${nonce}`
  return (
    // MJPEG 长连接与快照都不适合 next/image 的优化管线
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={live ? "mjpeg" : "snapshot"}
      src={src}
      alt={`${stream.name} 实时画面`}
      className="size-full object-cover"
      onError={() => setFailed(true)}
    />
  )
}

function LiveTile({
  stream,
  live,
  analyzing,
  result,
  onAnalyze,
  visionAvailable,
}: {
  stream: StreamView
  live: boolean
  analyzing: boolean
  result?: StreamAnalysisOutcome
  onAnalyze: (id: string) => void
  visionAvailable: boolean
}) {
  const [ref, visible] = useVisible<HTMLDivElement>()
  const [annotated, setAnnotated] = React.useState(false)
  const showAnnotated = annotated && visionAvailable
  const online = stream.status === "online"
  const last = stream.lastAnalysis
  const alerting = result?.verdict === "alert" || (!result && last?.status === "alert")

  return (
    <li
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border bg-card",
        alerting ? "border-destructive/50" : "border-border"
      )}
    >
      <div ref={ref} className="relative aspect-video bg-muted">
        {stream.status === "offline" ? (
          <div className="flex size-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <CameraOff className="size-6" aria-hidden="true" />
            <span className="text-xs">通道离线</span>
          </div>
        ) : (
          <>
            <LiveFeed stream={stream} live={live} active={visible} />
            {showAnnotated ? <AnnotationOverlay streamId={stream.id} active={visible} /> : null}
          </>
        )}
        <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 bg-gradient-to-b from-background/80 to-transparent p-2">
          <Badge variant="outline" className="gap-1.5 border-border bg-background/80 font-mono text-xs">
            <span
              className={cn(
                "size-1.5 rounded-full",
                online ? "bg-success" : stream.status === "idle" ? "bg-warning" : "bg-destructive"
              )}
            />
            {online ? (live ? "实时" : "快照") : stream.status === "idle" ? "待命" : "离线"}
          </Badge>
          <div className="flex items-center gap-1.5">
            {stream.builtin ? (
              <Badge variant="outline" className="border-warning/40 bg-background/80 text-xs text-warning">
                模拟流
              </Badge>
            ) : null}
            {visionAvailable && stream.status !== "offline" ? (
              <Button
                size="xs"
                variant={showAnnotated ? "default" : "outline"}
                className="bg-background/80 data-[active=true]:bg-primary"
                data-active={showAnnotated}
                aria-pressed={showAnnotated}
                onClick={() => setAnnotated((prev) => !prev)}
              >
                <ScanEye data-icon="inline-start" />
                {showAnnotated ? "标注视图" : "原画"}
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold">{stream.name}</h3>
            <p className="truncate text-xs text-muted-foreground">{stream.zone}</p>
          </div>
          {stream.autoPatrol ? (
            <Badge variant="outline" className="shrink-0 border-primary/40 bg-primary/10 text-xs text-primary">
              自动巡检
            </Badge>
          ) : null}
        </div>

        <div className="min-h-10 text-xs leading-relaxed">
          {result ? (
            <p className={result.verdict === "alert" ? "text-destructive" : "text-success"}>{result.summary}</p>
          ) : last ? (
            <p className={last.status === "alert" ? "text-destructive" : "text-muted-foreground"}>
              <span className="font-mono">{new Date(last.at).toLocaleTimeString("zh-CN", { hour12: false })}</span>{" "}
              {last.status === "alert" ? `命中「${last.ruleName ?? "规则"}」` : last.summary || "最近一次研判未发现违规"}
            </p>
          ) : (
            <p className="text-muted-foreground">尚未研判。点击下方按钮，立即抓取多帧并交给模型分析。</p>
          )}
        </div>

        <Button size="sm" variant={alerting ? "destructive" : "outline"} onClick={() => onAnalyze(stream.id)} disabled={analyzing || stream.status === "offline"}>
          {analyzing ? <Spinner data-icon="inline-start" /> : <ScanEye data-icon="inline-start" />}
          {analyzing ? "研判中…" : "立即研判"}
        </Button>
      </div>
    </li>
  )
}

export function LiveWall() {
  const { setActiveTab } = useVigil()
  const { engine, streams, onlineCount, loading, loadError, analyzingIds, analyzeStream, engineAction } = useStreams()
  const { engine: vision, engineAction: visionAction } = useVision()
  const [results, setResults] = React.useState<Record<string, StreamAnalysisOutcome>>({})
  const visionAvailable = vision?.status === "ready" || vision?.status === "degraded"

  const handleAnalyze = React.useCallback(
    async (id: string) => {
      const outcome = await analyzeStream(id)
      if (outcome) setResults((prev) => ({ ...prev, [id]: outcome }))
    },
    [analyzeStream]
  )

  if (loading && streams.length === 0) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
        <Spinner /> 正在读取监控通道…
      </div>
    )
  }

  const liveIds = new Set(streams.filter((s) => s.status === "online").slice(0, MAX_LIVE_TILES).map((s) => s.id))

  return (
    <div className="flex flex-col gap-4">
      {engine ? <EngineBanner engine={engine} onAction={engineAction} /> : null}
      {vision ? <VisionFunnel vision={vision} onReset={() => void visionAction("reset-stats")} /> : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Video className="size-4 text-primary" aria-hidden="true" />
          共 <span className="font-mono text-foreground">{streams.length}</span> 路通道，在线{" "}
          <span className="font-mono text-success">{onlineCount}</span> 路
        </p>
        <Button size="sm" variant="outline" onClick={() => setActiveTab("config")}>
          <Settings2 data-icon="inline-start" />
          管理摄像头
        </Button>
      </div>

      {loadError ? (
        <Empty className="rounded-xl border border-dashed border-border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <RefreshCw />
            </EmptyMedia>
            <EmptyTitle>读取监控通道失败</EmptyTitle>
            <EmptyDescription>服务端暂时没有响应，稍后会自动重试。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : streams.length === 0 ? (
        <Empty className="rounded-xl border border-dashed border-border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ShieldCheck />
            </EmptyMedia>
            <EmptyTitle>还没有接入摄像头</EmptyTitle>
            <EmptyDescription>到「配置」页添加 RTSP 地址，画面会自动出现在这里。</EmptyDescription>
          </EmptyHeader>
          <Button onClick={() => setActiveTab("config")}>
            <Siren data-icon="inline-start" />
            前往接入
          </Button>
        </Empty>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {streams.map((stream) => (
            <LiveTile
              key={stream.id}
              stream={stream}
              live={liveIds.has(stream.id)}
              analyzing={analyzingIds.has(stream.id)}
              result={results[stream.id]}
              onAnalyze={handleAnalyze}
              visionAvailable={visionAvailable}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
