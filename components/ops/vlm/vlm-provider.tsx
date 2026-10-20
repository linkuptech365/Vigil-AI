"use client"

import * as React from "react"
import { toast } from "sonner"

import type { EscalationClip } from "@/lib/ops/perception-types"
import { SCENARIOS, VLM_MODELS, buildResult, composeStreamText } from "@/lib/ops/vlm-data"
import type { VlmModelConfig, VlmPhase, VlmReasoningResult, VlmScenario } from "@/lib/ops/vlm-types"
import { usePerception } from "../perception/perception-provider"

const THINKING_MS = 1100
const TICK_MS = 40
const CHARS_PER_TICK = 9

interface VlmContextValue {
  models: VlmModelConfig[]
  model: VlmModelConfig
  setModelId: (id: string) => void
  candidates: EscalationClip[]
  activeClip: EscalationClip | null
  setClipId: (id: string) => void
  scenario: VlmScenario | null
  phase: VlmPhase
  streamText: string
  promptTokens: number
  completionTokens: number
  result: VlmReasoningResult | null
  run: () => void
}

const VlmContext = React.createContext<VlmContextValue | null>(null)

export function useVlm() {
  const ctx = React.useContext(VlmContext)
  if (!ctx) throw new Error("useVlm must be used within VlmProvider")
  return ctx
}

export function VlmProvider({ children }: { children: React.ReactNode }) {
  const { clips } = usePerception()
  const [modelId, setModelIdState] = React.useState(VLM_MODELS[0].id)
  const [clipId, setClipIdState] = React.useState<string | null>(null)
  const [phase, setPhase] = React.useState<VlmPhase>("idle")
  const [streamText, setStreamText] = React.useState("")
  const [completionTokens, setCompletionTokens] = React.useState(0)
  const [result, setResult] = React.useState<VlmReasoningResult | null>(null)
  const thinkTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const streamTimer = React.useRef<ReturnType<typeof setInterval> | null>(null)

  const model = VLM_MODELS.find((m) => m.id === modelId) ?? VLM_MODELS[0]
  const candidates = React.useMemo(() => clips.filter((clip) => clip.status !== "blocked"), [clips])
  const activeClip =
    candidates.find((clip) => clip.id === clipId) ??
    candidates.find((clip) => clip.reason === "fall_suspect") ??
    candidates[0] ??
    null
  const scenario = activeClip ? SCENARIOS[activeClip.reason] : null

  const stopTimers = React.useCallback(() => {
    if (thinkTimer.current) clearTimeout(thinkTimer.current)
    if (streamTimer.current) clearInterval(streamTimer.current)
    thinkTimer.current = null
    streamTimer.current = null
  }, [])

  const resetRun = React.useCallback(() => {
    stopTimers()
    setPhase("idle")
    setStreamText("")
    setCompletionTokens(0)
    setResult(null)
  }, [stopTimers])

  React.useEffect(() => stopTimers, [stopTimers])

  const setModelId = React.useCallback(
    (id: string) => {
      resetRun()
      setModelIdState(id)
    },
    [resetRun]
  )

  const setClipId = React.useCallback(
    (id: string) => {
      resetRun()
      setClipIdState(id)
    },
    [resetRun]
  )

  const run = React.useCallback(() => {
    if (!activeClip || !scenario) return
    stopTimers()
    const finalResult = buildResult(activeClip, model)
    const fullText = composeStreamText(finalResult, scenario)

    setResult(null)
    setStreamText("")
    setCompletionTokens(0)
    setPhase("thinking")

    thinkTimer.current = setTimeout(() => {
      setPhase("streaming")
      let cursor = 0
      streamTimer.current = setInterval(() => {
        cursor = Math.min(fullText.length, cursor + CHARS_PER_TICK)
        setStreamText(fullText.slice(0, cursor))
        setCompletionTokens(Math.round((finalResult.tokenUsage.completion * cursor) / fullText.length))
        if (cursor >= fullText.length) {
          stopTimers()
          setResult(finalResult)
          setPhase("done")
          toast.success(`${finalResult.eventId} 深度研判完成`, {
            description: `${finalResult.severity} · 置信度 ${finalResult.confidence.toFixed(1)}%`,
          })
        }
      }, TICK_MS)
    }, THINKING_MS)
  }, [activeClip, scenario, model, stopTimers])

  const promptTokens = React.useMemo(
    () => (activeClip ? buildResult(activeClip, model).tokenUsage.prompt : 0),
    [activeClip, model]
  )

  const value = React.useMemo<VlmContextValue>(
    () => ({
      models: VLM_MODELS,
      model,
      setModelId,
      candidates,
      activeClip,
      setClipId,
      scenario,
      phase,
      streamText,
      promptTokens,
      completionTokens,
      result,
      run,
    }),
    [model, setModelId, candidates, activeClip, setClipId, scenario, phase, streamText, promptTokens, completionTokens, result, run]
  )

  return <VlmContext.Provider value={value}>{children}</VlmContext.Provider>
}
