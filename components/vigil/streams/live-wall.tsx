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
import { useStableStreams } from "./use-stable-streams"
import { useVision } from "./use-vision"
import { VisionFunnel } from "./vision-funnel"
import { streamMjpegUrl, streamSnapshotUrl, useStreams, type StreamAnalysisOutcome } from "./use-streams"

/** 浏览器对同一主机的 HTTP/1.1 并发连接有限，同屏最多保持 4 路 MJPEG 长连接，其余路用快照轮询。 */
const MAX_LIVE_TILES = 4
const SNAPSHOT_REFRESH_MS = 3000
/** 断流后的指数退避重连间隔：1s、2s、4s，之后保持 4s */
const RETRY_BACKOFF_MS = [1000, 2000, 4000]
/** 判定“通道离线”需同时满足：连续失败次数 ≥ 4 且持续 15 秒无任何画面更新 */
const LOST_AFTER_FAILURES = 4
const LOST_AFTER_MS = 15_000
/** 已判定离线后仍在后台低频重连，恢复后自动消除离线状态 */
const LOST_RETRY_MS = 8000
/** MJPEG 连接看似存在、但画面超过该时长完全没有变化，视为挂起并静默重连 */
const STALL_AFTER_MS = 20_000
const WATCHDOG_INTERVAL_MS = 3000
const FREEZE_FRAME_WIDTH = 640

type FeedPhase = "ok" | "retrying" | "lost"

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

/**
 * 失败计数 + 指数退避重连。单次失败只进入“重试中”，
 * 只有连续多次失败且长时间没有成功画面，才升级为“离线”。
 */
function useFeedRetry(retry: () => void) {
  const [phase, setPhase] = React.useState<FeedPhase>("ok")
  const attempts = React.useRef(0)
  const lastOkAt = React.useRef<number | null>(null)
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const retryRef = React.useRef(retry)

  React.useEffect(() => {
    retryRef.current = retry
  }, [retry])

  React.useEffect(() => () => clearTimeout(timer.current), [])

  const succeed = React.useCallback(() => {
    attempts.current = 0
    lastOkAt.current = Date.now()
    clearTimeout(timer.current)
    timer.current = undefined
    setPhase("ok")
  }, [])

  const fail = React.useCallback(() => {
    if (timer.current !== undefined) return
    const now = Date.now()
    // 从未成功过的通道，以第一次失败的时间作为“无画面”的起点
    lastOkAt.current ??= now
    attempts.current += 1
    const count = attempts.current
    const lost = count >= LOST_AFTER_FAILURES && now - lastOkAt.current >= LOST_AFTER_MS
    setPhase(lost ? "lost" : "retrying")
    const delay = lost ? LOST_RETRY_MS : RETRY_BACKOFF_MS[Math.min(count - 1, RETRY_BACKOFF_MS.length - 1)]
    timer.current = setTimeout(() => {
      timer.current = undefined
      retryRef.current()
    }, delay)
  }, [])

  return { phase, succeed, fail }
}

function FeedNotice({ phase, hasFrame }: { phase: FeedPhase; hasFrame: boolean }) {
  if (phase === "ok") return null
  const lost = phase === "lost"
  const text = lost ? "通道离线，后台持续重连中…" : "连接重试中…"
  if (!hasFrame) {
    return (
      <div
        role="status"
        className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-muted text-muted-foreground"
      >
        {lost ? <CameraOff className="size-6" aria-hidden="true" /> : <Spinner className="size-5" />}
        <span className="text-xs">{text}</span>
      </div>
    )
  }
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <span
        role="status"
        className="flex items-center gap-1.5 rounded-full border border-border bg-background/85 px-2.5 py-1 text-xs text-foreground backdrop-blur"
      >
        {lost ? <CameraOff className="size-3.5" aria-hidden="true" /> : <Spinner className="size-3.5" />}
        {text}
      </span>
    </div>
  )
}

/** MJPEG 长连接：出错或挂起时保留最后一帧，后台静默重连，成功后无缝恢复。 */
function MjpegFeed({ streamId, name }: { streamId: string; name: string }) {
  const imgRef = React.useRef<HTMLImageElement>(null)
  const frameRef = React.useRef<HTMLCanvasElement | null>(null)
  const [nonce, setNonce] = React.useState(() => Date.now())
  const [freeze, setFreeze] = React.useState<string | null>(null)
  const reconnect = React.useCallback(() => setNonce(Date.now()), [])
  const { phase, succeed, fail } = useFeedRetry(reconnect)

  const captureFreeze = React.useCallback(() => {
    const canvas = frameRef.current
    if (!canvas || canvas.width === 0) return
    try {
      setFreeze(canvas.toDataURL("image/jpeg", 0.7))
    } catch {
      // 画布被污染时无法导出，退回到纯占位提示
    }
  }, [])

  // 每 3 秒缓存一帧（用于冻结画面），并比较缩略指纹：画面长时间完全不变说明连接已挂起
  React.useEffect(() => {
    const sampler = document.createElement("canvas")
    sampler.width = 16
    sampler.height = 9
    const samplerContext = sampler.getContext("2d", { willReadFrequently: true })
    let lastHash: number | null = null
    let lastChangeAt = Date.now()

    const timer = setInterval(() => {
      const img = imgRef.current
      if (!img || !samplerContext || !img.complete || img.naturalWidth === 0) return
      try {
        const frame = frameRef.current ?? (frameRef.current = document.createElement("canvas"))
        const height = Math.round((FREEZE_FRAME_WIDTH * img.naturalHeight) / img.naturalWidth)
        if (frame.width !== FREEZE_FRAME_WIDTH || frame.height !== height) {
          frame.width = FREEZE_FRAME_WIDTH
          frame.height = height
        }
        frame.getContext("2d")?.drawImage(img, 0, 0, frame.width, frame.height)

        samplerContext.drawImage(img, 0, 0, 16, 9)
        const pixels = samplerContext.getImageData(0, 0, 16, 9).data
        let hash = 0
        for (let i = 0; i < pixels.length; i += 1) hash = (hash * 31 + pixels[i]) | 0

        const now = Date.now()
        if (hash !== lastHash) {
          lastHash = hash
          lastChangeAt = now
          succeed()
          setFreeze(null)
        } else if (now - lastChangeAt >= STALL_AFTER_MS) {
          lastChangeAt = now
          reconnect()
        }
      } catch {
        // 无法读取像素（跨域/浏览器限制）时只依赖 onError 触发重连
      }
    }, WATCHDOG_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [reconnect, succeed])

  return (
    <div className="relative size-full bg-muted">
      {freeze ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={freeze}
          alt=""
          aria-hidden="true"
          className={cn("absolute inset-0 size-full object-cover", phase === "lost" && "opacity-60 grayscale")}
        />
      ) : null}
      {/* MJPEG 长连接不适合 next/image 的优化管线 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={`${streamMjpegUrl(streamId)}?t=${nonce}`}
        alt={`${name} 实时画面`}
        className={cn("absolute inset-0 size-full object-cover", phase !== "ok" && "opacity-0")}
        onLoad={() => {
          succeed()
          setFreeze(null)
        }}
        onError={() => {
          captureFreeze()
          fail()
        }}
      />
      <FeedNotice phase={phase} hasFrame={freeze !== null} />
    </div>
  )
}

/** 快照轮询：新帧加载成功才替换画面，失败时保留上一帧。 */
function SnapshotFeed({ streamId, name }: { streamId: string; name: string }) {
  const [src, setSrc] = React.useState<string | null>(null)
  const [tick, setTick] = React.useState(0)
  const currentUrl = React.useRef<string | null>(null)
  const nextFrame = React.useCallback(() => setTick((value) => value + 1), [])
  const { phase, succeed, fail } = useFeedRetry(nextFrame)

  React.useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined

    async function load() {
      try {
        const response = await fetch(`${streamSnapshotUrl(streamId)}?t=${Date.now()}`, {
          cache: "no-store",
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const blob = await response.blob()
        if (!blob.type.startsWith("image/")) throw new Error("不是有效的图片")
        if (controller.signal.aborted) return
        const objectUrl = URL.createObjectURL(blob)
        if (currentUrl.current) URL.revokeObjectURL(currentUrl.current)
        currentUrl.current = objectUrl
        setSrc(objectUrl)
        succeed()
        timer = setTimeout(nextFrame, SNAPSHOT_REFRESH_MS)
      } catch {
        if (!controller.signal.aborted) fail()
      }
    }
    void load()

    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [streamId, tick, succeed, fail, nextFrame])

  React.useEffect(
    () => () => {
      if (currentUrl.current) URL.revokeObjectURL(currentUrl.current)
    },
    []
  )

  return (
    <div className="relative size-full bg-muted">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={`${name} 实时画面`}
          className={cn("absolute inset-0 size-full object-cover", phase === "lost" && "opacity-60 grayscale")}
        />
      ) : null}
      <FeedNotice phase={phase} hasFrame={src !== null} />
    </div>
  )
}

export function LiveFeed({ stream, live, active }: { stream: StreamView; live: boolean; active: boolean }) {
  if (!active) return <div className="size-full bg-muted" />
  return live ? (
    <MjpegFeed key="mjpeg" streamId={stream.id} name={stream.name} />
  ) : (
    <SnapshotFeed key="snapshot" streamId={stream.id} name={stream.name} />
  )
}

function LiveTile({
  stream,
  live,
  reconnecting,
  analyzing,
  result,
  onAnalyze,
  visionAvailable,
}: {
  stream: StreamView
  live: boolean
  reconnecting: boolean
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
            {reconnecting ? "连接重试中" : online ? (live ? "实时" : "快照") : stream.status === "idle" ? "待命" : "离线"}
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
  const { engine, streams: rawStreams, onlineCount, loading, loadError, analyzingIds, analyzeStream, engineAction } =
    useStreams()
  const { streams, reconnectingIds } = useStableStreams(rawStreams)
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
            <EmptyDescription>服务端暂时没有响应，��后会自动重试。</EmptyDescription>
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
              reconnecting={reconnectingIds.has(stream.id)}
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
