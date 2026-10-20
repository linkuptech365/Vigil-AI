"use client"

import * as React from "react"
import { toast } from "sonner"

import {
  DEFAULT_CUSTOM_PROMPT,
  INITIAL_COOLDOWNS,
  INITIAL_DEDUP_METRICS,
  INITIAL_INCIDENT_SEQ,
  INITIAL_INSPECTION_RULES,
  STORM_SCHEDULE_MS,
} from "@/lib/ops/rules-data"
import type {
  ChannelCooldown,
  DeduplicationMetrics,
  InspectionRule,
  RuleActionKey,
} from "@/lib/ops/rules-types"

const TICK_MS = 500
const TICK_SECONDS = TICK_MS / 1000
const LIVE_BUMP_EVERY_TICKS = 12

export function lastTriggerOffset(cd: ChannelCooldown) {
  return cd.pulses.length ? cd.pulses[cd.pulses.length - 1].offset : 0
}

export function isWindowActive(cd: ChannelCooldown) {
  return cd.incidentId !== null && cd.elapsed - lastTriggerOffset(cd) < cd.windowSeconds
}

export function remainingSeconds(cd: ChannelCooldown) {
  if (!isWindowActive(cd)) return 0
  return Math.max(0, Math.ceil(cd.windowSeconds - (cd.elapsed - lastTriggerOffset(cd))))
}

interface EngineState {
  cooldowns: Record<string, ChannelCooldown>
  metrics: DeduplicationMetrics
  incidentSeq: number
  pulseSeq: number
}

type EngineAction =
  | { type: "tick" }
  | { type: "trigger"; channelId: string }
  | { type: "bump"; newIncident: boolean }

const INITIAL_ENGINE: EngineState = {
  cooldowns: INITIAL_COOLDOWNS,
  metrics: INITIAL_DEDUP_METRICS,
  incidentSeq: INITIAL_INCIDENT_SEQ,
  pulseSeq: 100,
}

function incidentLabel(seq: number) {
  return `INC-20261020-${String(seq).padStart(3, "0")}`
}

function engineReducer(state: EngineState, action: EngineAction): EngineState {
  switch (action.type) {
    case "tick": {
      let changed = false
      const cooldowns: Record<string, ChannelCooldown> = {}
      for (const [id, cd] of Object.entries(state.cooldowns)) {
        if (isWindowActive(cd)) {
          changed = true
          const last = lastTriggerOffset(cd)
          const elapsed = Math.min(cd.elapsed + TICK_SECONDS, last + cd.windowSeconds)
          cooldowns[id] = { ...cd, elapsed }
        } else {
          cooldowns[id] = cd
        }
      }
      return changed ? { ...state, cooldowns } : state
    }
    case "trigger": {
      const cd = state.cooldowns[action.channelId]
      if (!cd) return state
      const pulseId = state.pulseSeq + 1
      if (isWindowActive(cd)) {
        return {
          ...state,
          pulseSeq: pulseId,
          cooldowns: {
            ...state.cooldowns,
            [action.channelId]: {
              ...cd,
              pulses: [...cd.pulses, { id: pulseId, offset: cd.elapsed, kind: "suppressed" }],
            },
          },
          metrics: {
            ...state.metrics,
            rawTriggersCount: state.metrics.rawTriggersCount + 1,
            suppressedCount: state.metrics.suppressedCount + 1,
          },
        }
      }
      const seq = state.incidentSeq + 1
      return {
        ...state,
        incidentSeq: seq,
        pulseSeq: pulseId,
        cooldowns: {
          ...state.cooldowns,
          [action.channelId]: {
            ...cd,
            incidentId: incidentLabel(seq),
            elapsed: 0,
            pulses: [{ id: pulseId, offset: 0, kind: "incident" }],
          },
        },
        metrics: {
          ...state.metrics,
          rawTriggersCount: state.metrics.rawTriggersCount + 1,
          incidentCount: state.metrics.incidentCount + 1,
        },
      }
    }
    case "bump":
      return {
        ...state,
        metrics: {
          ...state.metrics,
          rawTriggersCount: state.metrics.rawTriggersCount + 1,
          suppressedCount: state.metrics.suppressedCount + (action.newIncident ? 0 : 1),
          incidentCount: state.metrics.incidentCount + (action.newIncident ? 1 : 0),
        },
      }
  }
}

export interface CustomRuleInput {
  name: string
  prompt: string
  sensitivity: number
  actions: Record<RuleActionKey, boolean>
}

interface RulesContextValue {
  rules: InspectionRule[]
  updateRule: (id: string, patch: Partial<InspectionRule>) => void
  addCustomRule: (input: CustomRuleInput) => void
  metrics: DeduplicationMetrics
  cooldowns: Record<string, ChannelCooldown>
  selectedChannel: string
  setSelectedChannel: (id: string) => void
  triggerOnce: (channelId: string) => void
  runStorm: (channelId: string) => void
  stormRunning: boolean
  customDialogOpen: boolean
  setCustomDialogOpen: (open: boolean) => void
}

const RulesContext = React.createContext<RulesContextValue | null>(null)

export function useRules() {
  const ctx = React.useContext(RulesContext)
  if (!ctx) throw new Error("useRules must be used within RulesProvider")
  return ctx
}

export function RulesProvider({ children }: { children: React.ReactNode }) {
  const [engine, dispatch] = React.useReducer(engineReducer, INITIAL_ENGINE)
  const [rules, setRules] = React.useState<InspectionRule[]>(INITIAL_INSPECTION_RULES)
  const [selectedChannel, setSelectedChannel] = React.useState("CAM-02")
  const [stormRunning, setStormRunning] = React.useState(false)
  const [customDialogOpen, setCustomDialogOpen] = React.useState(false)

  const engineRef = React.useRef(engine)
  React.useEffect(() => {
    engineRef.current = engine
  }, [engine])

  const stormTimers = React.useRef<number[]>([])

  React.useEffect(() => {
    let ticks = 0
    const interval = window.setInterval(() => {
      ticks += 1
      dispatch({ type: "tick" })
      if (ticks % LIVE_BUMP_EVERY_TICKS === 0) {
        dispatch({ type: "bump", newIncident: Math.random() < 0.12 })
      }
    }, TICK_MS)
    const timers = stormTimers.current
    return () => {
      window.clearInterval(interval)
      timers.forEach((t) => window.clearTimeout(t))
    }
  }, [])

  const updateRule = React.useCallback((id: string, patch: Partial<InspectionRule>) => {
    setRules((prev) => prev.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)))
  }, [])

  const addCustomRule = React.useCallback((input: CustomRuleInput) => {
    setRules((prev) => {
      const next = prev.length + 1
      const rule: InspectionRule = {
        id: `RULE-${String(next).padStart(2, "0")}`,
        name: input.name,
        type: "PROMPT_SEMANTIC",
        prompt: input.prompt,
        boundChannels: ["CAM-01", "CAM-02", "CAM-03", "CAM-04"],
        severity: "WARNING",
        cooldownSeconds: 60,
        schedule: "24x7",
        enabled: true,
        custom: true,
        sensitivity: input.sensitivity,
        actions: input.actions,
      }
      return [...prev, rule]
    })
    toast.success("自定义语义规则已创建并启用", {
      description: "新规则默认绑定全部通道，可在规则目录中继续调整。",
    })
  }, [])

  const triggerOnce = React.useCallback((channelId: string) => {
    const cd = engineRef.current.cooldowns[channelId]
    const wasActive = cd ? isWindowActive(cd) : false
    dispatch({ type: "trigger", channelId })
    if (wasActive) {
      toast.info("重复触发已被抑制", { description: "证据已自动追加到现有工单，未产生新的通知。" })
    } else {
      toast.warning("已创建新工单并派发声光告警", { description: `${channelId} 进入 60s 冷却窗口。` })
    }
  }, [])

  const runStorm = React.useCallback((channelId: string) => {
    if (stormTimers.current.length > 0) return
    const cd = engineRef.current.cooldowns[channelId]
    const wasActive = cd ? isWindowActive(cd) : false
    const total = STORM_SCHEDULE_MS.length
    setStormRunning(true)
    STORM_SCHEDULE_MS.forEach((delay, index) => {
      const timer = window.setTimeout(() => {
        dispatch({ type: "trigger", channelId })
        if (index === total - 1) {
          stormTimers.current = []
          setStormRunning(false)
          toast.success("告警风暴已被防抖引擎消化", {
            description: wasActive
              ? `${total} 次连续触发全部折叠进现有工单，0 条重复通知。`
              : `${total} 次连续触发 = 1 张正式工单 + ${total - 1} 次折叠追加。`,
          })
        }
      }, delay)
      stormTimers.current.push(timer)
    })
  }, [])

  const value = React.useMemo<RulesContextValue>(
    () => ({
      rules,
      updateRule,
      addCustomRule,
      metrics: engine.metrics,
      cooldowns: engine.cooldowns,
      selectedChannel,
      setSelectedChannel,
      triggerOnce,
      runStorm,
      stormRunning,
      customDialogOpen,
      setCustomDialogOpen,
    }),
    [
      rules,
      updateRule,
      addCustomRule,
      engine.metrics,
      engine.cooldowns,
      selectedChannel,
      triggerOnce,
      runStorm,
      stormRunning,
      customDialogOpen,
    ]
  )

  return <RulesContext.Provider value={value}>{children}</RulesContext.Provider>
}

export { DEFAULT_CUSTOM_PROMPT }
