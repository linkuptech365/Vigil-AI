import { loadAllChannelPerception, loadChannelPerception } from "@/lib/storage/channel-perception-store"
import { loadLearning } from "@/lib/storage/tier1-learning-store"
import type { ChannelConfigResponse, CompiledTag } from "@/lib/vigil/channel-perception"
import { emptyLearning, type Tier1LearningState } from "@/lib/vigil/tier1-learning"
import { deriveVocabulary } from "./rule-vocabulary"

/**
 * 某通道的生效检测词表：已持久化的专属词条（用户编译、二级反哺并入）∪ 该通道已启用规则引用的类别。
 * 两者皆无时仅保留人员锚点基线。
 */
export function effectiveVocabulary(channelId: string): { tags: CompiledTag[]; source: "rules" | "custom" | "baseline" } {
  const { tags, source } = deriveVocabulary(channelId)
  return { tags, source }
}

/**
 * 下发给视觉服务的词表：每路通道各取各的生效词表（含全部已持久化词条）。
 * 只剩人员锚点基线的通道下发空表，由 Worker 判定为不推理，避免对无配置通道白白占用算力。
 */
export function channelVocabularies(streamIds: string[]): Record<string, CompiledTag[]> {
  const out: Record<string, CompiledTag[]> = {}
  for (const channelId of new Set([...streamIds, ...Object.keys(loadAllChannelPerception())])) {
    const { tags, source } = effectiveVocabulary(channelId)
    out[channelId] = source === "baseline" ? [] : tags
  }
  return out
}

function learningState(channelId: string): Tier1LearningState {
  const { streamId: _streamId, history: _history, ...state } = loadLearning(channelId) ?? emptyLearning(channelId)
  return state
}

export function buildChannelConfig(channelId: string): ChannelConfigResponse {
  const stored = loadChannelPerception(channelId)
  const derived = deriveVocabulary(channelId)
  return {
    status: "ok",
    config: {
      channelId,
      raw_prompt: stored?.raw_prompt ?? "",
      compiled_tags: stored?.compiled_tags ?? [],
      learning_state: learningState(channelId),
    },
    configured: derived.source !== "baseline" || Boolean(stored),
    source: derived.source,
    effective_tags: derived.tags,
    binding: derived.binding,
    orphan_tags: derived.orphans,
    updatedAt: stored?.updatedAt ?? null,
  }
}
