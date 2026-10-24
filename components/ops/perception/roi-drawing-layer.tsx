"use client"

import * as React from "react"
import { Check, Undo2, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { Point } from "@/lib/ops/perception-geometry"
import { cn } from "@/lib/utils"
import { usePerception } from "./perception-provider"

const MAX_POLYGON_POINTS = 16

function clampPercent(value: number) {
  return Math.round(Math.min(100, Math.max(0, value)) * 100) / 100
}

/**
 * 叠在实时画面上的围栏编辑层：点击落点、拖动顶点微调位置。
 * 坐标一律为画面宽高的百分比，与视觉服务的判定坐标系一致。
 */
export function RoiDrawingLayer() {
  const { drawing, setDrawingPoints, commitDrawing, cancelDrawing } = usePerception()
  const layerRef = React.useRef<HTMLDivElement>(null)
  const draggingRef = React.useRef<number | null>(null)

  const toPoint = React.useCallback((event: React.PointerEvent): Point | null => {
    const rect = layerRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0 || rect.height === 0) return null
    return [
      clampPercent(((event.clientX - rect.left) / rect.width) * 100),
      clampPercent(((event.clientY - rect.top) / rect.height) * 100),
    ]
  }, [])

  if (!drawing) return null

  const isTripwire = drawing.type === "tripwire"
  const creating = drawing.zoneId === null
  const maxPoints = isTripwire ? 2 : MAX_POLYGON_POINTS
  const minPoints = isTripwire ? 2 : 3
  const { points } = drawing
  const ready = points.length >= minPoints

  const handleBackgroundDown = (event: React.PointerEvent) => {
    if (!creating || points.length >= maxPoints) return
    const point = toPoint(event)
    if (point) setDrawingPoints([...points, point])
  }

  const handleHandleDown = (event: React.PointerEvent, index: number) => {
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    draggingRef.current = index
  }

  const handleMove = (event: React.PointerEvent) => {
    const index = draggingRef.current
    if (index === null) return
    const point = toPoint(event)
    if (!point) return
    setDrawingPoints(points.map((p, i) => (i === index ? point : p)))
  }

  const handleUp = () => {
    draggingRef.current = null
  }

  const removePoint = (index: number) => {
    const floor = creating ? 0 : minPoints
    if (points.length <= floor) return
    setDrawingPoints(points.filter((_, i) => i !== index))
  }

  const hint = creating
    ? points.length < minPoints
      ? isTripwire
        ? `点击画面放置绊线端点（${points.length}/2）`
        : `点击画面依次放置顶点，至少 3 个（${points.length}/${MAX_POLYGON_POINTS}）`
      : isTripwire
        ? "拖动端点微调，确认后点“完成”"
        : "继续点击可增加顶点，拖动顶点微调，确认后点“完成”"
    : "拖动顶点调整围栏位置，双击顶点可删除（多边形至少保留 3 个）"

  return (
    <div
      ref={layerRef}
      className={cn("absolute inset-0 touch-none select-none", creating && points.length < maxPoints ? "cursor-crosshair" : "cursor-default")}
      onPointerDown={handleBackgroundDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden="true">
        {points.length >= 3 && !isTripwire && (
          <polygon
            points={points.map((p) => p.join(",")).join(" ")}
            fill="color-mix(in oklab, var(--primary) 22%, transparent)"
            stroke="var(--primary)"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {points.length >= 2 && (isTripwire || points.length < 3) && (
          <polyline
            points={points.map((p) => p.join(",")).join(" ")}
            fill="none"
            stroke="var(--primary)"
            strokeWidth={3}
            strokeDasharray="8 5"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>

      {points.map((point, index) => (
        <button
          key={index}
          type="button"
          aria-label={`顶点 ${index + 1}，拖动调整位置`}
          onPointerDown={(event) => handleHandleDown(event, index)}
          onDoubleClick={() => removePoint(index)}
          className="absolute flex size-5 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full border-2 border-white bg-primary font-mono text-[10px] font-semibold text-primary-foreground shadow-lg active:cursor-grabbing"
          style={{ left: `${point[0]}%`, top: `${point[1]}%` }}
        >
          {index + 1}
        </button>
      ))}

      <div
        className="absolute inset-x-0 bottom-3 mx-auto flex w-fit max-w-[94%] flex-wrap items-center justify-center gap-2 rounded-lg border border-white/15 bg-black/80 px-3 py-2 text-xs text-white backdrop-blur"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <span>{hint}</span>
        <div className="flex items-center gap-1.5">
          {creating && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={points.length === 0}
              onClick={() => setDrawingPoints(points.slice(0, -1))}
            >
              <Undo2 data-icon="inline-start" />
              撤销一点
            </Button>
          )}
          <Button type="button" size="sm" disabled={!ready} onClick={commitDrawing}>
            <Check data-icon="inline-start" />
            完成
          </Button>
          <Button type="button" size="sm" variant="outline" className="text-foreground" onClick={cancelDrawing}>
            <X data-icon="inline-start" />
            取消
          </Button>
        </div>
      </div>
    </div>
  )
}
