"use client"

import * as React from "react"
import { ArrowRight, ShieldAlert } from "lucide-react"

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { CAMERAS } from "@/lib/ops/data"
import { allowedAngle, midpoint } from "@/lib/ops/perception-geometry"
import type { RoiZone, TrackedEntity } from "@/lib/ops/perception-types"
import { cn } from "@/lib/utils"
import { usePerception, useTracking } from "./perception-provider"

type Tone = "success" | "primary" | "warning" | "destructive"

const TONE: Record<Tone, { box: string; tag: string; stroke: string }> = {
  success: {
    box: "border-success shadow-success/40",
    tag: "bg-success text-black",
    stroke: "var(--success)",
  },
  primary: {
    box: "border-primary shadow-primary/40",
    tag: "bg-primary text-primary-foreground",
    stroke: "var(--primary)",
  },
  warning: {
    box: "border-warning bg-warning/10 shadow-warning/40",
    tag: "bg-warning text-black",
    stroke: "var(--warning)",
  },
  destructive: {
    box: "border-destructive bg-destructive/15 shadow-destructive/50",
    tag: "bg-destructive text-white",
    stroke: "var(--destructive)",
  },
}

const CLASS_LABEL = {
  person: "Person",
  vehicle: "Vehicle",
  forklift: "Forklift",
  hazard: "Hazard",
} as const

function toneOf(entity: TrackedEntity): Tone {
  if (entity.breaching) return "destructive"
  if (entity.isViolating) return "warning"
  if (entity.class === "forklift" || entity.class === "vehicle") return "primary"
  return "success"
}

interface Toggles {
  trails: boolean
  labels: boolean
  roi: boolean
}

interface ControlsProps {
  idPrefix: string
  toggles: Toggles
  onToggle: (key: keyof Toggles, value: boolean) => void
  className?: string
}

function CanvasControls({ idPrefix, toggles, onToggle, className }: ControlsProps) {
  const { cameraId, setCameraId } = usePerception()
  const rows: { key: keyof Toggles; label: string }[] = [
    { key: "trails", label: "显示目标轨迹 (Motion Trails)" },
    { key: "labels", label: "显示置信度标签 (Labels)" },
    { key: "roi", label: "显示电子围栏图层 (ROI Mesh)" },
  ]

  return (
    <div
      className={cn(
        "flex flex-col gap-2.5 rounded-lg border border-white/15 bg-black/75 p-3 text-xs text-white backdrop-blur",
        className
      )}
    >
      <Select value={cameraId} onValueChange={setCameraId}>
        <SelectTrigger size="sm" className="w-full" aria-label="切换摄像头通道">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {CAMERAS.map((cam) => (
              <SelectItem key={cam.id} value={cam.id}>
                {cam.code} {cam.name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {rows.map((row) => (
        <div key={row.key} className="flex items-center justify-between gap-3">
          <Label htmlFor={`${idPrefix}-${row.key}`} className="text-xs font-normal">
            {row.label}
          </Label>
          <Switch
            id={`${idPrefix}-${row.key}`}
            size="sm"
            checked={toggles[row.key]}
            onCheckedChange={(value) => onToggle(row.key, value)}
          />
        </div>
      ))}
    </div>
  )
}

function polygonClip(coords: [number, number][]) {
  return `polygon(${coords.map(([x, y]) => `${x}% ${y}%`).join(", ")})`
}

function shortName(zone: RoiZone) {
  return zone.name.split(" (")[0]
}

function RoiLayer({
  zones,
  runtime,
}: {
  zones: RoiZone[]
  runtime: Record<string, { breached: boolean } | undefined>
}) {
  const active = zones.filter((z) => z.enabled)

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {active
        .filter((z) => z.type === "polygon")
        .map((zone) => {
          const breached = Boolean(runtime[zone.id]?.breached)
          const color = breached ? "var(--destructive)" : zone.color
          return (
            <div
              key={zone.id}
              className={cn("absolute inset-0", breached && "animate-pulse")}
              style={{
                clipPath: polygonClip(zone.coordinates),
                backgroundColor: `color-mix(in oklab, ${color} ${breached ? 38 : 16}%, transparent)`,
                backgroundImage: `repeating-linear-gradient(0deg, color-mix(in oklab, ${color} 60%, transparent) 0 1px, transparent 1px 16px), repeating-linear-gradient(90deg, color-mix(in oklab, ${color} 60%, transparent) 0 1px, transparent 1px 16px)`,
              }}
            />
          )
        })}

      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="absolute inset-0 size-full overflow-visible"
      >
        {active.map((zone) => {
          const breached = Boolean(runtime[zone.id]?.breached)
          const color = breached ? "var(--destructive)" : zone.color
          if (zone.type === "polygon") {
            return (
              <polygon
                key={zone.id}
                points={zone.coordinates.map((p) => p.join(",")).join(" ")}
                fill="none"
                stroke={color}
                strokeWidth={breached ? 3 : 2}
                strokeDasharray={breached ? undefined : "6 4"}
                vectorEffect="non-scaling-stroke"
                className={cn(breached && "animate-pulse")}
              />
            )
          }
          const [a, b] = zone.coordinates
          return (
            <line
              key={zone.id}
              x1={a[0]}
              y1={a[1]}
              x2={b[0]}
              y2={b[1]}
              stroke={color}
              strokeWidth={breached ? 4 : 3}
              strokeDasharray={zone.directional ? undefined : "10 6"}
              vectorEffect="non-scaling-stroke"
              className={cn(breached && "animate-pulse")}
            />
          )
        })}
      </svg>

      {active.map((zone) => {
        const breached = Boolean(runtime[zone.id]?.breached)
        const color = breached ? "var(--destructive)" : zone.color
        const anchor =
          zone.type === "polygon"
            ? zone.coordinates.reduce((best, p) => (p[1] < best[1] ? p : best))
            : zone.coordinates[0]
        const [a, b] = zone.coordinates
        const mid = zone.type === "tripwire" ? midpoint(a, b) : null
        return (
          <React.Fragment key={zone.id}>
            <span
              className="absolute max-w-[40%] -translate-y-full truncate rounded-sm px-1 font-mono text-[10px] font-semibold leading-tight text-black"
              style={{
                left: `${Math.min(Math.max(anchor[0], 1), 70)}%`,
                top: `${Math.max(anchor[1], 4)}%`,
                backgroundColor: color,
              }}
            >
              {shortName(zone)}
              {breached ? " · BREACHED" : ""}
            </span>
            {zone.type === "tripwire" && zone.directional && mid && (
              <span
                className="absolute flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/70"
                style={{
                  left: `${mid[0]}%`,
                  top: `${mid[1]}%`,
                  color,
                  transform: `translate(-50%, -50%) rotate(${allowedAngle(a, b)}deg)`,
                }}
              >
                <ArrowRight className="size-4" />
              </span>
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}

function TrailLayer({ entities }: { entities: TrackedEntity[] }) {
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 size-full overflow-visible"
      aria-hidden="true"
    >
      {entities.map((entity) => {
        const [x, y, w, h] = entity.bbox
        const points = [...entity.trail, [x + w / 2, y + h / 2] as [number, number]]
        return (
          <polyline
            key={entity.id}
            points={points.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" ")}
            fill="none"
            stroke={TONE[toneOf(entity)].stroke}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeOpacity="0.85"
            vectorEffect="non-scaling-stroke"
          />
        )
      })}
    </svg>
  )
}

function BoxLayer({ entities, showLabels }: { entities: TrackedEntity[]; showLabels: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {entities.map((entity) => {
        const [x, y, w, h] = entity.bbox
        const tone = toneOf(entity)
        const pulse = entity.isViolating || entity.breaching
        return (
          <div
            key={entity.id}
            className={cn(
              "absolute border-2 shadow-[0_0_10px] transition-[left,top] duration-100 ease-linear",
              TONE[tone].box,
              pulse && "animate-pulse"
            )}
            style={{ left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%` }}
          >
            {showLabels && (
              <span
                className={cn(
                  "absolute bottom-full left-[-2px] mb-px whitespace-nowrap rounded-sm px-1 font-mono text-[10px] font-semibold leading-tight",
                  TONE[tone].tag
                )}
              >
                {`[ID: #${entity.trackId} | ${entity.label ?? CLASS_LABEL[entity.class]} | ${Math.round(entity.confidence)}%]`}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function TrackingCanvas() {
  const { cameraId, zones, zoneRuntime } = usePerception()
  const { entities } = useTracking()
  const [toggles, setToggles] = React.useState<Toggles>({ trails: true, labels: true, roi: true })

  const camera = CAMERAS.find((c) => c.id === cameraId) ?? CAMERAS[0]
  const list = entities[camera.id] ?? []
  const camZones = zones.filter((z) => z.cameraId === camera.id)
  const anyBreach = camZones.some((z) => z.enabled && zoneRuntime[z.id]?.breached)
  const banner = camZones.map((z) => zoneRuntime[z.id]?.message).find(Boolean)

  const onToggle = (key: keyof Toggles, value: boolean) =>
    setToggles((prev) => ({ ...prev, [key]: value }))

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="gap-1 border-b px-4 py-3">
        <CardTitle className="text-sm">实时检测与 ByteTrack 追踪 (Live Detection & Tracking)</CardTitle>
        <CardDescription className="text-xs">
          边缘轻量模型逐帧检测，目标 ID 跨帧保持；仅越界或异常片段进入二级大模型。
        </CardDescription>
      </CardHeader>

      <CanvasControls
        idPrefix="inline"
        toggles={toggles}
        onToggle={onToggle}
        className="m-3 border-border bg-secondary text-foreground md:hidden"
      />

      <div className="relative isolate aspect-[1408/768] w-full overflow-hidden bg-black">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={camera.image || "/placeholder.svg"}
          alt={`${camera.code} ${camera.name} 检测画面`}
          className="absolute inset-0 size-full object-cover"
          draggable={false}
        />
        {camera.maskTimestamp && (
          <div className="absolute left-0 top-0 h-[9%] w-[27%] bg-black/80 backdrop-blur-md" />
        )}
        <div className="cctv-scanlines pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/45 via-transparent to-black/55" />

        {toggles.roi && (
          <RoiLayer zones={camZones} runtime={zoneRuntime} />
        )}
        {toggles.trails && <TrailLayer entities={list} />}
        <BoxLayer entities={list} showLabels={toggles.labels} />

        {anyBreach && (
          <div
            className="pointer-events-none absolute inset-0 animate-pulse ring-4 ring-inset ring-destructive/70"
            aria-hidden="true"
          />
        )}

        <div className="absolute left-0 top-0 flex flex-col gap-1 p-2.5">
          <span className="w-fit rounded bg-black/70 px-1.5 py-0.5 font-mono text-xs font-semibold text-signal">
            {camera.code}
          </span>
          <span className="rounded bg-black/70 px-1.5 py-0.5 text-xs font-medium text-white">
            {camera.name}
          </span>
          <span className="w-fit rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white/80">
            YOLO-Nano + ByteTrack
          </span>
        </div>

        <CanvasControls
          idPrefix="overlay"
          toggles={toggles}
          onToggle={onToggle}
          className="absolute right-3 top-3 w-64 max-md:hidden"
        />

        <div className="absolute bottom-2.5 left-2.5 flex items-center gap-2 font-mono text-[10px] text-white">
          <span className="rounded bg-black/70 px-1.5 py-0.5">Tracks {list.length}</span>
          <span className="rounded bg-black/70 px-1.5 py-0.5">Edge 14ms</span>
          <span className="rounded bg-black/70 px-1.5 py-0.5">ROI {camZones.filter((z) => z.enabled).length}</span>
        </div>

        {banner && (
          <div
            role="alert"
            className="absolute inset-x-0 bottom-10 mx-auto flex w-fit max-w-[92%] items-center gap-2 rounded-lg border border-destructive bg-destructive px-3 py-1.5 text-xs font-semibold text-white shadow-lg"
          >
            <ShieldAlert className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{banner}</span>
          </div>
        )}
      </div>
    </Card>
  )
}
