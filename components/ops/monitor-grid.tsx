"use client"

import { Grid2x2, PanelLeft, ScanEye, Square } from "lucide-react"

import { Toggle } from "@/components/ui/toggle"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { CAMERAS } from "@/lib/ops/data"
import { cn } from "@/lib/utils"
import { CameraTile } from "./camera-tile"
import { type GridLayout, useOps } from "./ops-provider"

export function MonitorGrid() {
  const { layout, setLayout, focusId, focusCamera, showOverlays, toggleOverlays } = useOps()
  const focused = CAMERAS.find((c) => c.id === focusId) ?? CAMERAS[0]
  const others = CAMERAS.filter((c) => c.id !== focused.id)

  return (
    <section aria-labelledby="monitor-grid-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 id="monitor-grid-title" className="text-sm font-semibold">
            实时监控矩阵
          </h2>
          <span className="font-mono text-xs text-muted-foreground">
            {layout === "single" ? `${focused.code} 全屏` : `${CAMERAS.length} 路通道`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        <Toggle
          variant="outline"
          size="sm"
          pressed={showOverlays}
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

      {layout === "grid" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {CAMERAS.map((camera) => (
            <CameraTile key={camera.id} camera={camera} size="sm" className="aspect-video" />
          ))}
        </div>
      )}

      {layout === "focus" && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 md:grid-rows-3">
          <CameraTile
            key={focused.id}
            camera={focused}
            size="lg"
            className="aspect-video md:col-span-2 md:row-span-3 md:aspect-auto"
          />
          {others.map((camera) => (
            <CameraTile key={camera.id} camera={camera} size="sm" className="aspect-video" />
          ))}
        </div>
      )}

      {layout === "single" && (
        <div className="flex flex-col gap-3">
          <CameraTile key={focused.id} camera={focused} size="lg" className="aspect-video" />
          <div className="grid grid-cols-3 gap-3" role="tablist" aria-label="切换通道">
            {others.map((camera) => (
              <button
                key={camera.id}
                type="button"
                role="tab"
                aria-selected={false}
                onClick={() => focusCamera(camera.id)}
                className={cn(
                  "group flex items-center gap-2 rounded-lg border border-border bg-card p-2 text-left outline-none transition-colors hover:border-signal/60 focus-visible:ring-2 focus-visible:ring-ring"
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={camera.image || "/placeholder.svg"}
                  alt=""
                  className="aspect-video w-16 shrink-0 rounded object-cover sm:w-24"
                />
                <span className="flex min-w-0 flex-col">
                  <span className="font-mono text-xs font-semibold text-signal">{camera.code}</span>
                  <span className="truncate text-xs text-muted-foreground">{camera.name}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
