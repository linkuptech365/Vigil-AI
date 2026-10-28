import { isGeometricOnlyRule, matchRulesForSource, ruleDescription, ruleSensitivity } from "@/lib/ops/rule-binding"
import type { InspectionRule } from "@/lib/ops/rules-types"
import { pipelineVlmContext } from "@/lib/ops/rule-pipeline"
import { getProfile, resolveEndpointUrl } from "@/lib/ops/server/model-profiles"
import { indexAlertNow } from "@/lib/ops/server/rag-indexer"
import { feedbackFromAnalysis, learnedRuleTuning, tier1ExistingForSource } from "@/lib/ops/server/tier1-feedback"
import { runAnalysis } from "@/lib/ops/server/vlm-engine"
import type { NormalizedInput } from "@/lib/ops/server/vlm-shared"
import type { VlmKeyframeInput, VlmPromptRule, VlmStreamChunk } from "@/lib/ops/vlm-api-types"
import { loadRules } from "@/lib/storage/rules-store"
import { getAlert, readEvidenceFrame, updateAlert } from "@/lib/storage/streams-store"
import { profileReadiness } from "@/lib/vigil/model-registry"
import type { AlertVlmAnalysis, StreamAlert } from "@/lib/vigil/streams"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const MAX_EVIDENCE_FRAMES = 6

function fail(message: string, status: number, code?: string) {
  return Response.json({ status: "error", message, ...(code ? { error: code } : {}) }, { status, headers: { "Cache-Control": "no-store" } })
}

function toPromptRule(rule: InspectionRule, streamId: string): VlmPromptRule {
  const tuning = learnedRuleTuning(streamId)
  const vlm = pipelineVlmContext(rule.pipeline)
  const base = ruleDescription(rule)
  return {
    id: rule.id,
    name: rule.name,
    description: vlm.intent ? `${base}\n核心违规意图：${vlm.intent}` : base,
    sensitivity: Math.min(0.98, Math.round((ruleSensitivity(rule) + (tuning.sensitivityBoost[rule.id] ?? 0)) * 100) / 100),
    severity: rule.severity,
    cooldownSeconds: rule.cooldownSeconds,
    exclusions: [...new Set([...(rule.exclusions ?? []), ...vlm.exclusions, ...tuning.exclusions])],
  }
}

/**
 * 二级研判只带真实规则：先按告警的 ruleId 反查命中的规则；
 * 取不到（或命中的是纯几何规则）时，仅取该告警所属通道当前已启用、绑定且需要 VLM 的规则。
 * 不再退回告警快照或任何内置默认规则；一个都没有时返回空数组，由调用方报错。
 */
function buildRules(alert: StreamAlert): VlmPromptRule[] {
  const rules = loadRules()
  const hit = rules.find((item) => item.id === alert.ruleId)
  const scoped =
    hit && !isGeometricOnlyRule(hit)
      ? [hit]
      : matchRulesForSource(rules, { kind: "channel", channelId: alert.streamId }).filter((rule) => !isGeometricOnlyRule(rule))
  return scoped.map((rule) => toPromptRule(rule, alert.streamId))
}

/** 按序号读取完整时序证据帧；元数据缺失的帧再按磁盘文件补齐，避免只送一张静态图。 */
function loadKeyframes(alert: StreamAlert): VlmKeyframeInput[] {
  const meta = new Map(alert.frames.map((frame) => [frame.index, frame]))
  const indexes = [...new Set([...meta.keys(), ...Array.from({ length: MAX_EVIDENCE_FRAMES }, (_, i) => i + 1)])]
    .filter((index) => index >= 1 && index <= MAX_EVIDENCE_FRAMES)
    .sort((a, b) => a - b)
  const firstAt = alert.frames[0] ? new Date(alert.frames[0].capturedAt).getTime() : 0
  const keyframes: VlmKeyframeInput[] = []
  for (const index of indexes) {
    const buffer = readEvidenceFrame(alert.id, index)
    if (!buffer) continue
    const frame = meta.get(index)
    const seconds = frame ? Math.max(0, (new Date(frame.capturedAt).getTime() - firstAt) / 1000) : (keyframes.at(-1)?.timestampSec ?? 0) + 0.7
    keyframes.push({
      index,
      timestampSec: seconds,
      timecode: frame?.timecode ?? `00:${String(Math.floor(seconds)).padStart(2, "0")}.${String(Math.round((seconds % 1) * 1000)).padStart(3, "0")}`,
      imageUrl: `data:image/jpeg;base64,${buffer.toString("base64")}`,
    })
  }
  return keyframes
}

function deriveChain(reasoning: string, fallback: string) {
  const steps: string[] = []
  let section = ""
  for (const raw of reasoning.split("\n")) {
    const line = raw.trim()
    if (line.startsWith("### ")) section = line.slice(4)
    else if (line.startsWith("```")) section = "json"
    else if (section.includes("时序观察") && line.startsWith("- ")) steps.push(line.slice(2))
    else if (section.includes("研判结论") && line) steps.push(line)
  }
  if (steps.length >= 2) return steps
  return fallback
    .split(/(?<=[。；])/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export async function POST(request: Request, { params }: { params: Promise<{ alertId: string }> }) {
  const { alertId } = await params
  const alert = getAlert(alertId)
  if (!alert) return fail("告警不存在或已过保留期被清理", 404, "ALERT_NOT_FOUND")

  const body = (await request.json().catch(() => null)) as { modelProfileId?: unknown } | null
  const profileId = typeof body?.modelProfileId === "string" ? body.modelProfileId.trim() : ""
  const profile = profileId ? getProfile(profileId) : null
  if (!profile) return fail("模型档案不存在，请到配置中心检查模型网关", 400, "MODEL_NOT_FOUND")
  const readiness = profileReadiness({ ...profile, hasKey: profile.apiKey.length > 0 })
  if (!readiness.ready) return fail(`模型「${profile.name}」尚未就绪：${readiness.reason}`, 400, "MODEL_NOT_READY")

  const keyframes = loadKeyframes(alert)
  if (keyframes.length === 0) return fail("该告警的证据帧已丢失或已过保留期，无法进行二级研判", 409, "NO_VALID_IMAGE_FRAMES")

  const rules = buildRules(alert)
  if (rules.length === 0) {
    return fail(`通道「${alert.streamName}」没有可用于二级研判的已启用语义规则（纯几何规则不送大模型），请先在规则库为该通道绑定规则`, 409, "NO_RULES")
  }
  const source: AlertVlmAnalysis["ruleSource"] = "rule_library"
  const abort = new AbortController()
  request.signal.addEventListener("abort", () => abort.abort(), { once: true })

  const input: NormalizedInput = {
    keyframes,
    apiUrl: resolveEndpointUrl(profile),
    apiKey: profile.apiKey || undefined,
    modelName: profile.modelName,
    sourceType: "channel",
    sourceKey: alert.streamId,
    rules,
    stream: true,
    remoteStream: false,
    tier1Existing: tier1ExistingForSource("channel", alert.streamId),
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: VlmStreamChunk) => {
        if (abort.signal.aborted) return
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
      }
      let reasoning = ""
      try {
        const engineCtx = {
          signal: abort.signal,
          pace: true,
          requestHost: request.headers.get("host"),
          call: {
            trigger: "manual" as const,
            streamId: alert.streamId,
            streamName: alert.streamName,
            alertId: alert.id,
          },
        }
        for await (const chunk of runAnalysis(input, engineCtx)) {
          if (chunk.type === "token") reasoning += chunk.content
          else if (chunk.type === "reset") reasoning = ""
          else if (chunk.type === "done") {
            feedbackFromAnalysis("channel", alert.streamId, chunk.result, chunk.verdict)
            const analysis: AlertVlmAnalysis = {
              analyzedAt: new Date().toISOString(),
              frameCount: keyframes.length,
              ruleSource: source,
              result: chunk.result,
              metrics: chunk.metrics,
              verdict: chunk.verdict,
              reasoning,
              reasoningChain: deriveChain(reasoning, chunk.result.reasoning),
              action: chunk.result.fine?.primary_action,
              medium: chunk.result.fine?.interaction_target?.category,
              exclusion: chunk.verdict.excluded ?? null,
            }
            updateAlert(alert.id, (current) => ({ ...current, vlm: analysis }))
            indexAlertNow(alert.id)
          }
          send(chunk)
        }
      } catch (error) {
        send({ type: "error", message: error instanceof Error ? error.message : "推理引擎内部错误" })
      } finally {
        if (!abort.signal.aborted) controller.close()
      }
    },
    cancel() {
      abort.abort()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
