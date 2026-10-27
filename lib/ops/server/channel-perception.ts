import { loadAllChannelPerception, loadChannelPerception } from "@/lib/storage/channel-perception-store"
import { loadLearning } from "@/lib/storage/tier1-learning-store"
import type { ChannelConfigResponse, CompiledTag } from "@/lib/vigil/channel-perception"
import { emptyLearning, type Tier1LearningState } from "@/lib/vigil/tier1-learning"
import { deriveVocabulary } from "./rule-vocabulary"

/**
 * 某通道的基础检测词表：由该通道已启用规则的 subject_classes + context_classes 并集派生，
 * 没有任何启用规则时仅保留人员锚点基线。已存储的历史编译词条只提供中文名与角色，不会自行进入推理词表。
 */
export function effectiveVocabulary(channelId: string): { tags: CompiledTag[]; source: "rules" | "baseline" } {
  const { tags, source } = deriveVocabulary(channelId)
  return { tags, source }
}

/** 下发给视觉服务的词表：每路监控通道各取各的规则派生词表，不再携带任何全局词表或孤儿词条。 */
export function channelVocabularies(streamIds: string[]): Record<string, CompiledTag[]> {
  const out: Record<string, CompiledTag[]> = {}
  for (const channelId of new Set([...streamIds, ...Object.keys(loadAllChannelPerception())])) {
    out[channelId] = effectiveVocabulary(channelId).tags
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
    configured: derived.source === "rules",
    source: derived.source,
    effective_tags: derived.tags,
    binding: derived.binding,
    orphan_tags: derived.orphans,
    updatedAt: stored?.updatedAt ?? null,
  }
}
