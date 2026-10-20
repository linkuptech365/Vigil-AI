"use client"

import * as React from "react"
import { toast } from "sonner"

import type { EscalationClip } from "@/lib/ops/perception-types"
import type { VlmFinalResult, VlmKeyframeInput, VlmMetrics, VlmStreamChunk } from "@/lib/ops/vlm-api-types"
import { readVlmEndpoint, streamVlmAnalyze } from "@/lib/ops/vlm-client"
import {
  FRAME_COUNT,
  SCENARIOS,
  VLM_MODELS,
  eventIdOf,
  frameMark,
  frameSeconds,
  frameTag,
} from "@/lib/ops/vlm-data"
import type { VlmModelConfig, VlmPhase, VlmReasoningResult, VlmScenario } from "@/lib/ops/vlm-types"
import { usePerception } from "../perception/perception-provider"

const PROMPT_TOKENS_ESTIMATE = 380 + FRAME_COUNT * 255

interface VlmContextValue {
  models: VlmModelConfig[]
  model: VlmModelConfig
  setModelId: (id: string) => void
  candidates: EscalationClip[]
  activeClip: EscalationClip | null
  setClipId: (id: string) => void
  scenario: VlmScenario | null
  phase: VlmPhase
  thinkingMessage: string
  streamText: string
  promptTokens: number
  completionTokens: number
  metrics: VlmMetrics | null
  /** 从 0 开始的关键帧下标；null 表示模型尚未给出证据帧 */
  evidenceFrames: number[] | null
  result: VlmReasoningResult | null
  run: () => void
}

const VlmContext = React.createContext<VlmContextValue | null>(null)

export function useVlm() {
  const ctx = React.useContext(VlmContext)
  if (!ctx) throw new Error("useVlm must be used within VlmProvider")
  return ctx
}

function estimateOutputTokens(text: string) {
  return Math.round(text.length / 1.6)
}

function buildKeyframes(): VlmKeyframeInput[] {
  return Array.from({ length: FRAME_COUNT }, (_, i) => ({
    index: i + 1,
    timestampSec: frameSeconds(i),
    timecode: frameMark(i),
  }))
}

function toZeroBased(frames: number[]) {
  return Array.from(new Set(frames.map((f) => f - 1).filter((f) => f >= 0 && f < FRAME_COUNT)))
}

function deriveChain(reasoning: string, intent: string) {
  const steps: string[] = []
  let section = ""
  for (const raw of reasoning.split("\n")) {
    const line = raw.trim()
    if (line.startsWith("### ")) {
      section = line.slice(4)
    } else if (line.startsWith("```")) {
      section = "json"
    } else if (section.includes("时序观察") && line.startsWith("- ")) {
      steps.push(line.slice(2))
    } else if (section.includes("研判结论") && line) {
      steps.push(line)
    }
  }
  if (steps.length >= 2) return steps
  return intent
    .split(/(?<=[。；])/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function toReasoningResult(
  clip: EscalationClip,
  model: VlmModelConfig,
  scenario: VlmScenario,
  final: VlmFinalResult,
  metrics: VlmMetrics,
  reasoning: string
): VlmReasoningResult {
  const eventId = eventIdOf(clip)
  const evidence = toZeroBased(final.evidenceKeyframes)
  const confidence = Math.round(final.confidence * 1000) / 10

  return {
    eventId,
    channelId: clip.cameraId,
    modelUsed: model.name,
    confidence,
    severity: final.severity,
    summary: final.intentAnalysis,
    reasoningChain: deriveChain(reasoning, final.intentAnalysis),
    evidenceKeyframes: evidence,
    violationClauses: final.violationClauses,
    actionAdvice: final.actionAdvice,
    tokenUsage: { prompt: metrics.promptTokens, completion: metrics.outputTokens, totalCost: metrics.costUsd },
    rawJson: {
      schema_version: "vigil.vlm.v1",
      event_id: eventId,
      channel_id: clip.cameraId,
      source_clip: clip.id,
      model: model.name,
      engine: metrics.source,
      ...(metrics.fallbackReason ? { fallback_reason: metrics.fallbackReason } : {}),
      severity: final.severity,
      confidence: final.confidence,
      summary: final.summary,
      behavior: { type: scenario.title, intent: final.intentAnalysis },
      rule_triggered: final.ruleTriggered,
      evidence_keyframes: evidence.map((i) => ({
        index: i + 1,
        offset: frameTag(i),
        timestamp: frameMark(i),
      })),
      violated_clauses: final.violationClauses,
      recommended_action: final.actionAdvice,
      tier1_trigger: clip.reason,
      token_usage: { prompt: metrics.promptTokens, completion: metrics.outputTokens },
      first_token_ms: metrics.firstTokenMs,
      latency_ms: metrics.rttMs,
      human_review_required: final.severity === "CRITICAL",
    },
  }
}

export function VlmProvider({ children }: { children: React.ReactNode }) {
  const { clips } = usePerception()
  const [modelId, setModelIdState] = React.useState(VLM_MODELS[0].id)
  const [clipId, setClipIdState] = React.useState<string | null>(null)
  const [phase, setPhase] = React.useState<VlmPhase>("idle")
  const [thinkingMessage, setThinkingMessage] = React.useState("")
  const [streamText, setStreamText] = React.useState("")
  const [completionTokens, setCompletionTokens] = React.useState(0)
  const [metrics, setMetrics] = React.useState<VlmMetrics | null>(null)
  const [evidenceFrames, setEvidenceFrames] = React.useState<number[] | null>(null)
  const [result, setResult] = React.useState<VlmReasoningResult | null>(null)
  const abortRef = React.useRef<AbortController | null>(null)

  const model = VLM_MODELS.find((m) => m.id === modelId) ?? VLM_MODELS[0]
  const candidates = React.useMemo(() => clips.filter((clip) => clip.status !== "blocked"), [clips])
  const activeClip =
    candidates.find((clip) => clip.id === clipId) ??
    candidates.find((clip) => clip.reason === "fall_suspect") ??
    candidates[0] ??
    null
  const scenario = activeClip ? SCENARIOS[activeClip.reason] : null

  const resetRun = React.useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setPhase("idle")
    setThinkingMessage("")
    setStreamText("")
    setCompletionTokens(0)
    setMetrics(null)
    setEvidenceFrames(null)
    setResult(null)
  }, [])

  React.useEffect(() => () => abortRef.current?.abort(), [])

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

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    let text = ""
    let finished = false

    setResult(null)
    setMetrics(null)
    setEvidenceFrames(null)
    setStreamText("")
    setCompletionTokens(0)
    setThinkingMessage("")
    setPhase("thinking")

    const handleChunk = (chunk: VlmStreamChunk) => {
      if (controller.signal.aborted) return
      switch (chunk.type) {
        case "thinking":
          setThinkingMessage(chunk.message)
          break
        case "reset":
          text = ""
          setStreamText("")
          setCompletionTokens(0)
          setEvidenceFrames(null)
          setPhase("thinking")
          break
        case "token":
          text += chunk.content
          setPhase("streaming")
          setStreamText(text)
          setCompletionTokens(estimateOutputTokens(text))
          break
        case "evidence":
          setEvidenceFrames(toZeroBased(chunk.frames))
          break
        case "done": {
          finished = true
          const reasoningResult = toReasoningResult(activeClip, model, scenario, chunk.result, chunk.metrics, text)
          setResult(reasoningResult)
          setMetrics(chunk.metrics)
          setCompletionTokens(chunk.metrics.outputTokens)
          setEvidenceFrames(reasoningResult.evidenceKeyframes)
          setPhase("done")
          toast.success(`${reasoningResult.eventId} 深度研判完成`, {
            description: `${chunk.result.severity} · 置信度 ${reasoningResult.confidence.toFixed(1)}% · ${
              chunk.metrics.source === "remote" ? "远端模型" : "离线模拟引擎"
            }`,
          })
          break
        }
        case "error":
          throw new Error(chunk.message)
      }
    }

    const { apiUrl, apiKey } = readVlmEndpoint()

    streamVlmAnalyze(
      {
        videoPath: `${activeClip.cameraId}/${activeClip.id}`,
        keyframes: buildKeyframes(),
        apiUrl,
        apiKey,
        modelName: model.id,
        ruleScenario: `${scenario.title}（一级初筛: ${scenario.cvSaw}）`,
      },
      handleChunk,
      controller.signal
    )
      .then(() => {
        if (!finished && !controller.signal.aborted) throw new Error("推理流意外中断，未收到最终结果")
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setPhase("idle")
        setThinkingMessage("")
        toast.error("VLM 研判失败", {
          description: error instanceof Error ? error.message : "未知错误",
        })
      })
  }, [activeClip, scenario, model])

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
      thinkingMessage,
      streamText,
      promptTokens: metrics?.promptTokens ?? PROMPT_TOKENS_ESTIMATE,
      completionTokens,
      metrics,
      evidenceFrames,
      result,
      run,
    }),
    [
      model,
      setModelId,
      candidates,
      activeClip,
      setClipId,
      scenario,
      phase,
      thinkingMessage,
      streamText,
      completionTokens,
      metrics,
      evidenceFrames,
      result,
      run,
    ]
  )

  return <VlmContext.Provider value={value}>{children}</VlmContext.Provider>
}
