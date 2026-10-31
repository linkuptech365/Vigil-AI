"use client"

import * as React from "react"
import { toast } from "sonner"

import { useDemoMode } from "@/components/vigil/demo-mode-provider"
import { alertFrameUrl, streamSnapshotUrl, useStreams } from "@/components/vigil/streams/use-streams"
import type { StreamAlert, StreamView } from "@/lib/vigil/streams"
import {
  INITIAL_STREAMS,
  estimateMemoryMB,
  seedHistory,
} from "@/lib/ops/ingestion-data"
import {
  BUFFER_SECONDS,
  EXTRACTION_STEPS,
  IDLE_FPS,
  MAX_FPS,
  MOTION_THRESHOLD,
  type BufferSample,
  type BufferedClip,
  type CircularBuffer,
  type ExtractionState,
  type NewStreamInput,
  type SamplingMode,
  type StreamSource,
} from "@/lib/ops/ingestion-types"
import { isLocalChannelId, parseLocalChannelId } from "@/lib/ops/local-source"
import { secondsToTime, shanghaiClock, timeToSeconds } from "@/lib/ops/utils"
import type { VideoItem } from "@/lib/vigil/types"
import { useVigil } from "@/components/vigil/vigil-provider"

interface SimState {
  streams: StreamSource[]
  histories: Record<string, BufferSample[]>
  locked: string[]
}

interface ChannelAux {
  baseBitrate: number
  baseLatency: number
  burst: number
  cooldown: number
  drop: number
}

interface Totals {
  online: number
  total: number
  bandwidth: number
  aggregateFps: number
  memoryMB: number
}

interface IngestionContextValue {
  streams: StreamSource[]
  buffers: CircularBuffer[]
  histories: Record<string, BufferSample[]>
  clips: BufferedClip[]
  extraction: ExtractionState | null
  totals: Totals
  selectedId: string
  selectedStream: StreamSource | undefined
  /** 全局队列里的本地导入视频，与 CAM 通道并列接入 */
  localVideos: VideoItem[]
  /** 当前选中的是本地视频时有值，此时 selectedStream 为空 */
  selectedLocalVideo: VideoItem | undefined
  selectChannel: (id: string) => void
  addStream: (input: NewStreamInput) => void
  removeStream: (id: string) => void
  toggleOffline: (id: string) => void
  setSamplingMode: (id: string, mode: SamplingMode) => void
  setFixedFps: (id: string, fps: number) => void
  triggerExtraction: (channelId: string) => void
}

const IngestionContext = React.createContext<IngestionContextValue | null>(null)

export function useIngestion() {
  const value = React.useContext(IngestionContext)
  if (!value) throw new Error("useIngestion must be used inside IngestionProvider")
  return value
}

const TICK_MS = 1000
const STEP_MS = 650
const MAX_CLIPS = 8

const round1 = (n: number) => Math.round(n * 10) / 10
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

const emptyHistory = (): BufferSample[] =>
  Array.from({ length: BUFFER_SECONDS }, () => ({ fps: 0, motion: 0, trigger: false }))

function protocolOf(view: StreamView): StreamSource["protocol"] {
  const scheme = view.sourceMasked.split(":")[0]?.toLowerCase() ?? ""
  if (scheme.startsWith("rtsp")) return "RTSP"
  if (scheme === "rtmp") return "RTMP"
  return "FILE"
}

/** 真实通道：仅映射服务端确实掌握的字段，没有的指标保持为 0，不编造帧率/码率。 */
function toStreamSource(view: StreamView, override?: Partial<StreamSource>): StreamSource {
  const online = view.status !== "offline"
  return {
    id: view.id,
    name: view.name,
    protocol: protocolOf(view),
    url: view.sourceMasked,
    status: online ? "connected" : "offline",
    currentFps: 0,
    motionLevel: 0,
    resolution: "—",
    bitrate: 0,
    latency: 0,
    samplingMode: "auto",
    fixedFps: 5,
    image: online ? streamSnapshotUrl(view.id) : undefined,
    ...override,
  }
}

function toClip(alert: StreamAlert): BufferedClip {
  const end = timeToSeconds(shanghaiClock(new Date(alert.triggeredAt)))
  return {
    clipId: alert.id,
    channelId: alert.streamId,
    startTime: secondsToTime(end - BUFFER_SECONDS),
    endTime: secondsToTime(end),
    frameCount: alert.frames.length,
    keyframeThumbnails: alert.frames.map((frame) => alertFrameUrl(alert.id, frame.index)),
  }
}

function initialSim(demo: boolean): SimState {
  if (!demo) return { streams: [], histories: {}, locked: [] }
  return {
    streams: INITIAL_STREAMS,
    histories: Object.fromEntries(
      INITIAL_STREAMS.map((stream, index) => [stream.id, seedHistory(index)]),
    ),
    locked: [],
  }
}

function stepStream(
  stream: StreamSource,
  aux: ChannelAux,
): { stream: StreamSource; sample: BufferSample } {
  if (stream.status === "offline") {
    return {
      stream: { ...stream, currentFps: 0, motionLevel: 0, bitrate: 0, latency: 0 },
      sample: { fps: 0, motion: 0, trigger: false },
    }
  }

  let status = stream.status
  if (aux.drop > 0) {
    aux.drop -= 1
    status = aux.drop === 0 ? "connected" : "frame_drop"
  } else if (Math.random() < 0.012) {
    aux.drop = 4 + Math.floor(Math.random() * 4)
    status = "frame_drop"
  } else {
    status = "connected"
  }

  let motion: number
  if (aux.burst > 0) {
    aux.burst -= 1
    motion = 18 + Math.random() * 60
  } else {
    motion = 0.5 + Math.random() * 3.5
    if (Math.random() < 0.07) aux.burst = 4 + Math.floor(Math.random() * 5)
  }

  let fps: number
  if (stream.samplingMode === "fixed") {
    fps = stream.fixedFps
  } else {
    if (motion >= MOTION_THRESHOLD) aux.cooldown = 2
    const active = motion >= MOTION_THRESHOLD || aux.cooldown > 0
    if (motion < MOTION_THRESHOLD && aux.cooldown > 0) aux.cooldown -= 1
    fps = active ? clamp(Math.round(5 + (motion / 100) * 6), 5, MAX_FPS) : IDLE_FPS
  }

  const dropped = status === "frame_drop"
  if (dropped) fps = Math.max(1, Math.round(fps * 0.6))

  const bitrate = round1(aux.baseBitrate * (0.94 + Math.random() * 0.12) * (dropped ? 0.55 : 1))
  const latency = Math.round(
    aux.baseLatency + Math.random() * 14 - 5 + (dropped ? 80 + Math.random() * 40 : 0),
  )

  return {
    stream: {
      ...stream,
      status,
      currentFps: fps,
      motionLevel: round1(motion),
      bitrate,
      latency,
    },
    sample: { fps, motion: round1(motion), trigger: false },
  }
}

export function IngestionProvider({ children }: { children: React.ReactNode }) {
  const { enabled: demo } = useDemoMode()
  const real = useStreams()
  const [demoSim, setSim] = React.useState<SimState>(() => initialSim(demo))
  const [demoClips, setClips] = React.useState<BufferedClip[]>([])
  const [extraction, setExtraction] = React.useState<ExtractionState | null>(null)
  const [selectedId, setSelectedId] = React.useState(demo ? INITIAL_STREAMS[0].id : "")
  const [overrides, setOverrides] = React.useState<Record<string, Partial<StreamSource>>>({})
  const { queue: localVideos } = useVigil()

  const sim = React.useMemo<SimState>(() => {
    if (demo) return demoSim
    const streams = real.streams.map((view) => toStreamSource(view, overrides[view.id]))
    return {
      streams,
      histories: Object.fromEntries(streams.map((stream) => [stream.id, emptyHistory()])),
      locked: [],
    }
  }, [demo, demoSim, real.streams, overrides])

  const clips = React.useMemo(
    () => (demo ? demoClips : real.alerts.filter((alert) => alert.frames.length > 0).slice(0, MAX_CLIPS).map(toClip)),
    [demo, demoClips, real.alerts],
  )

  const simRef = React.useRef(sim)
  const auxRef = React.useRef<Record<string, ChannelAux>>({})
  const timersRef = React.useRef<number[]>([])

  const commit = React.useCallback((update: (prev: SimState) => SimState) => {
    simRef.current = update(simRef.current)
    setSim(simRef.current)
  }, [])

  React.useEffect(() => {
    if (!demo) return
    const id = window.setInterval(() => {
      const prev = simRef.current
      const histories = { ...prev.histories }
      const streams = prev.streams.map((stream) => {
        const aux = (auxRef.current[stream.id] ??= {
          baseBitrate: stream.bitrate || 4,
          baseLatency: stream.latency || 70,
          burst: 0,
          cooldown: 0,
          drop: 0,
        })
        const result = stepStream(stream, aux)
        if (!prev.locked.includes(stream.id)) {
          const history = histories[stream.id] ?? seedHistory(0)
          histories[stream.id] = [...history.slice(1), result.sample]
        }
        return result.stream
      })
      simRef.current = { ...prev, streams, histories }
      setSim(simRef.current)
    }, TICK_MS)

    return () => window.clearInterval(id)
  }, [demo])

  React.useEffect(() => {
    const timers = timersRef.current
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [])

  const patchStream = React.useCallback(
    (id: string, patch: Partial<StreamSource>) => {
      if (!demo) {
        setOverrides((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
        return
      }
      commit((prev) => ({
        ...prev,
        streams: prev.streams.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      }))
    },
    [commit, demo],
  )

  const realAddStream = real.addStream
  const realRemoveStream = real.removeStream
  const realAnalyzeStream = real.analyzeStream

  const addStream = React.useCallback(
    (input: NewStreamInput) => {
      if (!demo) {
        void realAddStream({ name: input.name, zone: "公共区域", source: input.url })
        return
      }
      const nextNumber =
        simRef.current.streams.reduce((max, s) => {
          const n = Number(s.id.replace(/\D/g, ""))
          return Number.isFinite(n) ? Math.max(max, n) : max
        }, 0) + 1
      const id = `CAM-${String(nextNumber).padStart(2, "0")}`
      const stream: StreamSource = {
        id,
        name: input.name,
        protocol: input.protocol,
        url: input.url,
        status: "connected",
        currentFps: IDLE_FPS,
        motionLevel: 1.8,
        resolution: input.resolution,
        bitrate: input.bitrate,
        latency: input.protocol === "FILE" ? 12 : 78,
        samplingMode: "auto",
        fixedFps: 5,
      }
      commit((prev) => ({
        ...prev,
        streams: [...prev.streams, stream],
        histories: {
          ...prev.histories,
          [id]: seedHistory(prev.streams.length).map((s) => ({ ...s, fps: 1, motion: 1.5 })),
        },
      }))
      setSelectedId(id)
    },
    [commit, demo, realAddStream],
  )

  const removeStream = React.useCallback(
    (id: string) => {
      if (!demo) {
        void realRemoveStream(id)
        return
      }
      commit((prev) => {
        const { [id]: _removed, ...histories } = prev.histories
        return {
          streams: prev.streams.filter((s) => s.id !== id),
          histories,
          locked: prev.locked.filter((l) => l !== id),
        }
      })
      delete auxRef.current[id]
    },
    [commit, demo, realRemoveStream],
  )

  const toggleOffline = React.useCallback(
    (id: string) => {
      if (!demo) {
        toast.info("真实通道的连接状态由流媒体引擎决定", { description: "如需下线请在配置中心删除该通道。" })
        return
      }
      const stream = simRef.current.streams.find((s) => s.id === id)
      if (!stream) return
      const aux = auxRef.current[id]
      if (aux) aux.drop = 0
      patchStream(id, stream.status === "offline" ? { status: "connected" } : { status: "offline" })
    },
    [patchStream, demo],
  )

  const setSamplingMode = React.useCallback(
    (id: string, mode: SamplingMode) => {
      patchStream(id, { samplingMode: mode })
      const aux = auxRef.current[id]
      if (aux) aux.cooldown = 0
    },
    [patchStream],
  )

  const setFixedFps = React.useCallback(
    (id: string, fps: number) => patchStream(id, { fixedFps: clamp(Math.round(fps), 1, MAX_FPS) }),
    [patchStream],
  )

  const triggerExtraction = React.useCallback(
    (channelId: string) => {
      if (!demo) {
        const live = sim.streams.find((s) => s.id === channelId)
        if (!live || live.status === "offline" || extraction) return
        setExtraction({ channelId, step: 0 })
        void realAnalyzeStream(channelId).finally(() => setExtraction(null))
        return
      }
      const current = simRef.current
      const stream = current.streams.find((s) => s.id === channelId)
      if (!stream || stream.status === "offline" || current.locked.includes(channelId)) return

      commit((prev) => {
        const history = prev.histories[channelId] ?? []
        const centre = Math.floor(BUFFER_SECONDS / 2)
        return {
          ...prev,
          locked: [...prev.locked, channelId],
          histories: {
            ...prev.histories,
            [channelId]: history.map((s, i) => (i === centre ? { ...s, trigger: true } : s)),
          },
        }
      })
      setExtraction({ channelId, step: 0 })

      const finish = () => {
        const snapshot = simRef.current.histories[channelId] ?? []
        const frameCount = snapshot.reduce((sum, s) => sum + s.fps, 0)
        const endSeconds = timeToSeconds(shanghaiClock(new Date()))
        const clip: BufferedClip = {
          clipId: `CLP-${channelId}-${secondsToTime(endSeconds).replaceAll(":", "")}`,
          channelId,
          startTime: secondsToTime(endSeconds - BUFFER_SECONDS),
          endTime: secondsToTime(endSeconds),
          frameCount,
          keyframeThumbnails: stream.image ? Array.from({ length: 8 }, () => stream.image as string) : [],
        }
        setClips((prev) => [clip, ...prev].slice(0, MAX_CLIPS))
        commit((prev) => ({ ...prev, locked: prev.locked.filter((l) => l !== channelId) }))
        setExtraction(null)
      }

      for (let step = 1; step < EXTRACTION_STEPS.length; step += 1) {
        timersRef.current.push(window.setTimeout(() => setExtraction({ channelId, step }), STEP_MS * step))
      }
      timersRef.current.push(window.setTimeout(finish, STEP_MS * EXTRACTION_STEPS.length))
    },
    [commit],
  )

  const buffers = React.useMemo<CircularBuffer[]>(
    () =>
      sim.streams.map((stream) => {
        const frames = (sim.histories[stream.id] ?? []).reduce((sum, s) => sum + s.fps, 0)
        return {
          channelId: stream.id,
          capacitySeconds: 30,
          currentFramesCount: frames,
          memoryUsageMB: estimateMemoryMB(stream.resolution, frames),
          isLocked: sim.locked.includes(stream.id),
        }
      }),
    [sim],
  )

  const totals = React.useMemo<Totals>(() => {
    const online = sim.streams.filter((s) => s.status !== "offline")
    return {
      online: online.length,
      total: sim.streams.length,
      bandwidth: round1(online.reduce((sum, s) => sum + s.bitrate, 0)),
      aggregateFps: online.reduce((sum, s) => sum + s.currentFps, 0),
      memoryMB: buffers.reduce((sum, b) => sum + b.memoryUsageMB, 0),
    }
  }, [sim.streams, buffers])

  const selectedLocalVideo = isLocalChannelId(selectedId)
    ? localVideos.find((v) => v.id === parseLocalChannelId(selectedId))
    : undefined

  const resolvedSelectedId =
    selectedLocalVideo || sim.streams.some((s) => s.id === selectedId)
      ? selectedId
      : (sim.streams[0]?.id ?? "")

  const value = React.useMemo<IngestionContextValue>(
    () => ({
      streams: sim.streams,
      buffers,
      histories: sim.histories,
      clips,
      extraction,
      totals,
      selectedId: resolvedSelectedId,
      selectedStream: sim.streams.find((s) => s.id === resolvedSelectedId),
      localVideos,
      selectedLocalVideo,
      selectChannel: setSelectedId,
      addStream,
      removeStream,
      toggleOffline,
      setSamplingMode,
      setFixedFps,
      triggerExtraction,
    }),
    [
      sim,
      buffers,
      clips,
      extraction,
      totals,
      resolvedSelectedId,
      localVideos,
      selectedLocalVideo,
      addStream,
      removeStream,
      toggleOffline,
      setSamplingMode,
      setFixedFps,
      triggerExtraction,
    ],
  )

  return <IngestionContext.Provider value={value}>{children}</IngestionContext.Provider>
}
