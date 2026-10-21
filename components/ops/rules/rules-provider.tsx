"use client"

import * as React from "react"
import useSWR, { useSWRConfig } from "swr"
import { toast } from "sonner"

import type { StormResponse, SuppressResponse, SuppressionSnapshot } from "@/lib/ops/rules-api-types"
import {
  CLUSTER_ENDPOINT,
  STORM_ENDPOINT,
  SUPPRESS_ENDPOINT,
  errorMessage,
  getJson,
  sendJson,
} from "@/lib/ops/rules-client"
import { ALL_CHANNELS, DEFAULT_CUSTOM_PROMPT, INITIAL_DEDUP_METRICS } from "@/lib/ops/rules-data"
import type { ChannelCooldown, DeduplicationMetrics, InspectionRule } from "@/lib/ops/rules-types"

import { type CustomRuleInput, type RulePatch, useServerRules } from "./use-server-rules"

export type { CustomRuleInput }

const TICK_MS = 500
const IDLE_POLL_MS = 5000
const STORM_POLL_MS = 400
const STORM_COUNT = 6
const STORM_SPACING_MS = 500
const DEFAULT_WINDOW_SECONDS = 60

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

interface TimedSnapshot extends SuppressionSnapshot {
  receivedAt: number
}

async function fetchSnapshot(url: string): Promise<TimedSnapshot> {
  const snapshot = await getJson<SuppressionSnapshot>(url)
  return { ...snapshot, receivedAt: Date.now() }
}

function idleCooldown(): ChannelCooldown {
  return { incidentId: null, elapsed: 0, windowSeconds: DEFAULT_WINDOW_SECONDS, pulses: [] }
}

/** Projects the server's window state forward by the time elapsed since it was received. */
function projectCooldowns(snapshot: TimedSnapshot | undefined, now: number): Record<string, ChannelCooldown> {
  const result: Record<string, ChannelCooldown> = {}
  for (const channelId of ALL_CHANNELS) {
    const status = snapshot?.channels[channelId]
    if (!snapshot || !status) {
      result[channelId] = idleCooldown()
      continue
    }
    const pulses = status.pulses.map((pulse) => ({
      id: pulse.id,
      offset: pulse.offsetSec,
      kind: pulse.kind,
    }))
    const last = pulses.length ? pulses[pulses.length - 1].offset : 0
    const drift = Math.max(0, (now - snapshot.receivedAt) / 1000)
    result[channelId] = {
      incidentId: status.incidentId,
      windowSeconds: status.windowSeconds,
      pulses,
      elapsed: Math.min(status.elapsedSec + drift, last + status.windowSeconds),
    }
  }
  return result
}

interface RulesContextValue {
  rules: InspectionRule[]
  rulesError: boolean
  updateRule: (id: string, patch: RulePatch) => Promise<void>
  addCustomRule: (input: CustomRuleInput) => Promise<boolean>
  deleteRule: (id: string) => Promise<boolean>
  resetRules: () => Promise<boolean>
  loadGmpPreset: () => Promise<boolean>
  metrics: DeduplicationMetrics
  cooldowns: Record<string, ChannelCooldown>
  engineReady: boolean
  engineError: boolean
  selectedChannel: string
  setSelectedChannel: (id: string) => void
  triggerOnce: (channelId: string) => Promise<void>
  runStorm: (channelId: string) => Promise<void>
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
  const { mutate: mutateGlobal } = useSWRConfig()
  const [selectedChannel, setSelectedChannel] = React.useState("CAM-02")
  const [stormRunning, setStormRunning] = React.useState(false)
  const [customDialogOpen, setCustomDialogOpen] = React.useState(false)
  const [now, setNow] = React.useState(() => Date.now())

  const { rules, rulesError, updateRule, addCustomRule, deleteRule, resetRules, loadGmpPreset } = useServerRules()
  const {
    data: snapshot,
    error: snapshotError,
    mutate: mutateSnapshot,
  } = useSWR<TimedSnapshot>(SUPPRESS_ENDPOINT, fetchSnapshot, {
    refreshInterval: stormRunning ? STORM_POLL_MS : IDLE_POLL_MS,
    dedupingInterval: 200,
  })

  React.useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), TICK_MS)
    return () => window.clearInterval(interval)
  }, [])

  const cooldowns = React.useMemo(() => projectCooldowns(snapshot, now), [snapshot, now])
  const metrics = snapshot?.metrics ?? INITIAL_DEDUP_METRICS

  const refreshAfterTrigger = React.useCallback(async () => {
    await Promise.all([mutateSnapshot(), mutateGlobal(CLUSTER_ENDPOINT)])
  }, [mutateSnapshot, mutateGlobal])

  const triggerOnce = React.useCallback(
    async (channelId: string) => {
      try {
        const response = await sendJson<SuppressResponse>(SUPPRESS_ENDPOINT, "POST", { channelId })
        if (response.suppressed) {
          toast.info("重复触发已被服务端抑制", {
            description: `证据已追加到工单 ${response.incidentId}，剩余冷却 ${response.cooldownRemainingSec} 秒。`,
          })
        } else {
          toast.warning("服务端已创建新工单并派发声光告警", {
            description: `${response.incidentId} · ${channelId} 进入 ${response.windowSeconds}s 冷却窗口。`,
          })
        }
        await refreshAfterTrigger()
      } catch (error) {
        toast.error("触发失败", { description: errorMessage(error) })
      }
    },
    [refreshAfterTrigger]
  )

  const runStorm = React.useCallback(
    async (channelId: string) => {
      if (stormRunning) return
      setStormRunning(true)
      try {
        const response = await sendJson<StormResponse>(STORM_ENDPOINT, "POST", {
          channelId,
          count: STORM_COUNT,
          spacingMs: STORM_SPACING_MS,
        })
        toast.success("告警风暴已被防抖引擎消化", {
          description: response.foldedIntoExisting
            ? `服务端已将 ${response.total} 次连续触发合并至已有工单 ${response.primaryIncidentId}，剩余冷却 ${response.cooldownRemainingSec} 秒。`
            : `${response.total} 次连续触发 = ${response.incidentsCreated} 张正式工单 + ${response.suppressedCount} 次折叠追加，剩余冷却 ${response.cooldownRemainingSec} 秒。`,
        })
      } catch (error) {
        toast.error("告警风暴注入失败", { description: errorMessage(error) })
      } finally {
        setStormRunning(false)
        await refreshAfterTrigger()
      }
    },
    [stormRunning, refreshAfterTrigger]
  )

  const value = React.useMemo<RulesContextValue>(
    () => ({
      rules,
      rulesError: Boolean(rulesError),
      updateRule,
      addCustomRule,
      deleteRule,
      resetRules,
      loadGmpPreset,
      metrics,
      cooldowns,
      engineReady: snapshot !== undefined,
      engineError: Boolean(snapshotError) && snapshot === undefined,
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
      rulesError,
      updateRule,
      addCustomRule,
      deleteRule,
      resetRules,
      loadGmpPreset,
      metrics,
      cooldowns,
      snapshot,
      snapshotError,
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
