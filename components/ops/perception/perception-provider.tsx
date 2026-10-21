"use client"

import * as React from "react"
import { toast } from "sonner"

import { CAMERAS } from "@/lib/ops/data"
import {
  lineSide,
  pathLength,
  pointInPolygon,
  projectOnSegment,
  samplePath,
  samplePingPong,
  type Point,
} from "@/lib/ops/perception-geometry"
import {
  AUTO_CLIP_TEMPLATES,
  ESCALATION_RATIO,
  INITIAL_CLIPS,
  INITIAL_METRICS,
  INITIAL_SERIES,
  INITIAL_ZONES,
  INTRUSION_PATH,
  RED_ZONE_ID,
  SCENES,
  VIOLATOR_ID,
} from "@/lib/ops/perception-data"
import type {
  ClipReason,
  EscalationClip,
  PerceptionMetrics,
  RoiAction,
  RoiSeverity,
  RoiShape,
  RoiZone,
  SeriesPoint,
  TrackedEntity,
  ZoneRuntime,
} from "@/lib/ops/perception-types"
import { isLocalChannelId, parseLocalChannelId } from "@/lib/ops/local-source"
import { playAlarm, shanghaiClock } from "@/lib/ops/utils"
import type { VideoItem } from "@/lib/vigil/types"
import { useVigil } from "@/components/vigil/vigil-provider"

const TICK_MS = 100
const TRAIL_EVERY = 3
const TRAIL_MAX = 10
const INTRUSION_SPEED = 6

export interface NewZoneInput {
  name: string
  type: RoiShape
  severity: RoiSeverity
  sensitivity: number
  action: RoiAction
}

interface TrackingContextValue {
  entities: Record<string, TrackedEntity[]>
}

interface PerceptionContextValue {
  /** CAM-xx 或 local:<videoId> */
  cameraId: string
  setCameraId: (id: string) => void
  localVideos: VideoItem[]
  selectedLocalVideo: VideoItem | undefined
  zones: RoiZone[]
  zoneRuntime: Record<string, ZoneRuntime>
  updateZone: (id: string, patch: Partial<RoiZone>) => void
  addZone: (input: NewZoneInput) => void
  removeZone: (id: string) => void
  clips: EscalationClip[]
  metrics: PerceptionMetrics
  series: SeriesPoint[]
  intrusionActive: boolean
  simulateIntrusion: () => void
}

const TrackingContext = React.createContext<TrackingContextValue | null>(null)
const PerceptionContext = React.createContext<PerceptionContextValue | null>(null)

export function useTracking() {
  const ctx = React.useContext(TrackingContext)
  if (!ctx) throw new Error("useTracking must be used within PerceptionProvider")
  return ctx
}

export function usePerception() {
  const ctx = React.useContext(PerceptionContext)
  if (!ctx) throw new Error("usePerception must be used within PerceptionProvider")
  return ctx
}

interface MotionState {
  dist: number
  override: { path: Point[]; dist: number; length: number } | null
}

interface ZoneEngineState {
  inside: Set<string>
  prevSide: Record<string, number>
  hot: Record<string, number>
  lastTriggerAt: number
  holdUntil: number
  count: number
  message: string | null
  messageUntil: number
}

function buildInitialEntities() {
  const result: Record<string, TrackedEntity[]> = {}
  for (const [cameraId, scripts] of Object.entries(SCENES)) {
    result[cameraId] = scripts.map((script) => {
      const foot =
        script.path.length > 1
          ? samplePingPong(script.path, script.startDist ?? 0)
          : script.path[0]
      const [w, h] = script.size
      return {
        id: script.id,
        trackId: script.trackId,
        class: script.class,
        bbox: [foot[0] - w / 2, foot[1] - h, w, h],
        confidence: script.confidence,
        trail: [],
        isViolating: Boolean(script.isViolating),
        label: script.label,
      }
    })
  }
  return result
}

function initialMotion() {
  const motion: Record<string, MotionState> = {}
  for (const scripts of Object.values(SCENES)) {
    for (const script of scripts) {
      motion[script.id] = { dist: script.startDist ?? 0, override: null }
    }
  }
  return motion
}

function freshZoneState(): ZoneEngineState {
  return {
    inside: new Set(),
    prevSide: {},
    hot: {},
    lastTriggerAt: 0,
    holdUntil: 0,
    count: 0,
    message: null,
    messageUntil: 0,
  }
}

function triggerMessage(zone: RoiZone) {
  const kind = zone.type === "polygon" ? "红线入侵触发" : "绊线越界触发"
  if (zone.action === "log") return `${kind}！仅记录日志，未送检`
  if (zone.action === "siren") return `${kind}！声光报警已启动，切片已推送至 VLM`
  return `${kind}！已自动打包切片推送至 VLM`
}

export function PerceptionProvider({ children }: { children: React.ReactNode }) {
  const [selectedSource, setSelectedSource] = React.useState("CAM-02")
  const { queue: localVideos } = useVigil()
  const selectedLocalVideo = isLocalChannelId(selectedSource)
    ? localVideos.find((v) => v.id === parseLocalChannelId(selectedSource))
    : undefined
  // 本地视频被移除后回落到默认摄像头，避免下拉框指向不存在的选项
  const cameraId = isLocalChannelId(selectedSource) && !selectedLocalVideo ? "CAM-02" : selectedSource
  const setCameraId = setSelectedSource
  const [zones, setZones] = React.useState<RoiZone[]>(INITIAL_ZONES)
  const [zoneRuntime, setZoneRuntime] = React.useState<Record<string, ZoneRuntime>>({})
  const [entities, setEntities] = React.useState(buildInitialEntities)
  const [clips, setClips] = React.useState<EscalationClip[]>(INITIAL_CLIPS)
  const [metrics, setMetrics] = React.useState<PerceptionMetrics>(INITIAL_METRICS)
  const [series, setSeries] = React.useState<SeriesPoint[]>(INITIAL_SERIES)
  const [intrusionActive, setIntrusionActive] = React.useState(false)

  const zonesRef = React.useRef(zones)
  const motionRef = React.useRef<Record<string, MotionState>>(initialMotion())
  const engineRef = React.useRef<Record<string, ZoneEngineState>>({})
  const trailRef = React.useRef<Record<string, [number, number][]>>({})
  const confRef = React.useRef<Record<string, number>>({})
  const runtimeKeyRef = React.useRef("")
  const clipCounterRef = React.useRef(409)
  const zoneCounterRef = React.useRef(0)

  React.useEffect(() => {
    zonesRef.current = zones
  }, [zones])

  const pushClip = React.useCallback(
    (clipCameraId: string, reason: ClipReason, confidence: number, forced?: "send" | "block") => {
      const status = forced === "block" || (!forced && confidence < 76) ? "blocked" : "queued"
      clipCounterRef.current += 1
      const clip: EscalationClip = {
        id: `CLP-${String(clipCounterRef.current).padStart(4, "0")}`,
        cameraId: clipCameraId,
        reason,
        confidence,
        status,
        edgeMs: 11 + Math.floor(Math.random() * 8),
        time: shanghaiClock(),
        queuedAt: status === "queued" ? Date.now() : undefined,
      }
      setClips((prev) => [clip, ...prev].slice(0, 40))
      if (status === "queued") {
        setMetrics((prev) => ({ ...prev, clips: prev.clips + 1 }))
      }
    },
    []
  )

  const fireZone = React.useCallback(
    (zone: RoiZone, state: ZoneEngineState, entity: TrackedEntity, now: number) => {
      state.holdUntil = now + (zone.type === "polygon" ? 2500 : 3000)
      if (zone.type === "tripwire") state.hot[entity.id] = now + 2500

      const cooldown = 16_000 - zone.sensitivity * 130
      if (now - state.lastTriggerAt < cooldown) return
      state.lastTriggerAt = now
      state.count += 1
      state.message = triggerMessage(zone)
      state.messageUntil = now + 6000

      const confidence = Math.min(Math.round(entity.confidence), 99)
      pushClip(zone.cameraId, "roi_breach", confidence, zone.action === "log" ? "block" : "send")

      if (zone.action !== "log") {
        toast.error(`${zone.cameraId} · ${zone.name.split(" (")[0]}`, {
          description: `目标 #${entity.trackId} ${entity.label ?? ""} ${state.message}`,
        })
      }
      if (zone.action === "siren") playAlarm()
    },
    [pushClip]
  )

  React.useEffect(() => {
    let last = Date.now()
    let tick = 0

    const id = window.setInterval(() => {
      const now = Date.now()
      const dt = Math.min((now - last) / 1000, 0.25)
      last = now
      tick += 1

      const next: Record<string, TrackedEntity[]> = {}
      let intrusionFinished = false

      for (const [camId, scripts] of Object.entries(SCENES)) {
        next[camId] = scripts.map((script) => {
          const motion = motionRef.current[script.id]
          let foot: Point

          if (motion.override) {
            motion.override.dist += INTRUSION_SPEED * dt
            if (motion.override.dist >= motion.override.length) {
              motion.override = null
              motion.dist = 0
              intrusionFinished = true
              foot = script.path[0]
            } else {
              foot = samplePath(motion.override.path, motion.override.dist)
            }
          } else {
            motion.dist += script.speed * dt
            foot =
              script.path.length > 1 ? samplePingPong(script.path, motion.dist) : script.path[0]
          }

          if (tick % 5 === 0 || confRef.current[script.id] === undefined) {
            confRef.current[script.id] = Math.min(
              99,
              Math.max(80, script.confidence + (Math.random() - 0.5) * 3)
            )
          }

          const [w, h] = script.size
          const bbox: [number, number, number, number] = [
            foot[0] - w / 2 + (Math.random() - 0.5) * 0.18,
            foot[1] - h + (Math.random() - 0.5) * 0.18,
            w,
            h,
          ]

          const trail = trailRef.current[script.id] ?? []
          if (tick % TRAIL_EVERY === 0) {
            trail.push([bbox[0] + w / 2, bbox[1] + h / 2])
            if (trail.length > TRAIL_MAX) trail.shift()
          }
          trailRef.current[script.id] = trail

          return {
            id: script.id,
            trackId: script.trackId,
            class: script.class,
            bbox,
            confidence: confRef.current[script.id],
            trail: [...trail],
            isViolating: Boolean(script.isViolating),
            label: script.label,
          }
        })
      }

      const snapshot: Record<string, ZoneRuntime> = {}
      for (const zone of zonesRef.current) {
        const state = (engineRef.current[zone.id] ??= freshZoneState())
        if (!zone.enabled) {
          snapshot[zone.id] = { breached: false, message: null, count: state.count }
          continue
        }

        const camEntities = next[zone.cameraId] ?? []
        let anyInside = false

        for (const entity of camEntities) {
          if (!zone.targets.includes(entity.class)) continue
          const foot: Point = [entity.bbox[0] + entity.bbox[2] / 2, entity.bbox[1] + entity.bbox[3]]

          if (zone.type === "polygon") {
            const inside = pointInPolygon(foot, zone.coordinates)
            if (inside) {
              anyInside = true
              entity.breaching = true
              if (!state.inside.has(entity.id)) {
                state.inside.add(entity.id)
                fireZone(zone, state, entity, now)
              }
            } else {
              state.inside.delete(entity.id)
            }
          } else {
            const [a, b] = zone.coordinates
            const side = lineSide(foot, a, b)
            const prev = state.prevSide[entity.id]
            state.prevSide[entity.id] = side
            if (prev !== undefined && prev * side < 0) {
              const u = projectOnSegment(foot, a, b)
              const wrongWay = zone.directional ? side > 0 : true
              if (u >= 0 && u <= 1 && wrongWay) fireZone(zone, state, entity, now)
            }
            if ((state.hot[entity.id] ?? 0) > now) entity.breaching = true
          }
        }

        snapshot[zone.id] = {
          breached: anyInside || now < state.holdUntil,
          message: now < state.messageUntil ? state.message : null,
          count: state.count,
        }
      }

      setEntities(next)

      const key = JSON.stringify(snapshot)
      if (key !== runtimeKeyRef.current) {
        runtimeKeyRef.current = key
        setZoneRuntime(snapshot)
      }
      if (intrusionFinished) setIntrusionActive(false)
    }, TICK_MS)

    return () => window.clearInterval(id)
  }, [fireZone])

  React.useEffect(() => {
    let seconds = 0
    const id = window.setInterval(() => {
      seconds += 1
      const delta = 22 + Math.floor(Math.random() * 9)
      const escalated = delta * ESCALATION_RATIO
      setMetrics((prev) => ({
        ...prev,
        ingested: prev.ingested + delta,
        escalatedFrames: prev.escalatedFrames + escalated,
      }))
      setSeries((prev) => {
        if (seconds % 60 === 0) {
          return [...prev.slice(1), { ingested: delta, escalated }]
        }
        const copy = prev.slice()
        const tail = copy[copy.length - 1]
        copy[copy.length - 1] = {
          ingested: tail.ingested + delta,
          escalated: tail.escalated + escalated,
        }
        return copy
      })
    }, 1000)
    return () => window.clearInterval(id)
  }, [])

  React.useEffect(() => {
    const id = window.setInterval(() => {
      const now = Date.now()
      setClips((prev) =>
        prev.some((c) => c.status === "queued" && c.queuedAt && now - c.queuedAt > 1400)
          ? prev.map((c) =>
              c.status === "queued" && c.queuedAt && now - c.queuedAt > 1400
                ? { ...c, status: "sent" as const, queuedAt: undefined }
                : c
            )
          : prev
      )
    }, 500)
    return () => window.clearInterval(id)
  }, [])

  React.useEffect(() => {
    let index = 0
    const id = window.setInterval(() => {
      const template = AUTO_CLIP_TEMPLATES[index % AUTO_CLIP_TEMPLATES.length]
      index += 1
      pushClip(template.cameraId, template.reason, template.confidence)
    }, 11_000)
    return () => window.clearInterval(id)
  }, [pushClip])

  const updateZone = React.useCallback((id: string, patch: Partial<RoiZone>) => {
    setZones((prev) => prev.map((z) => (z.id === id ? { ...z, ...patch } : z)))
  }, [])

  const addZone = React.useCallback(
    (input: NewZoneInput) => {
      zoneCounterRef.current += 1
      const n = zoneCounterRef.current
      const offset = (n % 3) * 4
      const isPolygon = input.type === "polygon"
      const zone: RoiZone = {
        id: `Z-C${n}`,
        name: input.name,
        type: input.type,
        coordinates: isPolygon
          ? [
              [36 + offset, 36 + offset],
              [60 + offset, 34 + offset],
              [62 + offset, 58 + offset],
              [38 + offset, 60 + offset],
            ]
          : [
              [30 + offset, 52 + offset],
              [70 + offset, 52 + offset],
            ],
        color: input.severity === "critical" ? "var(--destructive)" : "var(--warning)",
        severity: input.severity,
        enabled: true,
        cameraId,
        targets: isPolygon ? ["person"] : ["person", "forklift", "vehicle"],
        action: input.action,
        sensitivity: input.sensitivity,
        directional: false,
        custom: true,
      }
      zonesRef.current = [...zonesRef.current, zone]
      setZones((prev) => [...prev, zone])
      toast.success("电子围栏已创建并启用", { description: `${cameraId} · ${input.name}` })
    },
    [cameraId]
  )

  const removeZone = React.useCallback((id: string) => {
    zonesRef.current = zonesRef.current.filter((z) => z.id !== id)
    delete engineRef.current[id]
    setZones((prev) => prev.filter((z) => z.id !== id))
  }, [])

  const simulateIntrusion = React.useCallback(() => {
    setSelectedSource("CAM-02")
    const motion = motionRef.current[VIOLATOR_ID]
    if (motion.override) {
      toast.info("入侵模拟进行中", { description: "目标 #115 正在穿越 1号机加工红线禁区" })
      return
    }
    const zone = zonesRef.current.find((z) => z.id === RED_ZONE_ID)
    if (zone && !zone.enabled) {
      zonesRef.current = zonesRef.current.map((z) =>
        z.id === RED_ZONE_ID ? { ...z, enabled: true } : z
      )
      setZones(zonesRef.current)
      toast.info("红线禁区已临时启用以执行模拟")
    }
    const engine = (engineRef.current[RED_ZONE_ID] ??= freshZoneState())
    engine.lastTriggerAt = 0
    engine.inside.clear()
    motion.override = {
      path: INTRUSION_PATH,
      dist: 0,
      length: pathLength(INTRUSION_PATH),
    }
    setIntrusionActive(true)
    toast.warning("已注入模拟事件", { description: "目标 #115 正在穿越 1号机加工红线禁区" })
  }, [])

  const trackingValue = React.useMemo(() => ({ entities }), [entities])

  const perceptionValue = React.useMemo<PerceptionContextValue>(
    () => ({
      cameraId,
      setCameraId: (id) => {
        if (CAMERAS.some((c) => c.id === id) || isLocalChannelId(id)) setSelectedSource(id)
      },
      localVideos,
      selectedLocalVideo,
      zones,
      zoneRuntime,
      updateZone,
      addZone,
      removeZone,
      clips,
      metrics,
      series,
      intrusionActive,
      simulateIntrusion,
    }),
    [
      cameraId,
      localVideos,
      selectedLocalVideo,
      zones,
      zoneRuntime,
      updateZone,
      addZone,
      removeZone,
      clips,
      metrics,
      series,
      intrusionActive,
      simulateIntrusion,
    ]
  )

  return (
    <PerceptionContext.Provider value={perceptionValue}>
      <TrackingContext.Provider value={trackingValue}>{children}</TrackingContext.Provider>
    </PerceptionContext.Provider>
  )
}
