"use client"

import * as React from "react"
import { toast } from "sonner"

import { INITIAL_ALERTS, NEW_EVENT_TEMPLATES, SEARCH_MOMENTS } from "@/lib/ops/data"
import type { AlertEvent, AlertStatus, ChannelId, ReplayState, SeekTarget } from "@/lib/ops/types"
import { playAlarm, shanghaiClock } from "@/lib/ops/utils"
import { defaultIncidentSec, formatClock, isChannelId } from "@/lib/ops/video-scenarios"

export interface LocateRequest {
  channelId: string
  timestampSec?: number
  incidentId?: string
  title?: string
}

export type GridLayout = "grid" | "focus" | "single"
export type RuleStudioTab = "list" | "custom"

interface OpsContextValue {
  layout: GridLayout
  setLayout: (layout: GridLayout) => void
  focusId: string
  focusCamera: (cameraId: string, opts?: { single?: boolean }) => void
  seekTarget: SeekTarget | null
  locateIncident: (request: LocateRequest) => void
  showOverlays: boolean
  toggleOverlays: () => void
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
  const [muted, setMuted] = React.useState(false)
  const [alerts, setAlerts] = React.useState<AlertEvent[]>(INITIAL_ALERTS)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [ruleStudio, setRuleStudio] = React.useState<{ open: boolean; tab: RuleStudioTab }>({
    open: false,
    tab: "list",
  })
  const [replay, setReplay] = React.useState<ReplayState | null>(null)
  const [seekTarget, setSeekTarget] = React.useState<SeekTarget | null>(null)
  const [showOverlays, setShowOverlays] = React.useState(true)
  const seekNonce = React.useRef(0)

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
      layout,
      setLayout,
      focusId,
      focusCamera,
      seekTarget,
      locateIncident,
      showOverlays,
      toggleOverlays: () => setShowOverlays((prev) => !prev),
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
      replay,
      startReplay,
      stopReplay: () => setReplay(null),
    }),
    [
      layout,
      setLayout,
      focusId,
      focusCamera,
      seekTarget,
      locateIncident,
      showOverlays,
      muted,
      toggleMuted,
      alerts,
      selectedId,
      setAlertStatus,
      ruleStudio,
      openRuleStudio,
      replay,
      startReplay,
    ]
  )

  return <OpsContext.Provider value={value}>{children}</OpsContext.Provider>
}
