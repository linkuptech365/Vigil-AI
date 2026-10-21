import type { VlmFinalResult, VlmMetrics, VlmStreamChunk, VlmVerdict } from "../vlm-api-types"
import { registerTrigger } from "./rule-engine"
import type { NormalizedInput } from "./vlm-shared"

/** 引擎内部产出的 done 事件：尚未经过阈值校验与防抖聚合。 */
export type PreVerdictChunk =
  | Exclude<VlmStreamChunk, { type: "done" }>
  | { type: "done"; result: VlmFinalResult; metrics: VlmMetrics }

function percent(value: number) {
  return `${Math.round(value * 100)}%`
}

/**
 * 模型原始判定 → 最终裁决：
 * 1. 命中规则但置信度低于该规则阈值时降级为安全；
 * 2. 有效命中交给防抖引擎，冷却窗口内重复触发同一规则会折叠进既有事件。
 */
export function applyVerdict(
  input: NormalizedInput,
  raw: VlmFinalResult,
  now = Date.now()
): { result: VlmFinalResult; verdict: VlmVerdict } {
  const rule = raw.triggered && raw.ruleId ? input.rules.find((r) => r.id === raw.ruleId) : undefined

  if (!rule) {
    return {
      result: raw,
      verdict: { triggered: false, ruleId: null, ruleName: null, threshold: null, belowThreshold: false },
    }
  }

  if (raw.confidence < rule.sensitivity) {
    const note = `模型判定命中 ${rule.id}，但置信度 ${percent(raw.confidence)} 低于该规则阈值 ${percent(rule.sensitivity)}，已降级为安全。`
    return {
      result: {
        ...raw,
        triggered: false,
        ruleId: null,
        ruleTriggered: "无",
        severity: "SAFE",
        bbox: null,
        evidenceKeyframes: [],
        timestampOffset: "00:00.000",
        summary: note,
        reasoning: `${raw.reasoning}\n\n${note}`,
      },
      verdict: {
        triggered: false,
        ruleId: rule.id,
        ruleName: rule.name,
        threshold: rule.sensitivity,
        belowThreshold: true,
      },
    }
  }

  const outcome = registerTrigger(input.sourceKey, rule.id, now, {
    windowSeconds: rule.cooldownSeconds,
    skipEvent: input.sourceType === "local",
  })
  return {
    result: raw,
    verdict: {
      triggered: true,
      ruleId: rule.id,
      ruleName: rule.name,
      threshold: rule.sensitivity,
      belowThreshold: false,
      suppression: {
        incidentId: outcome.status.incidentId,
        windowSeconds: outcome.status.windowSeconds,
        suppressed: outcome.suppressed,
        isNewIncident: outcome.isNewIncident,
        triggerCount: outcome.status.rawTriggers,
        suppressedCount: outcome.status.suppressedCount,
        elapsedSec: outcome.status.elapsedSec,
      },
    },
  }
}
