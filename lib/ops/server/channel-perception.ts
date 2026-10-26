import { loadAllChannelPerception, loadChannelPerception } from "@/lib/storage/channel-perception-store"
import { loadLearning } from "@/lib/storage/tier1-learning-store"
import type { ChannelConfigResponse, CompiledTag } from "@/lib/vigil/channel-perception"
import { emptyLearning, type Tier1LearningState } from "@/lib/vigil/tier1-learning"
import { BASELINE_VOCABULARY } from "@/lib/vigil/vision"

/** 某通道的基础检测词表：只取该通道自己的专属词表；未配置时仅有一个人员锚点基线，不存在全局词表。 */
export function effectiveVocabulary(channelId: string): { tags: CompiledTag[]; source: "channel" | "baseline" } {
  const own = loadChannelPerception(channelId)
  if (own && own.compiled_tags.length > 0) return { tags: own.compiled_tags, source: "channel" }
  return { tags: BASELINE_VOCABULARY.map((item) => ({ ...item })), source: "baseline" }
}

/** 下发给视觉服务的词表：每路监控通道各取各的专属词表（未配置的取基线），不再携带任何全局词表。 */
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
  const effective = effectiveVocabulary(channelId)
  return {
    status: "ok",
    config: {
      channelId,
      raw_prompt: stored?.raw_prompt ?? "",
      compiled_tags: stored?.compiled_tags ?? [],
      learning_state: learningState(channelId),
    },
    configured: effective.source === "channel",
    source: effective.source,
    effective_tags: effective.tags,
    updatedAt: stored?.updatedAt ?? null,
  }
}
