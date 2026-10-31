"use client"

import { Grid2x2, ListVideo, PanelLeft, ScanEye, Settings2, Square, VideoOff } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { Toggle } from "@/components/ui/toggle"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { LiveFeed, useVisible } from "@/components/vigil/streams/live-wall"
import { useStableStreams } from "@/components/vigil/streams/use-stable-streams"
import { useStreams } from "@/components/vigil/streams/use-streams"
import { useVision } from "@/components/vigil/streams/use-vision"
import { useVigil } from "@/components/vigil/vigil-provider"
import type { StreamView } from "@/lib/vigil/streams"
import { cn } from "@/lib/utils"
import { StreamPicker } from "./stream-picker"
import { StreamTile } from "./stream-tile"
import { type GridLayout, useOps } from "./ops-provider"

/** 浏览器对同一主机的 HTTP/1.1 并发连接有限，同屏最多保持 4 路 MJPEG 长连接，其余路用快照轮询。 */
const MAX_LIVE_TILES = 4

function Thumb({ stream, onClick }: { stream: StreamView; onClick: () => void }) {
  const [ref, visible] = useVisible<HTMLButtonElement>()
  return (
    <button
      ref={ref}
      type="button"
      role="tab"
      aria-selected={false}
      onClick={onClick}
      className={cn(
        "group flex items-center gap-2 rounded-lg border border-border bg-card p-2 text-left outline-none transition-colors hover:border-signal/60 focus-visible:ring-2 focus-visible:ring-ring"
      )}
    >
      <span className="pointer-events-none aspect-video w-16 shrink-0 overflow-hidden rounded bg-muted sm:w-24">
        {stream.status === "offline" ? (
          <span className="flex size-full items-center justify-center text-muted-foreground">
            <VideoOff className="size-4" aria-hidden="true" />
          </span>
        ) : (
          <LiveFeed stream={stream} live={false} active={visible} />
        )}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-xs font-semibold text-signal">{stream.name}</span>
        <span className="truncate text-xs text-muted-foreground">{stream.zone}</span>
      </span>
    </button>
  )
}

export function MonitorGrid() {
  const { layout, setLayout, focusId, focusCamera, showOverlays, toggleOverlays, visibleStreamIds, setVisibleStreamIds } =
    useOps()
  const { setActiveTab } = useVigil()
  const { streams: rawStreams, loading, loadError } = useStreams()
  const { streams, reconnectingIds } = useStableStreams(rawStreams)
  const { engine: vision } = useVision()
  const visionAvailable = vision?.status === "ready" || vision?.status === "degraded"
  const annotated = showOverlays && visionAvailable

  const shown = visibleStreamIds === null ? streams : streams.filter((s) => visibleStreamIds.includes(s.id))
  const focused = shown.find((s) => s.id === focusId) ?? shown[0]
  const others = shown.filter((s) => s.id !== focused?.id)

  const liveIds = new Set<string>()
  const livePool = layout === "single" ? (focused ? [focused] : []) : layout === "focus" && focused ? [focused, ...others] : shown
  for (const s of livePool) {
    if (liveIds.size >= MAX_LIVE_TILES) break
    if (s.status === "online") liveIds.add(s.id)
  }

  const hide = (id: string) => {
    const base = visibleStreamIds ?? streams.map((s) => s.id)
    setVisibleStreamIds(base.filter((x) => x !== id))
  }

  const renderTile = (stream: StreamView, size: "lg" | "sm", className: string) => (
    <StreamTile
      key={stream.id}
      stream={stream}
      live={liveIds.has(stream.id)}
      annotated={annotated}
      size={size}
      reconnecting={reconnectingIds.has(stream.id)}
      className={className}
      onFocus={layout === "focus" && stream.id !== focused?.id ? () => focusCamera(stream.id) : undefined}
      onMaximize={layout !== "single" ? () => focusCamera(stream.id, { single: true }) : undefined}
      onHide={() => hide(stream.id)}
    />
  )

  const emptyState = () => {
    if (loading && streams.length === 0) {
      return (
        <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
          <Spinner /> 正在读取监控通道…
        </div>
      )
    }
    if (loadError) {
      return (
        <Empty className="rounded-xl border border-dashed border-border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <VideoOff />
            </EmptyMedia>
            <EmptyTitle>读取监控通道失败</EmptyTitle>
            <EmptyDescription>服务端暂时没有响应，稍后会自动重试。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )
    }
    if (streams.length === 0) {
      return (
        <Empty className="rounded-xl border border-dashed border-border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <VideoOff />
            </EmptyMedia>
            <EmptyTitle>还没有接入摄像头</EmptyTitle>
            <EmptyDescription>到「配置」页添加 RTSP 地址，真实画面会自动出现在这里。</EmptyDescription>
          </EmptyHeader>
          <Button onClick={() => setActiveTab("config")}>
            <Settings2 data-icon="inline-start" />
            前往接入
          </Button>
        </Empty>
      )
    }
    return (
      <Empty className="rounded-xl border border-dashed border-border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ListVideo />
          </EmptyMedia>
          <EmptyTitle>没有选择任何视频流</EmptyTitle>
          <EmptyDescription>从右上角「选择视频流」中勾选要在大屏显示的通道。</EmptyDescription>
        </EmptyHeader>
        <Button onClick={() => setVisibleStreamIds(null)}>显示全部通道</Button>
      </Empty>
    )
  }

  return (
    <section aria-labelledby="monitor-grid-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 id="monitor-grid-title" className="text-sm font-semibold">
            实时监控矩阵
          </h2>
          <span className="text-xs text-muted-foreground">
            {layout === "single" && focused ? `${focused.name} 全屏` : `${shown.length} 路通道`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {streams.length > 0 ? (
            <StreamPicker streams={streams} selectedIds={visibleStreamIds} onChange={setVisibleStreamIds} />
          ) : null}
          <Toggle
            variant="outline"
            size="sm"
            pressed={annotated}
            disabled={!visionAvailable}
            onPressedChange={toggleOverlays}
            aria-label="显示 AI 识别标注层"
          >
            <ScanEye />
            AI 标注层
          </Toggle>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={layout}
            onValueChange={(value) => value && setLayout(value as GridLayout)}
            aria-label="视频布局"
          >
            <ToggleGroupItem value="grid" aria-label="2×2 宫格">
              <Grid2x2 />
              2×2
            </ToggleGroupItem>
            <ToggleGroupItem value="focus" aria-label="焦点布局">
              <PanelLeft />
              1+N 焦点
            </ToggleGroupItem>
            <ToggleGroupItem value="single" aria-label="单通道全屏">
              <Square />
              单通道
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      {!focused ? (
        emptyState()
      ) : (
        <>
          {layout === "grid" && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {shown.map((stream) => renderTile(stream, "sm", "aspect-video"))}
            </div>
          )}

          {layout === "focus" && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3 md:grid-rows-3">
              {renderTile(focused, "lg", "aspect-video md:col-span-2 md:row-span-3 md:aspect-auto")}
              {others.map((stream) => renderTile(stream, "sm", "aspect-video"))}
            </div>
          )}

          {layout === "single" && (
            <div className="flex flex-col gap-3">
              {renderTile(focused, "lg", "aspect-video")}
              {others.length > 0 ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" role="tablist" aria-label="切换通道">
                  {others.map((stream) => (
                    <Thumb key={stream.id} stream={stream} onClick={() => focusCamera(stream.id)} />
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </>
      )}
    </section>
  )
}
