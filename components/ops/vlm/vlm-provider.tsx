"use client"

import * as React from "react"
import { toast } from "sonner"
import useSWR from "swr"

import { useModelProfiles } from "@/components/vigil/config/use-model-profiles"
import { useVigil } from "@/components/vigil/vigil-provider"
import {
  buildLocalSlices,
  toLocalReasoningResult,
  type LocalSlice,
} from "@/lib/ops/local-slice"
import type { VlmCandidate } from "@/lib/ops/rag-types"
import { bindsSource, isGeometricOnlyRule } from "@/lib/ops/rule-binding"
import type { RulesListResponse } from "@/lib/ops/rules-api-types"
import type { InspectionRule } from "@/lib/ops/rules-types"
import type {
  VlmAnalyzeRequest,
  VlmFinalResult,
  VlmKeyframeInput,
  VlmMetrics,
  VlmStreamChunk,
} from "@/lib/ops/vlm-api-types"
import type { ChunkFrame } from "@/lib/vigil/types"
import { toRequestVideoPath } from "@/lib/vigil/video-path"
import { getVideoSrc } from "@/lib/vigil/video-source"
import { streamAlertAnalyze, streamVlmAnalyze } from "@/lib/ops/vlm-client"
import { FRAME_COUNT } from "@/lib/ops/vlm-data"
import type { VlmModelConfig, VlmPhase, VlmReasoningResult } from "@/lib/ops/vlm-types"
import { MODEL_PROVIDERS, profileReadiness } from "@/lib/vigil/model-registry"

interface CandidatesResponse {
  status: "success"
  candidates: VlmCandidate[]
}

async function fetchCandidates(url: string): Promise<CandidatesResponse> {
  const response = await fetch(url, { cache: "no-store" })
  if (!response.ok) throw new Error(`候选列表加载失败（HTTP ${response.status}）`)
  return (await response.json()) as CandidatesResponse
}

async function fetchRules(url: string): Promise<RulesListResponse> {
  const response = await fetch(url, { cache: "no-store" })
  if (!response.ok) throw new Error(`规则列表加载失败（HTTP ${response.status}）`)
  return (await response.json()) as RulesListResponse
}

export interface RuleOption {
  id: string
  name: string
  /** 纯几何规则由一级引擎判定，不送大模型，界面置灰不可选 */
  geometric: boolean
}

const NO_MODEL: VlmModelConfig = {
  id: "",
  name: "未配置可用模型",
  provider: "请到「配置」页添加并启用模型",
  latencyMs: 0,
  contextWindow: "-",
  costPer1kTokens: 0,
}

const PROMPT_TOKENS_ESTIMATE = 380 + FRAME_COUNT * 255

interface VlmContextValue {
  models: VlmModelConfig[]
  model: VlmModelConfig
  setModelId: (id: string) => void
  /** 一级初筛真实命中并落库的告警（含留存证据帧） */
  candidates: VlmCandidate[]
  candidatesLoading: boolean
  candidatesError: string | null
  activeCandidate: VlmCandidate | null
  /** 告警 ID，或本地切片 ID（slice:*） */
  setClipId: (id: string) => void
  /** 下拉框当前选中项 */
  selectionId: string | null
  /** 全局队列里已经开始分析的本地视频切片 */
  localSlices: LocalSlice[]
  activeLocal: LocalSlice | null
  /** 本地切片的真实关键帧；刷新页面后会自动从视频重新抽取 */
  localFrames: ChunkFrame[]
  localFramesLoading: boolean
  localFramesError: string | null
  phase: VlmPhase
  thinkingMessage: string
  streamText: string
  promptTokens: number
  completionTokens: number
  metrics: VlmMetrics | null
  /** 从 0 开始的关键帧下标；null 表示模型尚未给出证据帧 */
  evidenceFrames: number[] | null
  result: VlmReasoningResult | null
  /** 当前候选所属通道下已启用的规则（含纯几何规则，供置灰展示） */
  ruleOptions: RuleOption[]
  ruleOptionsLoading: boolean
  selectedRuleIds: string[]
  setSelectedRuleIds: (ids: string[]) => void
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

/** 告警证据帧下标从 1 起，转为界面使用的 0 起下标并过滤越界。 */
function toZeroBased(frames: number[], count: number) {
  return Array.from(new Set(frames.map((f) => f - 1).filter((f) => Number.isInteger(f) && f >= 0 && f < count)))
}

/** 本地切片的关键帧下标本来就是从 0 起，只做越界过滤。 */
function clampZeroBased(frames: number[], count: number) {
  return Array.from(new Set(frames.filter((f) => Number.isInteger(f) && f >= 0 && f < count)))
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

function toCandidateResult(
  candidate: VlmCandidate,
  modelName: string,
  final: VlmFinalResult,
  metrics: VlmMetrics,
  reasoning: string,
  chain?: string[]
): VlmReasoningResult {
  const eventId = candidate.caseId ?? candidate.alertId
  const evidence = toZeroBased(final.evidenceKeyframes, candidate.frameCount)
  const confidence = Math.round(final.confidence * 1000) / 10

  return {
    eventId,
    channelId: candidate.channelId,
    modelUsed: modelName,
    confidence,
    severity: final.severity,
    summary: final.summary,
    reasoningChain: chain && chain.length > 0 ? chain : deriveChain(reasoning, final.reasoning),
    evidenceKeyframes: evidence,
    violationClauses: final.triggered ? [final.ruleTriggered] : [],
    actionAdvice: final.advice,
    tokenUsage: { prompt: metrics.promptTokens, completion: metrics.outputTokens, totalCost: metrics.costUsd },
    rawJson: {
      schema_version: "vigil.vlm.v1",
      event_id: eventId,
      alert_id: candidate.alertId,
      channel_id: candidate.channelId,
      model: modelName,
      engine: metrics.source,
      ...(metrics.fallbackReason ? { fallback_reason: metrics.fallbackReason } : {}),
      severity: final.severity,
      confidence: final.confidence,
      summary: final.summary,
      behavior: { type: candidate.ruleName, intent: final.reasoning },
      rule_triggered: final.ruleTriggered,
      timestamp_offset: final.timestampOffset,
      bbox: final.bbox,
      evidence_keyframes: evidence.map((i) => ({ index: i + 1 })),
      violated_clauses: final.triggered ? [final.ruleTriggered] : [],
      recommended_action: final.advice,
      tier1_rule: candidate.ruleName,
      tier1_summary: candidate.tier1Summary,
      token_usage: { prompt: metrics.promptTokens, completion: metrics.outputTokens },
      first_token_ms: metrics.firstTokenMs,
      latency_ms: metrics.rttMs,
      human_review_required: final.severity === "CRITICAL",
    },
  }
}

export function VlmProvider({ children }: { children: React.ReactNode }) {
  const { data: candidateData, error: candidateFetchError, isLoading: candidatesLoading, mutate: refreshCandidates } = useSWR(
    "/api/v1/vlm/candidates",
    fetchCandidates,
    { refreshInterval: 15_000, revalidateOnFocus: true }
  )
  const { queue, updateChunk, recaptureChunkFrames, getLocalPromptRules } = useVigil()
  const [localFramesLoading, setLocalFramesLoading] = React.useState(false)
  const [localFramesError, setLocalFramesError] = React.useState<string | null>(null)
  const attemptedRecapture = React.useRef(new Set<string>())
  const { profiles, defaultProfile } = useModelProfiles()
  const [modelId, setModelIdState] = React.useState<string | null>(null)
  const [clipId, setClipIdState] = React.useState<string | null>(null)
  const [phase, setPhase] = React.useState<VlmPhase>("idle")
  const [thinkingMessage, setThinkingMessage] = React.useState("")
  const [streamText, setStreamText] = React.useState("")
  const [completionTokens, setCompletionTokens] = React.useState(0)
  const [metrics, setMetrics] = React.useState<VlmMetrics | null>(null)
  const [evidenceFrames, setEvidenceFrames] = React.useState<number[] | null>(null)
  const [result, setResult] = React.useState<VlmReasoningResult | null>(null)
  const abortRef = React.useRef<AbortController | null>(null)

  const models = React.useMemo<VlmModelConfig[]>(
    () =>
      profiles
        .filter((profile) => profile.enabled)
        .map((profile) => ({
          id: profile.id,
          name: profile.isDefault ? `${profile.name}（全局默认）` : profile.name,
          provider: `${MODEL_PROVIDERS.find((p) => p.id === profile.provider)?.label ?? profile.provider} · ${profile.modelName}`,
          latencyMs: 0,
          contextWindow: "-",
          costPer1kTokens: 0,
        })),
    [profiles]
  )
  const model =
    models.find((m) => m.id === modelId) ??
    models.find((m) => m.id === defaultProfile?.id) ??
    models[0] ??
    NO_MODEL
  const candidates = React.useMemo(() => candidateData?.candidates ?? [], [candidateData])
  const candidatesError = candidateFetchError instanceof Error ? candidateFetchError.message : null
  const localSlices = React.useMemo(() => buildLocalSlices(queue), [queue])
  const activeLocal = React.useMemo(
    () => (clipId ? (localSlices.find((slice) => slice.id === clipId) ?? null) : null),
    [localSlices, clipId]
  )
  const activeCandidate = activeLocal
    ? null
    : (candidates.find((item) => item.alertId === clipId) ?? candidates[0] ?? null)
  const selectionId = activeLocal?.id ?? activeCandidate?.alertId ?? null

  const { data: rulesData, isLoading: ruleOptionsLoading } = useSWR("/api/v1/rules", fetchRules, { revalidateOnFocus: true })
  const ruleOptions = React.useMemo<RuleOption[]>(() => {
    if (!activeCandidate) return []
    const source = { kind: "channel", channelId: activeCandidate.channelId } as const
    return (rulesData?.rules ?? [])
      .filter((rule: InspectionRule) => rule.enabled && bindsSource(rule, source))
      .map((rule) => ({ id: rule.id, name: rule.name, geometric: isGeometricOnlyRule(rule) }))
  }, [rulesData, activeCandidate])

  const [ruleSelection, setRuleSelection] = React.useState<Record<string, string[]>>({})
  const selectedRuleIds = React.useMemo(() => {
    if (!activeCandidate) return []
    const selectable = new Set(ruleOptions.filter((rule) => !rule.geometric).map((rule) => rule.id))
    const stored = ruleSelection[activeCandidate.alertId]
    if (stored) return stored.filter((id) => selectable.has(id))
    return selectable.has(activeCandidate.ruleId) ? [activeCandidate.ruleId] : []
  }, [activeCandidate, ruleOptions, ruleSelection])
  const setSelectedRuleIds = React.useCallback(
    (ids: string[]) => {
      if (!activeCandidate) return
      setRuleSelection((prev) => ({ ...prev, [activeCandidate.alertId]: ids }))
    },
    [activeCandidate]
  )

  const localFrames = React.useMemo(() => activeLocal?.chunk.frames ?? [], [activeLocal])
  const activeLocalId = activeLocal?.id ?? null
  const needsRecapture =
    !!activeLocal && activeLocal.chunk.status !== "analyzing" && !localFrames.some((f) => f.base64)

  React.useEffect(() => {
    if (!activeLocal || !needsRecapture || attemptedRecapture.current.has(activeLocal.id)) return
    attemptedRecapture.current.add(activeLocal.id)
    let cancelled = false
    setLocalFramesLoading(true)
    setLocalFramesError(null)
    recaptureChunkFrames(activeLocal.video.id, activeLocal.chunk.index)
      .catch((error: unknown) => {
        if (!cancelled) setLocalFramesError(error instanceof Error ? error.message : "重新抽帧失败")
      })
      .finally(() => {
        if (!cancelled) setLocalFramesLoading(false)
      })
    return () => {
      cancelled = true
      setLocalFramesLoading(false)
    }
    // 仅在切换切片时触发；recapture 完成后 needsRecapture 会自然变为 false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLocalId, needsRecapture])

  const stored = React.useMemo(() => {
    const saved = activeCandidate?.vlm
    if (activeCandidate && saved) {
      return {
        reasoning: saved.reasoning,
        metrics: saved.metrics,
        result: toCandidateResult(
          activeCandidate,
          saved.metrics.model || "VLM",
          saved.result,
          saved.metrics,
          saved.reasoning,
          saved.reasoningChain
        ),
      }
    }
    const report = activeLocal?.chunk.report
    if (!activeLocal || !report) return null
    const count = activeLocal.chunk.frames.length
    return {
      reasoning: report.reasoning,
      metrics: report.metrics,
      result: toLocalReasoningResult(
        activeLocal,
        report.metrics.model || "VLM",
        report.result,
        report.metrics,
        report.reasoning,
        count
      ),
    }
  }, [activeLocal, activeCandidate])

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
    const profile = profiles.find((item) => item.id === model.id)
    const readiness = profile ? profileReadiness(profile) : { ready: false, reason: "尚未配置可用模型" }
    if (!profile || !readiness.ready) {
      toast.error("所选模型不可用", {
        description: `${profile?.name ?? "未选择模型"}：${readiness.reason ?? "请先在「配置」页完成模型配置。"}`,
      })
      return
    }

    const local = activeLocal
    const localKeyframes: VlmKeyframeInput[] = local
      ? local.chunk.frames
          .filter((f) => !!f.base64)
          .map((f, i) => ({ index: i, timestampSec: f.seconds, timecode: f.timestamp, imageUrl: f.base64 }))
      : []
    const localRules = local ? getLocalPromptRules() : []

    if (local) {
      if (localKeyframes.length === 0) {
        toast.error("该切片没有可用的关键帧图像", {
          description: localFramesError ?? "请等待关键帧重新抽取完成，或在检测队列中重新分析该视频。",
        })
        return
      }
      if (localRules.length === 0) {
        toast.error("没有适用于本地视频的规则", { description: "请先在规则中心启用并绑定「本地视频」或「全部视频源」。" })
        return
      }
    } else if (!activeCandidate) {
      toast.error("没有可研判的候选", { description: "一级初筛尚未产生已落库的命中告警。" })
      return
    } else if (selectedRuleIds.length === 0) {
      toast.error("请先选择生效规则", { description: "在「生效规则」下拉框中至少勾选一条语义规则，纯几何规则不送大模型。" })
      return
    }
    const candidate = activeCandidate

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
          setEvidenceFrames(
            local ? clampZeroBased(chunk.frames, localKeyframes.length) : toZeroBased(chunk.frames, candidate?.frameCount ?? 0)
          )
          break
        case "done": {
          finished = true
          let reasoningResult: VlmReasoningResult
          if (local) {
            reasoningResult = toLocalReasoningResult(
              local,
              chunk.metrics.model || model.name,
              chunk.result,
              chunk.metrics,
              text,
              localKeyframes.length
            )
            updateChunk(local.video.id, local.chunk.index, {
              status: chunk.verdict.triggered && chunk.verdict.ruleId ? "alert" : "safe",
              ruleId: chunk.verdict.ruleId ?? undefined,
              ruleName: chunk.verdict.ruleName ?? undefined,
              confidence: chunk.result.confidence,
              report: { result: chunk.result, metrics: chunk.metrics, verdict: chunk.verdict, reasoning: text },
              error: undefined,
              analyzedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
            })
          } else {
            reasoningResult = toCandidateResult(candidate!, chunk.metrics.model || model.name, chunk.result, chunk.metrics, text)
            void refreshCandidates()
          }
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

    const request: VlmAnalyzeRequest | null = local
      ? {
          videoPath: toRequestVideoPath(local.video),
          name: local.video.name,
          keyframes: localKeyframes,
          modelProfileId: profile.id,
          sourceType: "local",
          sourceKey: `LOCAL:${local.video.id}`,
          rules: localRules,
          simulation: { ruleId: local.chunk.ruleId ?? null, confidence: local.chunk.confidence },
        }
      : null

    const streaming = request
      ? streamVlmAnalyze(request, handleChunk, controller.signal)
      : streamAlertAnalyze(candidate!.alertId, profile.id, selectedRuleIds, handleChunk, controller.signal)

    streaming
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
  }, [activeCandidate, activeLocal, model, profiles, getLocalPromptRules, updateChunk, localFramesError, refreshCandidates, selectedRuleIds])

  const showStored = phase === "idle" && !result && !!stored
  const shownResult = result ?? (showStored ? stored.result : null)
  const shownMetrics = metrics ?? (showStored ? stored.metrics : null)
  const shownPhase: VlmPhase = showStored ? "done" : phase
  const shownText = showStored ? stored.reasoning : streamText
  const shownEvidence = evidenceFrames ?? (showStored ? stored.result.evidenceKeyframes : null)
  const shownCompletion = showStored ? stored.metrics.outputTokens : completionTokens

  const value = React.useMemo<VlmContextValue>(
    () => ({
      models,
      model,
      setModelId,
      candidates,
      candidatesLoading,
      candidatesError,
      activeCandidate,
      setClipId,
      selectionId,
      localSlices,
      activeLocal,
      localFrames,
      localFramesLoading,
      localFramesError,
      phase: shownPhase,
      thinkingMessage,
      streamText: shownText,
      promptTokens: shownMetrics?.promptTokens ?? PROMPT_TOKENS_ESTIMATE,
      completionTokens: shownCompletion,
      metrics: shownMetrics,
      evidenceFrames: shownEvidence,
      result: shownResult,
      ruleOptions,
      ruleOptionsLoading,
      selectedRuleIds,
      setSelectedRuleIds,
      run,
    }),
    [
      model,
      setModelId,
      candidates,
      candidatesLoading,
      candidatesError,
      activeCandidate,
      setClipId,
      selectionId,
      localSlices,
      activeLocal,
      localFrames,
      localFramesLoading,
      localFramesError,
      shownPhase,
      thinkingMessage,
      shownText,
      shownCompletion,
      shownMetrics,
      shownEvidence,
      shownResult,
      ruleOptions,
      ruleOptionsLoading,
      selectedRuleIds,
      setSelectedRuleIds,
      run,
    ]
  )

  return <VlmContext.Provider value={value}>{children}</VlmContext.Provider>
}
