"use client"

import * as React from "react"
import { toast } from "sonner"

import {
  INITIAL_ALERTS,
  INITIAL_RULES,
  NEW_EVENT_TEMPLATES,
  SEARCH_MOMENTS,
} from "@/lib/ops/data"
import type {
  AlertEvent,
  AlertStatus,
  ReplayState,
  Rule,
  RuleActions,
} from "@/lib/ops/types"
import { playAlarm, shanghaiClock } from "@/lib/ops/utils"

export type GridLayout = "grid" | "focus" | "single"
export type RuleStudioTab = "list" | "custom"

interface OpsContextValue {
  layout: GridLayout
  setLayout: (layout: GridLayout) => void
  focusId: string
  focusCamera: (cameraId: string, opts?: { single?: boolean }) => void
  muted: boolean
  toggleMuted: () => void
  alerts: AlertEvent[]
  selectedAlert: AlertEvent | null
  openAlert: (id: string) => void
  closeAlert: () => void
  setAlertStatus: (id: string, status: AlertStatus, note?: string, assignee?: string) => void
  rules: Rule[]
  toggleRule: (id: string) => void
  setRuleSensitivity: (id: string, value: number) => void
  setRuleAction: (id: string, key: keyof RuleActions, value: boolean) => void
  addRule: (rule: Omit<Rule, "id" | "enabled" | "custom">) => void
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

const ACTION_LABEL: Record<keyof RuleActions, string> = {
  notify: "钉钉/企微推送",
  siren: "声光报警器",
  record: "自动录制切片",
}

export function OpsProvider({ children }: { children: React.ReactNode }) {
  const [layout, setLayoutState] = React.useState<GridLayout>("grid")
  const [focusId, setFocusId] = React.useState("CAM-02")
  const [muted, setMuted] = React.useState(false)
  const [alerts, setAlerts] = React.useState<AlertEvent[]>(INITIAL_ALERTS)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [rules, setRules] = React.useState<Rule[]>(INITIAL_RULES)
  const [ruleStudio, setRuleStudio] = React.useState<{ open: boolean; tab: RuleStudioTab }>({
    open: false,
    tab: "list",
  })
  const [replay, setReplay] = React.useState<ReplayState | null>(null)

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

  const toggleRule = React.useCallback((id: string) => {
    setRules((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r
        const enabled = !r.enabled
        toast[enabled ? "success" : "info"](`${enabled ? "已启用" : "已停用"}规则`, {
          description: r.name,
        })
        return { ...r, enabled }
      })
    )
  }, [])

  const setRuleSensitivity = React.useCallback((id: string, value: number) => {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, sensitivity: value } : r)))
  }, [])

  const setRuleAction = React.useCallback(
    (id: string, key: keyof RuleActions, value: boolean) => {
      setRules((prev) =>
        prev.map((r) => (r.id === id ? { ...r, actions: { ...r.actions, [key]: value } } : r))
      )
      toast.info(`${value ? "已开启" : "已关闭"}联动响应：${ACTION_LABEL[key]}`)
    },
    []
  )

  const addRule = React.useCallback<OpsContextValue["addRule"]>((rule) => {
    setRules((prev) => [
      ...prev,
      { ...rule, id: `R-${String(prev.length + 1).padStart(2, "0")}`, enabled: true, custom: true },
    ])
    toast.success("布控规则已创建并启用", { description: rule.name })
  }, [])

  const openRuleStudio = React.useCallback((tab: RuleStudioTab = "list") => {
    setRuleStudio({ open: true, tab })
  }, [])

  const startReplay = React.useCallback((momentId: string) => {
    const moment = SEARCH_MOMENTS.find((m) => m.id === momentId)
    if (!moment) return
    setReplay({
      momentId: moment.id,
      cameraId: moment.cameraId,
      start: moment.start,
      end: moment.end,
      title: moment.title,
    })
    setFocusId(moment.cameraId)
    setLayoutState("single")
    toast.success(`主播放器已跳转至 ${moment.cameraId}`, {
      description: `${moment.start} - ${moment.end} · ${moment.title}`,
    })
  }, [])

  const value = React.useMemo<OpsContextValue>(
    () => ({
      layout,
      setLayout,
      focusId,
      focusCamera,
      muted,
      toggleMuted,
      alerts,
      selectedAlert: alerts.find((a) => a.id === selectedId) ?? null,
      openAlert: setSelectedId,
      closeAlert: () => setSelectedId(null),
      setAlertStatus,
      rules,
      toggleRule,
      setRuleSensitivity,
      setRuleAction,
      addRule,
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
      muted,
      toggleMuted,
      alerts,
      selectedId,
      setAlertStatus,
      rules,
      toggleRule,
      setRuleSensitivity,
      setRuleAction,
      addRule,
      ruleStudio,
      openRuleStudio,
      replay,
      startReplay,
    ]
  )

  return <OpsContext.Provider value={value}>{children}</OpsContext.Provider>
}
