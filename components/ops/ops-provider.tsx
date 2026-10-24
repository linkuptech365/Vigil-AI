"use client"

import * as React from "react"
import { toast } from "sonner"

import { CAMERAS, INITIAL_ALERTS, NEW_EVENT_TEMPLATES, SEARCH_MOMENTS } from "@/lib/ops/data"
import type { LiveFeed } from "@/lib/ops/ingestion-types"
import type { AlertEvent, AlertStatus, ChannelId, ReplayState, SeekTarget } from "@/lib/ops/types"
import { playAlarm, shanghaiClock } from "@/lib/ops/utils"
import { defaultIncidentSec, formatClock, isChannelId } from "@/lib/ops/video-scenarios"
import { CAST_REQUEST_KEY, parseCastRequest } from "@/lib/vigil/video-source"

export interface LocateRequest {
  channelId: string
  timestampSec?: number
  incidentId?: string
  title?: string
}

export type GridLayout = "grid" | "focus" | "single"
export type RuleStudioTab = "list" | "custom"
export type MonitorMode = "live" | "library"
export type LibraryGrid = 2 | 3

export interface VideoTarget {
  videoId: string
  timestampSec?: number
  nonce: number
}

interface OpsContextValue {
  mode: MonitorMode
  setMode: (mode: MonitorMode) => void
  libraryGrid: LibraryGrid
  setLibraryGrid: (grid: LibraryGrid) => void
  videoTarget: VideoTarget | null
  locateVideo: (videoId: string, timestampSec?: number) => void
  layout: GridLayout
  setLayout: (layout: GridLayout) => void
  focusId: string
  focusCamera: (cameraId: string, opts?: { single?: boolean }) => void
  /** 大屏上显示的视频流 ID；null 表示显示全部已接入的通道 */
  visibleStreamIds: string[] | null
  setVisibleStreamIds: (ids: string[] | null) => void
  seekTarget: SeekTarget | null
  locateIncident: (request: LocateRequest) => void
  showOverlays: boolean
  toggleOverlays: () => void
  liveFeeds: Record<string, LiveFeed>
  pushLiveFeed: (feed: Omit<LiveFeed, "pushedAt">) => void
  clearLiveFeed: (channelId: string) => void
  muted: boolean
  toggleMuted: () => void
  alerts: AlertEvent[]
  selectedAlert: AlertEvent | null
  openAlert: (id: string) => void
  closeAlert: () => void
  setAlertStatus: (id: string, status: AlertStatus, note?: string, assignee?: string) => void
  ruleStudio: { open: boolean; tab: RuleStudioTab }
  openRuleStudio: (tab?: RuleStudioTab) => void
  setRuleStudioOpen: (open: boolean) => void
  setRuleStudioTab: (tab: RuleStudioTab) => void
  auditOpen: boolean
  setAuditOpen: (open: boolean) => void
  replay: ReplayState | null
  startReplay: (momentId: string) => void
  stopReplay: () => void
}

const OpsContext = React.createContext<OpsContextValue | null>(null)

export function useOps() {
  const ctx = React.useContext(OpsContext)
  if (!ctx) throw new Error("useOps must be used within OpsProvider")
  return ctx
}

export function OpsProvider({ children }: { children: React.ReactNode }) {
  const [layout, setLayoutState] = React.useState<GridLayout>("grid")
  const [focusId, setFocusId] = React.useState("CAM-02")
  const [visibleStreamIds, setVisibleStreamIds] = React.useState<string[] | null>(null)
  const [muted, setMuted] = React.useState(false)
  const [alerts, setAlerts] = React.useState<AlertEvent[]>(INITIAL_ALERTS)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [ruleStudio, setRuleStudio] = React.useState<{ open: boolean; tab: RuleStudioTab }>({
    open: false,
    tab: "list",
  })
  const [auditOpen, setAuditOpen] = React.useState(false)
  const [replay, setReplay] = React.useState<ReplayState | null>(null)
  const [seekTarget, setSeekTarget] = React.useState<SeekTarget | null>(null)
  const [showOverlays, setShowOverlays] = React.useState(true)
  const [liveFeeds, setLiveFeeds] = React.useState<Record<string, LiveFeed>>({})
  const seekNonce = React.useRef(0)
  const [mode, setMode] = React.useState<MonitorMode>("live")
  const [libraryGrid, setLibraryGrid] = React.useState<LibraryGrid>(2)
  const [videoTarget, setVideoTarget] = React.useState<VideoTarget | null>(null)

  const locateVideo = React.useCallback((videoId: string, timestampSec?: number) => {
    seekNonce.current += 1
    setVideoTarget({ videoId, timestampSec, nonce: seekNonce.current })
    setMode("library")
  }, [])

  const pushLiveFeed = React.useCallback((feed: Omit<LiveFeed, "pushedAt">) => {
    setLiveFeeds((prev) => ({ ...prev, [feed.channelId]: { ...feed, pushedAt: Date.now() } }))
  }, [])

  const clearLiveFeed = React.useCallback((channelId: string) => {
    setLiveFeeds((prev) => {
      if (!(channelId in prev)) return prev
      const next = { ...prev }
      delete next[channelId]
      return next
    })
  }, [])

  React.useEffect(() => {
    const consume = (raw: string | null) => {
      const request = parseCastRequest(raw)
      const camera = request ? CAMERAS.find((c) => c.id === request.channelId) : undefined
      if (!request || !camera) return
      pushLiveFeed({
        channelId: camera.id,
        protocol: "MP4",
        url: request.url,
        label: request.label,
        fallbackSrc: camera.video,
      })
      setFocusId(camera.id)
      window.localStorage.removeItem(CAST_REQUEST_KEY)
    }
    consume(window.localStorage.getItem(CAST_REQUEST_KEY))
    const onStorage = (event: StorageEvent) => {
      if (event.key === CAST_REQUEST_KEY) consume(event.newValue)
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [pushLiveFeed])

  const mutedRef = React.useRef(muted)
  React.useEffect(() => {
    mutedRef.current = muted
  }, [muted])

  React.useEffect(() => {
    const id = window.setInterval(() => {
      setAlerts((prev) => prev.map((a) => ({ ...a, minutesAgo: a.minutesAgo + 1 })))
    }, 60_000)
    return () => window.clearInterval(id)
  }, [])

  React.useEffect(() => {
    let emitted = 0
    const id = window.setInterval(() => {
      if (emitted >= NEW_EVENT_TEMPLATES.length) {
        window.clearInterval(id)
        return
      }
      const template = NEW_EVENT_TEMPLATES[emitted]
      emitted += 1
      const event: AlertEvent = {
        ...template,
        id: `EVT-${20481 + emitted}`,
        minutesAgo: 0,
        time: shanghaiClock(),
        status: "open",
      }
      setAlerts((prev) => [event, ...prev])
      if (event.severity === "CRITICAL") {
        toast.error(`${event.cameraId} · ${event.type}`, { description: event.summary })
        if (!mutedRef.current) playAlarm()
      } else {
        toast.warning(`${event.cameraId} · ${event.type}`, { description: event.summary })
      }
    }, 50_000)
    return () => window.clearInterval(id)
  }, [])

  const setLayout = React.useCallback((next: GridLayout) => setLayoutState(next), [])

  const focusCamera = React.useCallback((cameraId: string, opts?: { single?: boolean }) => {
    setFocusId(cameraId)
    if (opts?.single) setLayoutState("single")
  }, [])

  const toggleMuted = React.useCallback(() => {
    setMuted((prev) => {
      toast.info(prev ? "已开启紧急告警声音" : "已静音紧急告警声音")
      return !prev
    })
  }, [])

  const setAlertStatus = React.useCallback<OpsContextValue["setAlertStatus"]>(
    (id, status, note, assignee) => {
      setAlerts((prev) =>
        prev.map((a) =>
          a.id === id
            ? { ...a, status, note: note?.trim() ? note.trim() : a.note, assignee: assignee ?? a.assignee }
            : a
        )
      )
    },
    []
  )

  const openRuleStudio = React.useCallback((tab: RuleStudioTab = "list") => {
    setRuleStudio({ open: true, tab })
  }, [])

  const seekChannel = React.useCallback(
    (channelId: ChannelId, timestampSec: number, extra?: { incidentId?: string; title?: string }) => {
      seekNonce.current += 1
      setSeekTarget({ channelId, timestampSec, nonce: seekNonce.current, ...extra })
      setFocusId(channelId)
      setLayoutState((prev) => (prev === "single" ? "single" : "focus"))
    },
    []
  )

  const locateIncident = React.useCallback(
    (request: LocateRequest) => {
      if (!isChannelId(request.channelId)) {
        toast.error(`未找到通道 ${request.channelId}`)
        return
      }
      const sec = request.timestampSec ?? defaultIncidentSec(request.channelId, request.title ?? "")
      seekChannel(request.channelId, sec, { incidentId: request.incidentId, title: request.title })
      toast.success(`已定位 ${request.channelId} · ${formatClock(sec)}`, {
        description: request.title,
      })
    },
    [seekChannel]
  )

  const startReplay = React.useCallback(
    (momentId: string) => {
      const moment = SEARCH_MOMENTS.find((m) => m.id === momentId)
      if (!moment) return
      setReplay({
        momentId: moment.id,
        cameraId: moment.cameraId,
        start: moment.start,
        end: moment.end,
        title: moment.title,
      })
      if (isChannelId(moment.cameraId)) {
        const text = `${moment.title} ${moment.rationale} ${moment.keywords.join(" ")}`
        seekChannel(moment.cameraId, defaultIncidentSec(moment.cameraId, text), { title: moment.title })
      }
      setLayoutState("single")
      toast.success(`主播放器已跳转至 ${moment.cameraId}`, {
        description: `${moment.start} - ${moment.end} · ${moment.title}`,
      })
    },
    [seekChannel]
  )

  const value = React.useMemo<OpsContextValue>(
    () => ({
      mode,
      setMode,
      libraryGrid,
      setLibraryGrid,
      videoTarget,
      locateVideo,
      layout,
      setLayout,
      focusId,
      focusCamera,
      visibleStreamIds,
      setVisibleStreamIds,
      seekTarget,
      locateIncident,
      showOverlays,
      toggleOverlays: () => setShowOverlays((prev) => !prev),
      liveFeeds,
      pushLiveFeed,
      clearLiveFeed,
      muted,
      toggleMuted,
      alerts,
      selectedAlert: alerts.find((a) => a.id === selectedId) ?? null,
      openAlert: setSelectedId,
      closeAlert: () => setSelectedId(null),
      setAlertStatus,
      ruleStudio,
      openRuleStudio,
      setRuleStudioOpen: (open) => setRuleStudio((prev) => ({ ...prev, open })),
      setRuleStudioTab: (tab) => setRuleStudio((prev) => ({ ...prev, tab })),
      auditOpen,
      setAuditOpen,
      replay,
      startReplay,
      stopReplay: () => setReplay(null),
    }),
    [
      mode,
      libraryGrid,
      videoTarget,
      locateVideo,
      layout,
      setLayout,
      focusId,
      focusCamera,
      visibleStreamIds,
      seekTarget,
      locateIncident,
      showOverlays,
      liveFeeds,
      pushLiveFeed,
      clearLiveFeed,
      muted,
      toggleMuted,
      alerts,
      selectedId,
      setAlertStatus,
      ruleStudio,
      openRuleStudio,
      auditOpen,
      replay,
      startReplay,
    ]
  )

  return <OpsContext.Provider value={value}>{children}</OpsContext.Provider>
}
